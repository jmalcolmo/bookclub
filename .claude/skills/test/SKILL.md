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

1. Create two confirmed test users in the **dev** project
   (`wwzvwjhohkyudytoqvfl`) → Authentication → Users → **Add user** (twice).
2. Save their creds to `.passwords/test-users.json` (git-ignored):
   ```json
   { "a": { "email": "...", "password": "..." },
     "b": { "email": "...", "password": "..." } }
   ```
   (Or set `TEST_A_EMAIL` / `TEST_A_PASSWORD` / `TEST_B_EMAIL` / `TEST_B_PASSWORD`.)
3. Install deps once: `npm install`.

> Optional: set `SUPABASE_SERVICE_ROLE` (from dev → Settings → API, keep it in
> `.passwords`, never commit) and the runner will auto-create the two users for you.

## Run

```bash
npm test
```

- Targets the **dev** project by default (override with `SUPABASE_URL` /
  `SUPABASE_PUBLISHABLE_KEY`). **Never point this at prod** — it writes and deletes data.
- Output is a ✓/✗ checklist; exit code is non-zero if any step fails. Each run uses a
  unique club name and **cleans up** by deleting the club it created (cascades).

## What it covers

sign-in (password) · Open Library lookup · create club · owner auto-membership ·
find-by-code RPC · non-member cannot read club · join · read club · add book · log
progress · post reactions · **spoiler gate (B sees p.30, not p.200)** · author sees own ·
progress unlocks later reactions · **review gate (hidden until finished)** · review visible
after finishing · wheel selection · vote tally · mark finished → history · profile update ·
leave club · cleanup.

## MAINTENANCE RULE (important)

**Every time a new user action is added to the app, add a step for it here.** When using
the `new-screen` skill, its checklist points back to this. If you add gated data, add both
a positive case (allowed sees it) and a negative case (not-allowed does NOT). Keep the
runner's step list and the "What it covers" line above in sync.

## Notes

- This tests the data/RLS layer (where the real logic and the gates live) by replicating
  the same operations `src/api.js` performs — it does not import `api.js` (that's
  browser-only). If you change an action's DB behavior in `api.js`, mirror it here.
- It does not test pixel-level UI; use the preview tools + a screenshot for visual checks.
