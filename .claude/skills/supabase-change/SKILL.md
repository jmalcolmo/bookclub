---
name: supabase-change
description: Safely change the Supabase database for The Reading Room — tables, columns, RLS policies, functions, storage. Use when adding/altering DB schema, writing or editing Row-Level Security policies, adding a table or column the app needs, or touching anything in supabase/schema.sql. Enforces the spoiler-gate invariant and the dev→prod apply ritual.
---

# Supabase change

The database is the riskiest surface in this app: auth + the **spoiler gate** live in
Row-Level Security. A bad policy leaks spoilers or private data. Follow this exactly.

## Invariants — never break these

1. **Spoiler gate (reactions).** The `reactions` SELECT policy must only return a row
   when the reader wrote it OR their `reading_progress.current_page >= reactions.page`,
   AND they're a club member. Any change near `reactions` must preserve this.
2. **Reviews are full spoilers.** Visible only to the author or members whose progress
   `status = 'finished'`.
3. **Membership-scoped reads.** Club data (books, progress, reactions, reviews,
   selections, votes) is readable only by members of that club. Use the
   `is_club_member()` / `book_club()` helpers — never inline a subquery that could
   recurse on `club_members`.
4. **Join codes are private.** Non-members discover a club only via the
   `find_club_by_code` SECURITY DEFINER RPC, never by selecting from `clubs`.
5. **No secrets client-side.** Only the publishable key is used by the app. Never add a
   policy that requires the service_role key for normal app flows.

## How to make a change

1. **Edit `supabase/schema.sql`** as the single source of truth. Keep it **idempotent**:
   - tables: `create table if not exists`
   - policies: `drop policy if exists "x" on t;` then `create policy "x" ...`
   - functions/triggers: `create or replace` / `drop trigger if exists` then create
   - The file must remain safe to re-run top-to-bottom on a fresh project.
2. **Mind ordering.** Helper functions reference tables defined later, so
   `set check_function_bodies = off;` stays near the top. If you add a helper that
   other policies use, define it before those policies (or rely on the off setting).
3. **Realtime + storage.** If a new table should stream to clients, add it to the
   `supabase_realtime` publication block. New public assets → add a storage bucket +
   policies following the existing pattern.

## Apply to BOTH projects (dev first, then prod)

Schema is hand-applied; dev and prod must stay in parity.

- **Preferred (SQL editor):** paste the full updated `supabase/schema.sql` into the
  SQL Editor of the **dev** project and run → expect "Success. No rows returned."
  Test the app on localhost. Only then run the same in **prod**.
- Project refs: dev `wwzvwjhohkyudytoqvfl`, prod `kxiyvqpmmfbibeoygmnw`.
- **Never** apply to prod before dev is verified.
- If the app code (api.js / views) depends on the new schema, the schema must be
  applied to prod **before** the frontend PR merges to `main` — otherwise prod breaks.
  Call this out explicitly when shipping (the `ship` skill checks for it).

## Verify

1. After applying to dev, run the `test` skill — it exercises RLS end-to-end,
   including the spoiler gate, against the dev project.
2. For a new policy, reason through it as an attacker: "as a non-member / a member who
   hasn't read far enough, can I read this row?" If yes and shouldn't, fix it.
3. Add or update assertions in the `test` skill for any new gated data.

## Optional: migration files

If you outgrow hand-applied schema, adopt the Supabase CLI: keep ordered files in
`supabase/migrations/`, `supabase link --project-ref <ref>` per project, and
`supabase db push`. Until then, `supabase/schema.sql` is the contract.
