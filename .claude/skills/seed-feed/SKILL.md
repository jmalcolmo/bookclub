---
name: seed-feed
description: Populate the DEV database with a busy, believable book club so the main feed looks alive — many fake members, a current book plus finished history, lots of reading-progress at different points, lots of page-tagged reactions, reviews, and picker history. Use when asked to seed the feed, fill the dev site with fake data, generate demo/test content, or make the app look populated for screenshots or manual testing.
---

# Seed Feed

Generates a full, realistic book club in the **dev** Supabase project so the app's
feed (reactions stream, members & progress, history) looks like a real, active club
instead of an empty shell. For demos, screenshots, and eyeballing layout under load.

This is a **data generator**, not a test — do not confuse it with the `test` skill
(that one uses the anon key to *verify* RLS; this one uses the service_role key to
*write* a lot of data quickly).

## Run

```bash
npm install   # once, if node_modules is missing
npm run seed
```

That's it. The script (`tests/seed-feed.mjs`) reads the dev `service_role` key from
`.passwords/dev-service-role.txt` automatically.

## What it creates

A fixed demo club — **"📚 The Seed Society (demo)"** — containing:

- **10 fake members** with names, bios, and avatars (stable plus-addressed users
  `malcolm.olexa24+seed1..10@gmail.com`, created pre-confirmed via the admin API).
- **Your real account as the owner** (`malcolm.olexa24@gmail.com`) with **deep
  reading progress**, so when you sign in on the dev site the whole spoiler-gated
  feed is unlocked for you and nothing looks empty.
- **6 books** — 1 *current* + 5 *finished* — with real covers/page counts pulled
  live from Open Library. The current book has a deadline ~9 days out.
- **Reading progress** spread realistically across members (not started / mid /
  finished), backdated over the past weeks.
- **~70+ page-tagged reactions**, each authored only by someone who has actually
  read that far — so the data stays consistent with the spoiler gate.
- **Reviews** on the finished books (from members who finished them).
- **Picker history**: two decided selections (wheel + pick) and one open vote with
  ballots cast.

After it runs it prints the club's **join code** and a reminder of how to view it.

## Re-running

Re-running **resets and reseeds the same club**: it keeps the club row (so the id
and join code stay stable) and wipes its books and selections — cascades clear the
old reactions/progress/reviews/votes — then repopulates fresh. No clutter buildup.
A deterministic RNG keeps each reseed similar.

## Important notes

- **Dev only.** The script hard-refuses to run unless it is pointed at the dev
  project (`wwzvwjhohkyudytoqvfl`). Never aim it at prod.
- **Your account must exist as a dev user to be added as owner.** A Supabase auth
  user is only created on first sign-in. If you've never signed into the **dev**
  site with Google, the script will say so and seed the club without you — sign in
  once via Google on the dev site, then rerun `npm run seed` (or just join the club
  with the printed code).
- **Bypasses RLS by design.** Because it writes as many users, it uses the
  service_role key. That's why it can set each reaction's author and timestamp. The
  app itself (and the `test` skill) still go through RLS — this only seeds the data.
- It writes through the same tables `src/api.js` uses, so if you add a new feed-
  bearing table/column, extend the relevant section of `tests/seed-feed.mjs` to
  populate it too (and keep the spoiler-gate consistency: only let a user author a
  reaction at a page they've read to).
