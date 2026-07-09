# Design: "Unlocked reactions" notifications

**Status:** IMPLEMENTED (2026-07-08) on web + iOS, per this design. Schema
(`unlocked_reactions` RPC + `reaction_unlocks` table) is in `supabase/schema.sql` — apply that
additive tail to dev, then prod at release (idempotent). The DEFERRED push path (§5) remains
unbuilt. This doc is retained as the reference for the design.

**Goal:** When a reader bumps their reading progress on a book, reactions that *other*
members wrote in the pages they just crossed become newly visible to them (the spoiler
gate opens for those rows). Today nothing tells the reader this happened — those
reactions just quietly appear the next time they open the book. This design surfaces
them: "N reactions unlocked while you were away — View?", leading to a dedicated,
filtered space (not the mixed feed), plus a global "Unlocked" inbox across books, with a
DEFERRED push path over the existing `device_tokens` / WS4 plumbing.

**Non-negotiable invariant (CLAUDE.md rule 2):** the server-side spoiler gate is the sole
authority. This feature must NEVER weaken it, and must NEVER reveal a reaction the RLS
`reactions_select_spoiler_gated` policy would not already return to this reader. Every
storage/RPC/push decision below is checked against that.

---

## 1. Detection — what counts as "newly unlocked"

### The gate, restated

From `supabase/schema.sql`, a reader may SELECT a reaction iff:

```
is_club_member(book_club(book_id))
AND ( user_id = auth.uid() OR has_read_to(book_id, page) )      -- club path
-- OR the additive follow path (non-member of the book's club); see §1.4
```

`has_read_to(book, page)` is `current_page >= page` on the reader's own
`reading_progress` row. So the visible/hidden boundary for a reader is exactly their
saved `current_page`.

### 1.1 The trigger event

`setProgress(bookId, currentPage, status)` (`src/api.js` and iOS `API+Progress.swift`)
upserts the reader's `reading_progress` row. The bump is `oldPage → newPage`.

**`oldPage` is available client-side before the upsert.** Both clients already hold it:

- Web `progress.js`: the card renders from `mine` (the reader's `reading_progress`), and
  `book.js` similarly holds `myProgress`. `mine.current_page` is `oldPage`.
- iOS `MyProgressView` / `BookView`: `myProgress(bookId:)` returns the same row before the
  write; `.currentPage` is `oldPage`.

So detection does not need a DB trigger to know the old value — the *caller* of
`setProgress` knows both endpoints.

### 1.2 The newly-visible set

On a bump `oldPage → newPage` (only when `newPage > oldPage`), the reactions that become
newly visible are:

```
reactions where book_id = :book
  and user_id <> :me                 -- authored by OTHER users (my own were always visible)
  and page > oldPage                 -- were hidden before the bump
  and page <= newPage                -- are visible after the bump
```

i.e. `page ∈ (oldPage, newPage]`. Half-open on the low end (a reaction exactly at
`oldPage` was already visible, since the gate is `current_page >= page`), closed on the
high end (a reaction exactly at `newPage` is now visible).

Notes / edge cases:

- **First-time progress** (`oldPage` absent, no prior row): treat `oldPage = 0`. A reader
  who was `not_started` had `current_page` default `0`, so `(0, newPage]` is correct.
- **Backwards edits / resets:** if `newPage <= oldPage` there is nothing to unlock; skip.
  `deleteProgress` (reset) RE-LOCKS reactions — it does not unlock anything and must not
  generate notifications. (It should arguably prune already-recorded unlock rows; see
  §2.4.)
- **`finished` status:** finishing sets `current_page` too (clients pass the page). Unlock
  math is identical; additionally reviews unlock at `finished`, but reviews are out of
  scope for this feature (it is scoped to reactions). Left as a future extension in §7.
- The set is *reactions by other users*; the reader's own reactions were never gated from
  them, so they are never "unlocked".

### 1.3 Who computes it — and why NOT the client alone

The client knows `oldPage`/`newPage`, but it must NOT compute the unlocked set by reading
all reactions and filtering by page locally — that would require the client to hold
reactions it may not be allowed to see, re-implementing the gate client-side (violates
rule 2). Instead the set is computed **server-side under the caller's own RLS** via an
RPC (§2.1) that runs as the invoking user (`SECURITY INVOKER`), so it can only ever return
rows the reader is now permitted to see. The client passes `oldPage`/`newPage` as
*hints* to bound the query; the gate still decides.

### 1.4 Interaction with the follow path

The additive follow path (`is_following(user_id) and not is_club_member(...)`) makes a
followee's solo reactions visible regardless of the reader's page. Those are NOT
page-gated for this reader, so they are never "unlocked" by a progress bump and are
excluded by the `is_club_member(book_club(...))`-scoped RPC below. This feature concerns
only the *club* spoiler gate opening as you read. No follow-path reaction is ever
reported as newly unlocked.

---

## 2. Storage & server API

Two pieces: a **read-time RPC** that computes the unlocked set under RLS, and a
**per-user seen table** (`reaction_unlocks`) modeled on `announcement_reads` so "I've seen
these" persists across devices.

### 2.1 RPC: `unlocked_reactions(book_id, from_page, to_page)`

`SECURITY INVOKER` (the DEFAULT — do NOT make it `SECURITY DEFINER`). Running as the
caller means the function body is subject to the same `reactions` SELECT RLS as a normal
query, so it structurally cannot return a hidden reaction. It exists only to (a) bound the
scan by the page window the caller crossed and (b) return a tidy shape.

```sql
-- Reactions by OTHER users whose page falls in (from_page, to_page], that the
-- CALLER is now allowed to see. SECURITY INVOKER: the reactions RLS SELECT policy
-- (the spoiler gate) still applies inside this function, so it can never leak a
-- reaction the caller couldn't already SELECT directly. from_page/to_page only
-- narrow the scan to the window just crossed; they never widen visibility.
create or replace function public.unlocked_reactions(
  _book_id uuid, _from_page int, _to_page int
)
returns setof reactions
language sql
stable
security invoker            -- explicit for clarity; invoker is the safe default
set search_path = public
as $$
  select r.*
  from reactions r
  where r.book_id = _book_id
    and r.user_id <> auth.uid()
    and r.page >  _from_page
    and r.page <= _to_page
  order by r.page asc, r.created_at asc;
$$;
```

Why an RPC and not a plain client query: it documents intent, keeps the page-window math
in one place for both clients, and returns `setof reactions` so callers decode the same
`Reaction` model they already use. A plain `.from("reactions").gt("page",…).lte(…)` query
would be equally safe under RLS; the RPC is the recommended form for parity + a single
source of truth. Either way the gate is enforced by RLS, never by the RPC's WHERE clause.

> Correctness detail: because the RPC runs as invoker, the `r.page <= _to_page` predicate
> is effectively bounded by the gate for a reader whose `current_page` reflects
> `to_page`. The client calls the RPC AFTER the `setProgress` upsert has committed, so
> `has_read_to` sees the new page and the gate admits exactly the crossed window. If the
> RPC were (mis)called with `to_page` beyond the reader's real `current_page`, the gate
> still hides anything past their true page — the window can only ever be a subset of
> what the gate allows.

### 2.2 Per-user seen table: `reaction_unlocks` (modeled on `announcement_reads`)

`announcement_reads(announcement_id, user_id, created_at)` tracks per-user dismissal.
Mirror that for unlocks, adding the two timestamps the UX needs:

```sql
-- One row per (user, reaction) the first time that reaction becomes visible to the
-- user via a progress bump. `unlocked_at` = when we recorded the unlock;
-- `seen_at` = when the user actually viewed it in the Unlocked space (null = unseen,
-- i.e. still in the inbox badge). Modeled on announcement_reads.
create table if not exists reaction_unlocks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction_id uuid not null references reactions(id)  on delete cascade,
  unlocked_at timestamptz not null default now(),
  seen_at     timestamptz,
  primary key (user_id, reaction_id)
);

create index if not exists reaction_unlocks_user_unseen_idx
  on reaction_unlocks(user_id) where seen_at is null;

alter table reaction_unlocks enable row level security;

-- Owner-only, exactly like announcement_reads: a user sees/writes ONLY their own
-- unlock rows. This table stores which reaction_ids unlocked for me — it must never
-- be readable by anyone else.
drop policy if exists "reaction_unlocks_select_own" on reaction_unlocks;
create policy "reaction_unlocks_select_own" on reaction_unlocks
  for select using (user_id = auth.uid());

-- INSERT is guarded so a client cannot fabricate an unlock for a reaction it is not
-- actually allowed to see. reaction_visible() is the SAME gate as the reactions
-- SELECT policy (already in schema.sql), so you can only record an unlock for a
-- reaction you can currently SELECT. This is the critical anti-abuse check: it stops
-- reaction_unlocks from ever becoming a side channel that confirms a hidden
-- reaction's existence.
drop policy if exists "reaction_unlocks_insert_own_visible" on reaction_unlocks;
create policy "reaction_unlocks_insert_own_visible" on reaction_unlocks
  for insert with check (
    user_id = auth.uid()
    and reaction_visible(reaction_id)
  );

-- The only mutation is marking rows seen; owner-only.
drop policy if exists "reaction_unlocks_update_own" on reaction_unlocks;
create policy "reaction_unlocks_update_own" on reaction_unlocks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reaction_unlocks_delete_own" on reaction_unlocks;
create policy "reaction_unlocks_delete_own" on reaction_unlocks
  for delete using (user_id = auth.uid());
```

`reaction_visible(_id)` already exists in `schema.sql` (used by replies/engagements) and
mirrors the spoiler gate exactly — reusing it keeps this table honest with zero new gate
logic.

Realtime: `reaction_unlocks` does NOT need to go in the `supabase_realtime` publication —
it is written by the reader's own client and read back by the same client; there is no
cross-user live push. (Cross-device sync is via the persisted `seen_at`, same as
`announcement_reads`.)

### 2.3 Why store unlocks at all (vs. computing on the fly)

The RPC alone answers "what's visible in this window right now", but the UX needs:

1. **"while you were away" count** — a durable set of *unseen* unlocks that survives app
   restarts and syncs across devices. That is inherently stateful → the table.
2. **Grouping across books / a global inbox** — a single cheap query
   (`reaction_unlocks where seen_at is null`) instead of re-deriving windows per book.
3. **Idempotency** — the PK `(user_id, reaction_id)` means recording an unlock twice
   (re-bumping across the same page, two devices) is a no-op upsert; the first
   `unlocked_at` wins and it only shows once.

### 2.4 Recording flow (client, after a successful bump)

After `setProgress` resolves for a bump where `newPage > oldPage`:

1. `rpc unlocked_reactions(book, oldPage, newPage)` → the newly-visible reactions.
2. If any, upsert `reaction_unlocks(user_id, reaction_id)` rows (ON CONFLICT DO NOTHING,
   `seen_at` left null). RLS `reaction_unlocks_insert_own_visible` re-checks each is
   actually visible — belt and suspenders.
3. Surface the count in the UI (§4). Do not block the `setProgress` UX on this — record
   opportunistically; a failure just means no toast this time.

Optional hardening for `deleteProgress` (reset): the re-lock means those reactions are no
longer visible, so their unseen unlock rows are stale. Since the client can't see the
now-hidden reactions to enumerate them, the simplest correct approach is: on reset, delete
ALL of my `reaction_unlocks` rows for that book (`reaction_id in (select id from reactions
where book_id = …)`, which RLS scopes). Deferred as a nicety — a stale unseen row is
harmless (tapping it resolves to nothing via the RLS re-join in §3) but slightly
confusing. Tracked as an open question (§7).

---

## 3. api.js / iOS signatures

### 3.1 Web — additions to `src/api.js` (all DB access stays here, rule 1)

```js
// ---------------------------------------------------- UNLOCKED REACTIONS ---
// Reactions by OTHER members that fall in (fromPage, toPage] and are now visible
// to me — i.e. that my latest progress bump just unlocked. Runs a SECURITY INVOKER
// RPC, so RLS (the spoiler gate) still decides what comes back; fromPage/toPage
// only bound the window. Decorated with the author profile like bookReactions().
export async function unlockedReactions(bookId, fromPage, toPage) {
  const rows = unwrap(await supabase.rpc("unlocked_reactions", {
    _book_id: bookId, _from_page: fromPage, _to_page: toPage,
  }));
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profile: pById[r.user_id] }));
}

// Record that a set of reactions unlocked for me (unseen). Idempotent on
// (user_id, reaction_id). RLS re-checks each reaction is actually visible to me.
export async function recordUnlocks(reactionIds) {
  if (!reactionIds.length) return;
  const user = (await supabase.auth.getUser()).data.user;
  const rows = reactionIds.map((id) => ({ user_id: user.id, reaction_id: id }));
  return unwrap(
    await supabase.from("reaction_unlocks")
      .upsert(rows, { onConflict: "user_id,reaction_id", ignoreDuplicates: true })
  );
}

// My unlock rows, optionally only unseen (for the badge / inbox). Newest first.
// Decorated with the reaction, book and author so the inbox can group by book.
// Reactions/books come back RLS-filtered; anything no longer visible is dropped.
export async function myUnlocks({ unseenOnly = false } = {}) {
  const user = (await supabase.auth.getUser()).data.user;
  let q = supabase.from("reaction_unlocks").select("*").eq("user_id", user.id)
    .order("unlocked_at", { ascending: false });
  if (unseenOnly) q = q.is("seen_at", null);
  const unlocks = unwrap(await q);
  if (!unlocks.length) return [];
  const reactions = unwrap(
    await supabase.from("reactions").select("*")
      .in("id", unlocks.map((u) => u.reaction_id))
  );
  const rById = Object.fromEntries(reactions.map((r) => [r.id, r]));
  const bookIds = [...new Set(reactions.map((r) => r.book_id))];
  const [books, profiles] = await Promise.all([
    supabase.from("books").select("*").in("id", bookIds).then(unwrap),
    getProfiles(reactions.map((r) => r.user_id)),
  ]);
  const bById = Object.fromEntries(books.map((b) => [b.id, b]));
  const pById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return unlocks
    .map((u) => {
      const r = rById[u.reaction_id];
      if (!r) return null;            // reaction deleted or re-locked → drop
      return { ...u, reaction: { ...r, profile: pById[r.user_id] }, book: bById[r.book_id] };
    })
    .filter((x) => x && x.book);
}

// Mark specific unlock rows seen (on viewing the Unlocked space). Owner-only RLS.
export async function markUnlocksSeen(reactionIds) {
  if (!reactionIds.length) return;
  const user = (await supabase.auth.getUser()).data.user;
  return unwrap(
    await supabase.from("reaction_unlocks")
      .update({ seen_at: new Date().toISOString() })
      .eq("user_id", user.id).in("reaction_id", reactionIds).is("seen_at", null)
  );
}
```

Recommended call site — fold recording into `setProgress` so every caller
(`progress.js`, `book.js`) gets it for free and detection lives in one place:

```js
// setProgress already knows the NEW page; the caller passes the OLD page it held.
export async function setProgress(bookId, currentPage, status, { prevPage } = {}) {
  // …existing upsert…
  const saved = unwrap(/* upsert … */);
  if (prevPage != null && currentPage > prevPage) {
    // fire-and-forget; never block the progress save on notification bookkeeping
    unlockedReactions(bookId, prevPage, currentPage)
      .then((rx) => recordUnlocks(rx.map((r) => r.id)))
      .catch(() => {});
  }
  return saved;
}
```

`progress.js` / `book.js` already hold `mine.current_page` → pass it as `prevPage`. This
keeps the one-place rule and means the mixed feed and book page don't each re-implement
detection.

### 3.2 iOS — new `API+Unlocks.swift` (mirrors the web, port style of `API+Announcements.swift`)

```swift
extension API {
    // (fromPage, toPage] reactions by others now visible to me. RPC is
    // SECURITY INVOKER, so RLS (the spoiler gate) still decides the result.
    static func unlockedReactions(bookId: UUID, fromPage: Int, toPage: Int)
        async throws -> [ReactionItem]
    {
        struct P: Encodable { let _book_id: UUID; let _from_page: Int; let _to_page: Int }
        let rows: [Reaction] = try await supabase
            .rpc("unlocked_reactions",
                 params: P(_book_id: bookId, _from_page: fromPage, _to_page: toPage))
            .execute().value
        let profiles = try await profilesById(rows.map(\.userId))
        return rows.map { ReactionItem(reaction: $0, profile: profiles[$0.userId]) }
    }

    private struct UnlockUpsert: Encodable { let userId: UUID; let reactionId: UUID }

    // Idempotent record of unlocked reactions (unseen). RLS re-checks visibility.
    static func recordUnlocks(_ reactionIds: [UUID]) async throws {
        guard !reactionIds.isEmpty else { return }
        let uid = try await currentUserId()
        let rows = reactionIds.map { UnlockUpsert(userId: uid, reactionId: $0) }
        try await supabase.from("reaction_unlocks")
            .upsert(rows, onConflict: "user_id,reaction_id", ignoreDuplicates: true)
            .execute()
    }

    // My unlocks (optionally unseen only), decorated with reaction/book/author.
    static func myUnlocks(unseenOnly: Bool = false) async throws -> [UnlockItem] { /* … */ }

    // Mark unlock rows seen on view.
    static func markUnlocksSeen(_ reactionIds: [UUID]) async throws { /* … */ }
}
```

Recording is folded into the iOS `setProgress` the same way (add a `prevPage: Int?`
argument; the views already fetch `myProgress` first).

---

## 4. UX

Two surfaces, both driven off `reaction_unlocks`:

### 4.1 The moment of unlock — inline banner / toast

Right after a progress bump that unlocked ≥1 reaction, on the book page and the My
Progress card:

> **3 reactions unlocked** while you were away. **View →**

- 0 unlocked → nothing (don't nag on every page turn).
- 1 → "1 reaction unlocked …".
- "View →" opens the **dedicated filtered space** for THIS book (§4.2), not the mixed
  feed. Tapping it marks those reactions seen.
- The banner is derived from the same RPC call the recording step made, so no extra query.

### 4.2 Dedicated "Unlocked" space (per book)

A filtered view that shows ONLY the reactions this reader just unlocked — separate from
the book's full reaction stream and separate from the mixed home feed. This matters
because the mixed feed interleaves everything; a reader who just crossed a chapter wants a
clean "here's what people said about the part you just read" reading list.

- **Grouped by book** (single-book here; the global inbox groups across books).
- Ordered by reaction `page` ascending (walk forward through the pages you crossed), which
  matches `bookReactions()` ordering.
- Each item: author avatar + name, page tag, body, and the normal engagement bar / reply
  affordances (reuse `engage.js` on web, `EngagementBar` / `ReplyThreadView` on iOS) —
  these are all gated by the SAME RLS, so nothing new leaks.
- **Marked seen on view:** when the space is shown, call `markUnlocksSeen(ids)` for the
  rows displayed. Consistent with `dismissAnnouncement` semantics (server-side, cross
  device).
- Empty state ("You're all caught up") when everything's been seen.

### 4.3 Global "Unlocked" inbox (across books)

A single entry point (badge count = unseen unlocks) that aggregates across all books/clubs:

- Query `myUnlocks({ unseenOnly:true })`, group by `book`, section header = book
  cover/title + club name, items sorted by page within each book.
- Tapping an item deep-links to that reaction on the book page (route
  `/club/:id/book/:bookId` on web with the reaction id to flash/scroll, mirroring
  `myActivity`'s `highlight`/`go` pattern; iOS `Route` to `BookView` with a highlight).
- Viewing marks the shown rows seen; the badge clears accordingly.
- This is a NEW screen: follow the `new-screen` pattern (api fns → view →
  route in `main.js` → nav entry → styles in `club.css`). Suggested web route
  `/unlocked`; iOS a tab or a bell entry in the feed header next to announcements.

### 4.4 Web UI sketch

```
┌───────────────────────────── YOUR FEED ───────────────────────────┐
│  🔔 Unlocked  (3)   ← badge in feed header / nav, opens /unlocked  │
└────────────────────────────────────────────────────────────────────┘

/unlocked  ("Deranged Granny Square": .patch cards, stamp-title header)
┌──────────────────────────────────────────────────────────────────┐
│  UNLOCKED                                                          │
│  Reactions that opened up as you read.                            │
│                                                                    │
│  ── The Left Hand of Darkness · Sci-Fi Club ──────────────────    │
│   ┌ patch ─────────────────────────────────────────────────────┐  │
│   │ (avatar) Dana · p.142                                       │  │
│   │ "The betrayal here wrecked me."                             │  │
│   │ ❤ 2   💬 reply                                              │  │
│   └─────────────────────────────────────────────────────────────┘ │
│   ┌ patch ─────────────────────────────────────────────────────┐  │
│   │ (avatar) Sam · p.150   "Called it in chapter 2."           │  │
│   └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ── Piranesi · Tuesday Readers ────────────────────────────────    │
│   ┌ patch ─────────────────────────────────────────────────────┐  │
│   │ (avatar) Rey · p.88  "The statues!!"                        │  │
│   └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

Inline banner on the book page after a bump:
┌ patch (yarn-ochre accent) ─────────────────────────────────────────┐
│  ✨ 3 reactions unlocked while you were away.        [ View → ]    │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.5 iOS UI sketch

```
FeedView header:            ClubsView / tab bar:
┌───────────────────┐       [ Feed ] [ Progress ] [ Clubs ] [ Unlocked ● ] [ Me ]
│ YOUR FEED    🔔 3 │                                          ▲ badge = unseen
└───────────────────┘

UnlockedView (List, sectioned by book — PatchCard rows):
┌─────────────────────────────────────────┐
│ Unlocked                                 │
│                                          │
│ ▸ The Left Hand of Darkness (Sci-Fi)     │
│   ┌ PatchCard ───────────────────────┐   │
│   │ (Avatar) Dana · p.142            │   │
│   │ "The betrayal here wrecked me."  │   │
│   │ EngagementBar / ReplyThreadView  │   │
│   └──────────────────────────────────┘   │
│   ┌ PatchCard ───────────────────────┐   │
│   │ (Avatar) Sam · p.150 "Called it" │   │
│   └──────────────────────────────────┘   │
│                                          │
│ ▸ Piranesi (Tuesday Readers)             │
│   ┌ PatchCard · Rey · p.88 …         ┐   │
└─────────────────────────────────────────┘

After a bump, a banner/toast (ToastCenter) on BookView / MyProgressView:
   ✨ 3 reactions unlocked   [ View ]  → pushes UnlockedView filtered to this book
```

Tapping a row deep-links to the reaction in `BookView` (highlight/scroll), same as the
web `go`/`highlight` convention.

---

## 5. DEFERRED push path (device_tokens / WS4)

**Deferred — not built in this workstream.** Documented so the storage model above is
push-ready.

The plumbing already exists: `device_tokens` (owner-only, `platform`/`environment`,
service-role read by an Edge Function) + `API+Push.swift` / `registerDeviceToken()` +
`NotificationService.swift` (permission + APNs token → `PushRegistrar` → SessionStore).
WS4 (per prior workstream naming) is the push registration layer.

### The problem push must solve without breaking the gate

A progress bump is done by the *reader themselves* on *their own device*, so the
foreground path (§2.4) already covers "I just crossed pages on this phone". Push adds value
for the **cross-device / app-closed case**: I bumped progress on the web, and my phone
(app closed) wants to nudge me that reactions opened up. Since the unlock is a consequence
of MY action, the natural trigger is a DB change on MY `reading_progress` row.

### Recommended trigger + payload

- A Postgres trigger (or Realtime-driven Edge Function) on `reading_progress` UPDATE/INSERT
  fires when `new.current_page > coalesce(old.current_page, 0)`. It computes the unlocked
  set for `new.user_id` in `(old.current_page, new.current_page]`. Running with elevated
  rights it must scope strictly to `new.user_id` and re-apply the gate itself — OR, simpler
  and safer, it just COUNTS and sends "N reactions unlocked", letting the app fetch details
  under RLS on open.
- The Edge Function looks up `device_tokens where user_id = new.user_id` (service role,
  bypassing RLS — same pattern already noted in `schema.sql`'s device_tokens comment) and
  sends an APNs push **only to the acting user's own devices**. It never pushes another
  user's content, so there is no cross-user leak surface.
- **Payload carries only a count + book reference, never reaction bodies.** The body text
  is fetched on tap under the reader's RLS. This keeps spoilers off the lock screen and
  keeps the gate as the sole authority even in the push path.
- Tapping the push deep-links to the Unlocked space (§4.2/4.3); `reaction_unlocks` rows are
  written/seen there as usual.

### Push safety checklist (for when it's built)

- Push target = `new.user_id`'s own tokens only. Never fan out to a club.
- No reaction body / author in the notification payload — count + book title at most.
- The count in the push is advisory; the authoritative list is always the RLS-gated fetch
  on open, so a stale/over-count push can never reveal a hidden reaction.
- Respect `environment` (sandbox vs production) already tracked on `device_tokens`.

---

## 6. RLS notes (summary of the gate-safety argument)

1. **`unlocked_reactions` is `SECURITY INVOKER`.** Its body runs under the caller's RLS, so
   `reactions_select_spoiler_gated` still applies. The `page` window only narrows the scan;
   it cannot return a reaction the caller couldn't already `SELECT`. This is the crux of not
   weakening the gate.
2. **`reaction_unlocks` INSERT is guarded by `reaction_visible(reaction_id)`** — the exact
   gate function already in `schema.sql`. You can only record an unlock for a reaction you
   can currently see, so the table can never be coaxed into confirming a hidden reaction.
3. **`reaction_unlocks` SELECT/UPDATE/DELETE are owner-only** (`user_id = auth.uid()`),
   modeled on `announcement_reads`. No one can read whose reactions unlocked for whom.
4. **`myUnlocks` re-joins `reactions`/`books` under RLS** and drops any row whose reaction
   is no longer visible (deleted or re-locked after a reset), so a stale unlock row can
   never surface hidden content.
5. **Push payloads carry no bodies**; details are always fetched under RLS on open.
6. Follow-path reactions are excluded from unlock detection (§1.4) — they were never
   page-gated, so they aren't "unlocked".

Net: every path that could surface a reaction routes through the same RLS the app already
trusts. This feature adds a *notification/bookkeeping* layer on top of the gate; it never
becomes a second, weaker gate.

### Schema application ritual (CLAUDE.md rule 5) — when implemented

`reaction_unlocks` + `unlocked_reactions` must be added to `supabase/schema.sql`
(idempotent: `create table if not exists`, `create or replace function`, `drop policy if
exists` before each `create policy`) and applied to **dev then prod**. `reaction_unlocks`
does NOT need adding to the `supabase_realtime` publication. No changes to existing tables
or policies are required — this is purely additive.

---

## 7. Open questions for the human

1. **Fold detection into `api.js setProgress` (recommended) vs. call it from each view?**
   Folding it in means the mixed feed / book page / progress tab all get notifications for
   free and keeps the one-place rule; the cost is `setProgress` gains a `prevPage` argument.
2. **Reset (`deleteProgress`) cleanup of stale unseen unlock rows** — do it eagerly
   (delete this book's unlock rows on reset) or leave harmless stale rows that resolve to
   nothing on tap? (§2.4)
3. **Global inbox placement on iOS** — a dedicated tab (would make 5 tabs:
   Feed/Progress/Clubs/Unlocked/Me — tight) vs. a bell in the feed header alongside
   announcements?
4. **RPC vs. plain filtered query** — both are gate-safe; confirm the RPC is worth the extra
   schema object for the single-source-of-truth win, or prefer a plain
   `.from("reactions")` query in `api.js`.
5. **Batching / noise** — if a reader bumps 200 pages at once and unlocks 40 reactions, is
   "40 reactions unlocked" the right message, or cap/summarize? (Storage handles it fine;
   this is a UX polish call.)
6. **Reviews as a future extension** — reviews unlock at `finished` (not page-gated). A
   parallel "reviews unlocked" signal could reuse this exact pattern later; explicitly out
   of scope here.
