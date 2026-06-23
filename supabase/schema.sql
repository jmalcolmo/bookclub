-- ============================================================================
-- THE MARBLE RACE — BOOK CLUB EDITION
-- Supabase / Postgres schema + Row-Level Security
-- ----------------------------------------------------------------------------
-- Run this in the SQL editor of EACH Supabase project (dev and prod).
-- It is idempotent-ish: safe to re-run; drops policies before recreating them.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- The helper functions below reference tables that are created later in this
-- script. Don't validate function bodies at creation time (they only run after
-- the tables exist). Scoped to this session/transaction only.
set check_function_bodies = off;

-- ============================================================================
-- HELPER FUNCTIONS (security definer, to avoid recursive RLS on club_members)
-- ============================================================================

-- Is the current user a member of this club?
create or replace function public.is_club_member(_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from club_members
    where club_id = _club_id and user_id = auth.uid()
  );
$$;

-- Is the current user an owner-tier member of this club? The club CREATOR holds
-- the distinct 'creator' role; 'owner' remains valid for future use. Both tiers
-- carry the same privileges for now (no creator-specific functions yet).
create or replace function public.is_club_owner(_club_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from club_members
    where club_id = _club_id and user_id = auth.uid() and role in ('creator','owner')
  );
$$;

-- The club a given book belongs to (used in reaction/review policies)
create or replace function public.book_club(_book_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select club_id from books where id = _book_id;
$$;

-- Has the current user read at least up to _page of _book?
create or replace function public.has_read_to(_book_id uuid, _page int)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from reading_progress
    where book_id = _book_id
      and user_id = auth.uid()
      and current_page >= _page
  );
$$;

-- Does the current user share at least one club with _other? Used to scope
-- profile visibility: you can see the profiles of people you actually club with,
-- not every registered user. SECURITY DEFINER so it doesn't recurse on the
-- club_members SELECT policy.
create or replace function public.shares_club_with(_other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from club_members me
    join club_members them on them.club_id = me.club_id
    where me.user_id = auth.uid()
      and them.user_id = _other
  );
$$;

-- Is the current user the app admin? (the is_admin flag on their profile). Gates
-- global announcement broadcasts. SECURITY DEFINER so it doesn't depend on the
-- caller being able to SELECT their own profile row under RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Can the current user SEE a given reaction? Mirrors the spoiler gate in the
-- reactions SELECT policy exactly. Replies and engagements on a reaction inherit
-- this — a reply/like/emoji on a reaction is visible iff the reaction itself is,
-- so they can never leak the existence of a spoiler-gated reaction.
create or replace function public.reaction_visible(_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from reactions r
    where r.id = _id
      and is_club_member(book_club(r.book_id))
      and (r.user_id = auth.uid() or has_read_to(r.book_id, r.page))
  );
$$;

-- Can the current user SEE a given reaction reply? It inherits the parent
-- reaction's spoiler gate.
create or replace function public.reply_visible(_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.reaction_visible((select reaction_id from reaction_replies where id = _id));
$$;

-- Can the current user SEE a given review? Mirrors the reviews SELECT gate:
-- the author, or a member whose progress on that book is 'finished'.
create or replace function public.review_visible(_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from reviews rv
    where rv.id = _id
      and is_club_member(book_club(rv.book_id))
      and (
        rv.user_id = auth.uid()
        or exists (
          select 1 from reading_progress rp
          where rp.book_id = rv.book_id and rp.user_id = auth.uid() and rp.status = 'finished'
        )
      )
  );
$$;

-- Polymorphic visibility check for engagements (likes / emoji tapbacks). An
-- engagement is permitted only on a target the user can already see, so it can
-- never reveal a hidden reaction/review. Each target type routes back to the
-- gate that protects its underlying row.
create or replace function public.can_engage_target(_type text, _id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case _type
    when 'reaction'     then public.reaction_visible(_id)
    when 'reply'        then public.reply_visible(_id)
    when 'review'       then public.review_visible(_id)
    when 'book'         then public.is_club_member(public.book_club(_id))
    when 'progress'     then public.is_club_member(public.book_club((select book_id from reading_progress where id = _id)))
    when 'selection'    then public.is_club_member((select club_id from selections where id = _id))
    when 'announcement' then (auth.uid() is not null)
    else false
  end;
$$;

-- ============================================================================
-- PROFILES  (1:1 with auth.users)
-- ============================================================================
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Reader',
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default now()
);

-- App-admin flag. Lets one (or a few) accounts broadcast global announcements to
-- every user. Defaults false; granted explicitly below.
alter table profiles add column if not exists is_admin boolean not null default false;

alter table profiles enable row level security;

-- You can see your OWN profile and the profiles of people you share a club with.
-- (Previously any authenticated user could read every profile — a full member
-- directory. With open Google signup at scale that's needless exposure.) Every
-- user_id the client ever surfaces — club rosters, reaction/review/progress
-- authors — already comes from a club you belong to, so this doesn't break any
-- legitimate read.
drop policy if exists "profiles_select_all" on profiles;
drop policy if exists "profiles_select_self_or_comember" on profiles;
create policy "profiles_select_self_or_comember" on profiles
  for select using (id = auth.uid() or shares_club_with(id));

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
  for insert with check (id = auth.uid());

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Reader'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Grant admin to the app creator. Idempotent and safe to run in both projects;
-- only flips the flag once the account has signed in at least once (profile row
-- exists). Add more emails here if co-admins are ever needed.
update profiles set is_admin = true
where id in (select id from auth.users where email = 'malcolm.olexa24@gmail.com');

-- ============================================================================
-- CLUBS
-- ============================================================================
create table if not exists clubs (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  -- a --yarn-* accent color so each club keeps the granny-square theme
  accent               text not null default 'yarn-sage',
  join_code            text not null unique default upper(substring(replace(gen_random_uuid()::text,'-','') for 6)),
  created_by           uuid not null references auth.users(id) on delete set null,
  -- club-level deadline behavior
  deadlines_enabled    boolean not null default false,
  default_deadline_days int,
  created_at           timestamptz not null default now()
);

-- Optional club cover photo (uploaded to the 'club-images' storage bucket). When
-- absent, the UI shows the club's initials on its accent color.
alter table clubs add column if not exists photo_url text;

alter table clubs enable row level security;

-- Members (and the creator) can see their clubs. Non-members must use the
-- find_club_by_code() RPC below to discover a club to join — this keeps join
-- codes private and stops anyone from enumerating every club.
drop policy if exists "clubs_select_member_or_auth" on clubs;
drop policy if exists "clubs_select_member" on clubs;
create policy "clubs_select_member" on clubs
  for select using (is_club_member(id) or created_by = auth.uid());

drop policy if exists "clubs_insert_auth" on clubs;
create policy "clubs_insert_auth" on clubs
  for insert with check (created_by = auth.uid());

drop policy if exists "clubs_update_owner" on clubs;
create policy "clubs_update_owner" on clubs
  for update using (is_club_owner(id)) with check (is_club_owner(id));

drop policy if exists "clubs_delete_owner" on clubs;
create policy "clubs_delete_owner" on clubs
  for delete using (is_club_owner(id));

-- Look up a single club by its join code (the only way a non-member can find
-- one). Returns just enough to confirm before joining; never lists all clubs.
create or replace function public.find_club_by_code(_code text)
returns table (id uuid, name text, description text, accent text)
language sql
security definer
stable
set search_path = public
as $$
  select id, name, description, accent
  from clubs
  where join_code = upper(trim(_code))
  limit 1;
$$;

-- This RPC bypasses RLS (SECURITY DEFINER) to look up a club by its private join
-- code. Only logged-in users ever need it (you join after signing in), so deny it
-- to the anonymous role — that way an unauthenticated visitor can't sit on the
-- endpoint guessing the 6-char code space. Logged-in users are accountable.
revoke execute on function public.find_club_by_code(text) from public, anon;
grant  execute on function public.find_club_by_code(text) to authenticated;

-- ============================================================================
-- CLUB MEMBERS
-- ============================================================================
create table if not exists club_members (
  club_id   uuid not null references clubs(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  -- 'creator' = the person who made the club (assigned by trigger below).
  -- 'owner'   = reserved owner-tier role for future use / ownership transfer.
  -- 'member'  = everyone who joins.
  role      text not null default 'member' check (role in ('creator','owner','member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- Make the role set safe to widen on already-provisioned projects, and migrate
-- existing creators (previously stored as 'owner') to the new 'creator' role.
alter table club_members drop constraint if exists club_members_role_check;
alter table club_members add  constraint club_members_role_check check (role in ('creator','owner','member'));
update club_members set role = 'creator' where role = 'owner';

alter table club_members enable row level security;

-- Members can see the roster of clubs they belong to. The `or user_id = auth.uid()`
-- is essential: it lets you see your OWN membership row. Without it, joining fails —
-- the app inserts with RETURNING (supabase-js `.select()`), which applies this SELECT
-- policy to the new row, but `is_club_member` (a STABLE function) can't see a row the
-- same command just inserted, so the row is invisible and the insert is rejected.
-- Matching on user_id needs no table lookup, so your own row is always returned.
drop policy if exists "members_select_same_club" on club_members;
create policy "members_select_same_club" on club_members
  for select using (is_club_member(club_id) or user_id = auth.uid());

-- A user can add themselves to a club (join). Owner row is inserted by trigger below.
drop policy if exists "members_insert_self" on club_members;
create policy "members_insert_self" on club_members
  for insert with check (user_id = auth.uid());

-- A user can leave; an owner can remove members.
drop policy if exists "members_delete_self_or_owner" on club_members;
create policy "members_delete_self_or_owner" on club_members
  for delete using (user_id = auth.uid() or is_club_owner(club_id));

-- When a club is created, make the creator a 'creator' member automatically.
create or replace function public.handle_new_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.club_members (club_id, user_id, role)
  values (new.id, new.created_by, 'creator')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_club_created on clubs;
create trigger on_club_created
  after insert on clubs
  for each row execute function public.handle_new_club();

-- ============================================================================
-- BOOKS
-- ============================================================================
create table if not exists books (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references clubs(id) on delete cascade,
  title           text not null,
  author          text,
  cover_url       text,
  open_library_id text,
  page_count      int,                 -- canonical total for progress/% math
  picked_by       uuid references auth.users(id) on delete set null,
  status          text not null default 'current'
                    check (status in ('upcoming','current','finished')),
  deadline        timestamptz,         -- null = no deadline
  deadline_extensions int not null default 0,
  started_at      timestamptz default now(),
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists books_club_idx on books(club_id);

alter table books enable row level security;

drop policy if exists "books_select_member" on books;
create policy "books_select_member" on books
  for select using (is_club_member(club_id));

drop policy if exists "books_insert_member" on books;
create policy "books_insert_member" on books
  for insert with check (is_club_member(club_id));

-- Only the club creator/owner can update book state — mark the book finished for
-- the whole club, extend the deadline, edit metadata. (A member's own reading
-- progress lives in reading_progress, not books, so this doesn't restrict that.)
-- The old, looser "books_update_member" policy is dropped for parity on re-run.
drop policy if exists "books_update_member" on books;
drop policy if exists "books_update_owner" on books;
create policy "books_update_owner" on books
  for update using (is_club_owner(club_id)) with check (is_club_owner(club_id));

drop policy if exists "books_delete_owner_or_picker" on books;
create policy "books_delete_owner_or_picker" on books
  for delete using (is_club_owner(club_id) or picked_by = auth.uid());

-- ============================================================================
-- READING PROGRESS  (one row per user per book)
-- ============================================================================
create table if not exists reading_progress (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references books(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  current_page int not null default 0,
  status       text not null default 'not_started'
                 check (status in ('not_started','reading','finished')),
  started_at   timestamptz,
  finished_at  timestamptz,
  updated_at   timestamptz not null default now(),
  unique (book_id, user_id)
);

create index if not exists progress_book_idx on reading_progress(book_id);

alter table reading_progress enable row level security;

-- Members can see everyone's progress in their club (powers "who's where" + gating UI).
drop policy if exists "progress_select_member" on reading_progress;
create policy "progress_select_member" on reading_progress
  for select using (is_club_member(book_club(book_id)));

drop policy if exists "progress_upsert_own" on reading_progress;
create policy "progress_upsert_own" on reading_progress
  for insert with check (user_id = auth.uid() and is_club_member(book_club(book_id)));

drop policy if exists "progress_update_own" on reading_progress;
create policy "progress_update_own" on reading_progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- REACTIONS  (page-tagged; SPOILER-GATED in the SELECT policy)
-- ============================================================================
create table if not exists reactions (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references books(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  page       int not null,            -- the point in the book this reaction is about
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists reactions_book_idx on reactions(book_id);

alter table reactions enable row level security;

-- *** THE SPOILER GATE ***
-- You may read a reaction only if:
--   - you are a member of the book's club, AND
--   - you wrote it, OR you have logged progress at/past its page.
drop policy if exists "reactions_select_spoiler_gated" on reactions;
create policy "reactions_select_spoiler_gated" on reactions
  for select using (
    is_club_member(book_club(book_id))
    and (
      user_id = auth.uid()
      or has_read_to(book_id, page)
    )
  );

drop policy if exists "reactions_insert_member" on reactions;
create policy "reactions_insert_member" on reactions
  for insert with check (
    user_id = auth.uid() and is_club_member(book_club(book_id))
  );

drop policy if exists "reactions_delete_own" on reactions;
create policy "reactions_delete_own" on reactions
  for delete using (user_id = auth.uid());

-- ============================================================================
-- REVIEWS  (a member's overall write-up / rating of a book they've read)
-- ============================================================================
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references books(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  rating     int check (rating between 1 and 5),
  body       text,
  created_at timestamptz not null default now(),
  unique (book_id, user_id)
);

create index if not exists reviews_book_idx on reviews(book_id);

alter table reviews enable row level security;

-- Reviews are full spoilers, so only visible once you've finished the book
-- (or wrote it). "finished" = progress status finished OR page >= page_count.
drop policy if exists "reviews_select_finished" on reviews;
create policy "reviews_select_finished" on reviews
  for select using (
    is_club_member(book_club(book_id))
    and (
      user_id = auth.uid()
      or exists (
        select 1 from reading_progress rp
        where rp.book_id = reviews.book_id
          and rp.user_id = auth.uid()
          and rp.status = 'finished'
      )
    )
  );

drop policy if exists "reviews_upsert_own" on reviews;
create policy "reviews_upsert_own" on reviews
  for insert with check (user_id = auth.uid() and is_club_member(book_club(book_id)));

drop policy if exists "reviews_update_own" on reviews;
create policy "reviews_update_own" on reviews
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reviews_delete_own" on reviews;
create policy "reviews_delete_own" on reviews
  for delete using (user_id = auth.uid());

-- ============================================================================
-- REACTION REPLIES  (X-style threaded comments under a reaction)
-- ============================================================================
create table if not exists reaction_replies (
  id          uuid primary key default gen_random_uuid(),
  reaction_id uuid not null references reactions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists reaction_replies_reaction_idx on reaction_replies(reaction_id);

alter table reaction_replies enable row level security;

-- A reply inherits its parent reaction's spoiler gate: you can read or post one
-- only if you can see the reaction it hangs off. (reaction_visible() is the same
-- gate as the reactions SELECT policy.)
drop policy if exists "replies_select_visible" on reaction_replies;
create policy "replies_select_visible" on reaction_replies
  for select using (reaction_visible(reaction_id));

drop policy if exists "replies_insert_visible" on reaction_replies;
create policy "replies_insert_visible" on reaction_replies
  for insert with check (user_id = auth.uid() and reaction_visible(reaction_id));

drop policy if exists "replies_delete_own" on reaction_replies;
create policy "replies_delete_own" on reaction_replies
  for delete using (user_id = auth.uid());

-- ============================================================================
-- ENGAGEMENTS  (likes + emoji tapbacks on ANY feed item)
-- ============================================================================
-- Polymorphic: (target_type, target_id) points at a reaction, reply, review,
-- book, reading_progress row, selection, or announcement. `kind` is 'like' or a
-- palette emoji. The unique constraint means one like + one of each emoji per
-- user per target, so a tap toggles the row on/off.
create table if not exists engagements (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in
                ('reaction','reply','review','book','progress','selection','announcement')),
  target_id   uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('like','❤️','😂','😮','😢','🔥')),
  created_at  timestamptz not null default now(),
  unique (target_type, target_id, user_id, kind)
);

create index if not exists engagements_target_idx on engagements(target_type, target_id);
create index if not exists engagements_user_idx on engagements(user_id);

alter table engagements enable row level security;

-- You may read or add an engagement ONLY on a target you can already see. This
-- routes every target type back through its own gate (esp. the reaction spoiler
-- gate), so an engagement can never reveal a hidden reaction or review.
drop policy if exists "engagements_select_visible" on engagements;
create policy "engagements_select_visible" on engagements
  for select using (can_engage_target(target_type, target_id));

drop policy if exists "engagements_insert_visible" on engagements;
create policy "engagements_insert_visible" on engagements
  for insert with check (user_id = auth.uid() and can_engage_target(target_type, target_id));

drop policy if exists "engagements_delete_own" on engagements;
create policy "engagements_delete_own" on engagements
  for delete using (user_id = auth.uid());

-- ============================================================================
-- ANNOUNCEMENTS  (global broadcasts the app admin pushes to every user)
-- ============================================================================
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  body       text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists announcements_created_idx on announcements(created_at desc);

alter table announcements enable row level security;

-- Everyone signed in sees every announcement (global by design).
drop policy if exists "announcements_select_all" on announcements;
create policy "announcements_select_all" on announcements
  for select using (auth.uid() is not null);

-- Only the app admin can broadcast (or remove) an announcement.
drop policy if exists "announcements_insert_admin" on announcements;
create policy "announcements_insert_admin" on announcements
  for insert with check (is_admin() and created_by = auth.uid());

drop policy if exists "announcements_delete_admin" on announcements;
create policy "announcements_delete_admin" on announcements
  for delete using (is_admin());

-- Per-user dismissal of an announcement, so "seen" persists across devices.
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table announcement_reads enable row level security;

drop policy if exists "annreads_select_own" on announcement_reads;
create policy "annreads_select_own" on announcement_reads
  for select using (user_id = auth.uid());

drop policy if exists "annreads_insert_own" on announcement_reads;
create policy "annreads_insert_own" on announcement_reads
  for insert with check (user_id = auth.uid());

-- ============================================================================
-- SELECTIONS  (how the next picker was chosen — wheel / vote / pick / race)
-- ============================================================================
create table if not exists selections (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id) on delete cascade,
  method      text not null check (method in ('wheel','vote','pick','race')),
  status      text not null default 'open' check (status in ('open','decided')),
  result_user uuid references auth.users(id) on delete set null,
  created_by  uuid not null references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index if not exists selections_club_idx on selections(club_id);

alter table selections enable row level security;

drop policy if exists "selections_select_member" on selections;
create policy "selections_select_member" on selections
  for select using (is_club_member(club_id));

drop policy if exists "selections_insert_member" on selections;
create policy "selections_insert_member" on selections
  for insert with check (is_club_member(club_id) and created_by = auth.uid());

-- Only the person who opened the selection (or a club owner) can finalize it —
-- set result_user / flip it to 'decided'. Members participate by casting votes in
-- selection_votes, not by mutating the selection row. (Previously ANY member
-- could crown the winner, overriding the host.) The wheel/pick/vote-close flows
-- all run as the creator, so this matches existing behavior server-side.
drop policy if exists "selections_update_member" on selections;
drop policy if exists "selections_update_owner_or_creator" on selections;
create policy "selections_update_owner_or_creator" on selections
  for update using (created_by = auth.uid() or is_club_owner(club_id))
  with check (created_by = auth.uid() or is_club_owner(club_id));

-- Votes cast within a 'vote' selection.
create table if not exists selection_votes (
  selection_id uuid not null references selections(id) on delete cascade,
  voter_id     uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (selection_id, voter_id)
);

alter table selection_votes enable row level security;

drop policy if exists "votes_select_member" on selection_votes;
create policy "votes_select_member" on selection_votes
  for select using (
    is_club_member((select club_id from selections s where s.id = selection_id))
  );

drop policy if exists "votes_insert_self" on selection_votes;
create policy "votes_insert_self" on selection_votes
  for insert with check (
    voter_id = auth.uid()
    and is_club_member((select club_id from selections s where s.id = selection_id))
  );

drop policy if exists "votes_update_self" on selection_votes;
create policy "votes_update_self" on selection_votes
  for update using (voter_id = auth.uid()) with check (voter_id = auth.uid());

-- ============================================================================
-- REALTIME  (so reactions / votes / progress stream live to members)
-- ============================================================================
-- Add tables to the supabase_realtime publication (ignore if already added).
do $$
begin
  begin execute 'alter publication supabase_realtime add table reactions'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table reading_progress'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table selection_votes'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table books'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table engagements'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table reaction_replies'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table announcements'; exception when others then null; end;
end $$;

-- ============================================================================
-- STORAGE BUCKETS  (avatars + club cover images)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('avatars','avatars', true), ('club-images','club-images', true)
on conflict (id) do nothing;

-- Cap uploads so a single user can't fill storage (cost/abuse) and can't host
-- arbitrary file types from our domain. `on conflict do nothing` above means
-- these limits must be applied with an UPDATE for already-provisioned buckets.
update storage.buckets
   set file_size_limit = 2097152,  -- 2 MB
       allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
 where id in ('avatars','club-images');

-- Reads stay public (buckets are public; URLs are unguessable enough for avatars
-- and club covers).
drop policy if exists "storage_read_public" on storage.objects;
create policy "storage_read_public" on storage.objects
  for select using (bucket_id in ('avatars','club-images'));

-- WRITE SCOPING. The previous policies allowed ANY authenticated user to write to
-- ANY path in these buckets — so anyone could overwrite anyone's avatar or any
-- club's cover. The client writes under `${user.id}/...` (avatars) and
-- `${club.id}/...` (club-images); enforce that convention server-side via the
-- first path segment. `upsert: true` in the client hits both INSERT and UPDATE,
-- so both commands are scoped; DELETE lets owners clean up their own files.
drop policy if exists "storage_write_auth" on storage.objects;
drop policy if exists "storage_update_auth" on storage.objects;

-- avatars: a user may only write under their own uid folder.
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- club-images: only a club owner may write under that club's folder. Mirrors
-- clubs_update_owner (only owners can set photo_url anyway). A malformed,
-- non-uuid first segment makes is_club_owner() return false → denied.
drop policy if exists "clubimg_insert_owner" on storage.objects;
create policy "clubimg_insert_owner" on storage.objects
  for insert with check (
    bucket_id = 'club-images'
    and is_club_owner(nullif((storage.foldername(name))[1], '')::uuid)
  );
drop policy if exists "clubimg_update_owner" on storage.objects;
create policy "clubimg_update_owner" on storage.objects
  for update using (
    bucket_id = 'club-images'
    and is_club_owner(nullif((storage.foldername(name))[1], '')::uuid)
  ) with check (
    bucket_id = 'club-images'
    and is_club_owner(nullif((storage.foldername(name))[1], '')::uuid)
  );
drop policy if exists "clubimg_delete_owner" on storage.objects;
create policy "clubimg_delete_owner" on storage.objects
  for delete using (
    bucket_id = 'club-images'
    and is_club_owner(nullif((storage.foldername(name))[1], '')::uuid)
  );

-- ============================================================================
-- DONE
-- ============================================================================
