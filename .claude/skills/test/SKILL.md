---
name: test
description: Run the end-to-end action test for The Reading Room — exercises every user action except Google login against the dev database and reports pass/fail. Use when asked to test the app, run the tests, verify nothing broke, or after adding/changing a feature. New user actions MUST be added to this test.
---

# Test

Drives **every user action except Google login** (which can't be automated) through the
real **dev** Supabase project and its RLS, then reports pass/fail per action. The most
important checks are the **spoiler gate** (a reader must not receive reactions past their
progress) and the **review gate** (reviews hidden until finished).

The harness lives in `tests/run.mjs`; deps in `package.json`.

## One-time setup

Install deps once: `npm install`.

Then provision two test users in the **dev** project. Easiest is the helper:

```bash
# pre-confirmed via admin API (no emails, no rate limit) — recommended:
SUPABASE_SERVICE_ROLE="$(cat .passwords/dev-service-role.txt)" node tests/provision-users.mjs
```

`tests/provision-users.mjs` creates the users and writes `.passwords/test-users.json`
(git-ignored). Notes:
- The dev project has **"Confirm email" ON**, so plain sign-up tries to send mail and
  hits the email rate limit — that's why the **service_role** path (pre-confirmed,
  emailless) is used. The key lives in `.passwords/dev-service-role.txt` (git-ignored).
- Supabase rejects `example.com`; the helper defaults to gmail plus-addressing
  (`malcolm.olexa24+rrtesta@gmail.com` / `+rrtestb`) which is valid and self-delivering.
- Alternatives: turn off "Confirm email" in dev and run the helper without a
  service_role key, or create the two users by hand in the dashboard and write
  `.passwords/test-users.json` yourself (`{ "a": {email,password}, "b": {...} }`).

The runner also accepts `TEST_A_EMAIL/PASSWORD` + `TEST_B_EMAIL/PASSWORD` env vars
instead of the json file.

## Run

```bash
npm test
```

- Targets the **dev** project by default (override with `SUPABASE_URL` /
  `SUPABASE_PUBLISHABLE_KEY`). **Never point this at prod** — it writes and deletes data.
- Output is a ✓/✗ checklist; exit code is non-zero if any step fails. Each run uses a
  unique club name and **cleans up** by deleting the club it created (cascades).

## What it covers

sign-in (password) · Open Library lookup · create club · creator auto-membership (role 'creator') ·
find-by-code RPC · non-member cannot read club · **profile gate (non-co-member cannot read a
profile; co-member can)** · join · read club · **my clubs has no duplicates (2-member club appears once)** ·
edit club settings · **club-update gate (member cannot edit settings)** · add book · edit book
deadline · read current book + books list · log
progress · post reactions · **spoiler gate (B sees p.30, not p.200)** · author sees own ·
**reaction→progress sync (logged page can never sit below a reaction you posted)** ·
delete own reaction · **reaction-delete gate (non-author cannot delete)** ·
post reaction reply · author reads reply · **reply-delete gate (non-author cannot delete)** ·
**reply spoiler gate (reply inherits the parent
reaction's page gate — B can't see/post on a gated reaction)** · like a reaction · emoji
tapback · **engagement spoiler gate (can't like a gated reaction)** · like a club-activity item
(book) · un-like (toggle off) · **reply + engagement gates OPEN once read past the page** ·
delete own reply · progress unlocks later reactions · finish + write review ·
personal reading history includes finished book · **review gate (hidden until finished)** · review visible
after finishing · wheel selection · vote tally · finalize selection (decide winner) ·
**selection gate (non-creator cannot finalize a
selection)** · **book gate (member cannot finish the
book for the club)** · creator marks finished → history · profile update ·
**book-delete gate (member, not owner/picker, cannot delete)** · owner deletes a book ·
**announcement gate (non-admin cannot broadcast)** · **admin broadcast (admin posts, everyone
sees it, a user dismisses it)** ·
**delete gate (member cannot delete club)** · leave club · creator deletes club (cleanup).

## MAINTENANCE RULE (important)

**Every time a new user action is added to the app, add a step for it here.** When using
the `new-screen` skill, its checklist points back to this. If you add gated data, add both
a positive case (allowed sees it) and a negative case (not-allowed does NOT). Keep the
runner's step list and the "What it covers" line above in sync.

**Source of truth = `src/api.js`.** Every user action flows through one exported function
there (the views never touch the DB directly), so an exhaustive audit is: list the exports
(`grep '^export .*function' src/api.js`) and confirm each has at least one step. Non-api
actions to also cover: Open Library lookup, and the avatar/club-icon storage uploads. Pure
reads/realtime helpers (`getProfiles`, `clubMembers`, `bookProgress`, `subscribe`, …) are
exercised transitively by the membership/gate steps and don't each need a dedicated step.

## Notes

- This tests the data/RLS layer (where the real logic and the gates live) by replicating
  the same operations `src/api.js` performs — it does not import `api.js` (that's
  browser-only). If you change an action's DB behavior in `api.js`, mirror it here.
- It does not test pixel-level UI; use the preview tools + a screenshot for visual checks.
