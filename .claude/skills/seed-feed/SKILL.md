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

**Three demo clubs**, each reading a **different** set of books so the feed-first
home (and its "active clubs" rail) looks like several real clubs at once:

- 📚 **The Seed Society (demo)** — mauve — *has the one open vote*
- 🌙 **Midnight Chapters (demo)** — slate
- 🌿 **The Marginalia Club (demo)** — moss

Across all three:

- **10 fake members** with names, bios, and avatars (stable plus-addressed users
  `malcolm.olexa24+seed1..10@gmail.com`, created pre-confirmed via the admin API).
  Each club gets an overlapping subset (~6–8) of them.
- **Your real account as a member of every club** (`malcolm.olexa24@gmail.com`)
  with **deep reading progress**, so when you sign in the whole spoiler-gated feed
  is unlocked and nothing looks empty.
- **3 books per club** (9 distinct titles total) — 1 *current* + 2 *finished* —
  with real covers/page counts from Open Library. Current books have a deadline
  ~9 days out. The clubs show their **initials** (no uploaded photo) in the rail.
- **Reading progress** spread realistically (not started / mid / finished),
  backdated over the past weeks.
- **Page-tagged reactions**, each authored only by someone who has actually read
  that far — so the data stays consistent with the spoiler gate.
- **Reviews** on the finished books (from members who finished them).
- **Picker history**: each club has two decided selections (wheel + pick); **only
  the first club has a live open vote** with ballots cast.

After it runs it prints each club's **join code** and what it's reading.

## Re-running

Re-running **resets and reseeds the same three clubs**: it keeps each club row (so
ids and join codes stay stable) and wipes its books and selections — cascades
clear the old reactions/progress/reviews/votes — then repopulates fresh. No
clutter buildup. A deterministic RNG keeps each reseed similar.

## Important notes

- **Dev only — production can never be seeded.** Three independent gates must all
  pass before it writes anything: (1) the endpoint URL is the dev project
  (`wwzvwjhohkyudytoqvfl`), (2) the `service_role` key's own JWT `ref` claim is the
  dev project, and (3) neither the URL nor the key references the prod project
  (`kxiyvqpmmfbibeoygmnw`). Any mismatch aborts with a loud `REFUSING TO RUN`. So
  even deliberately passing a prod URL + prod key is refused. The seeder is also
  inert on the live site — `index.html` never imports it, so merging it to `main`
  causes no seeding in prod; it only runs when you manually invoke `npm run seed`
  locally with the git-ignored dev key.
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
