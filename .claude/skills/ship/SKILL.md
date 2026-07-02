---
name: ship
description: Ship the current working changes through this repo's git flow — pre-check, commit, push a feature branch, and open a PR into develop; or release develop into main (prod); or PUBLISH all the way to prod in one shot. Use when the user says "ship", "ship it", "commit and PR", "open a pull request", "push these changes", "make a PR", "release to prod", or "publish".
---

# Ship

Move the current changes through The Reading Room's branch workflow safely.
**Never push to `main` directly — it's protected and auto-deploys to prod.**

## Branch model (recap)

- `main` = prod (protected, Pages deploys it). Changes land only via PR.
- `develop` = integration branch (unprotected).
- `feature/*` → PR into `develop`. Release = PR `develop` → `main`.

## Which mode?

- **"ship" / "PR" / "commit and push"** → **Mode A** (feature → develop). Stops at develop; offer to merge.
- **"release" / "deploy to prod" / "promote develop"** → **Mode B** (develop → main).
- **"publish"** → **Mode P** (all the way to prod, one shot). See below — this is the
  user's standing instruction: **"publish" means push it ALL the way so every branch
  and environment is synced. They should never have to say it twice.**

## Mode A — Ship a feature (default)

Use this for ordinary changes.

1. **Know what changed.** `git status` and `git diff --stat`. Summarize the change
   in one line; you'll reuse it for the commit + PR title.
2. **Be on a feature branch.** Check `git branch --show-current`.
   - If on `main` or `develop`: create one off the latest `develop`:
     `git switch develop && git pull && git switch -c feature/<kebab-slug>`.
   - Slug from the change, e.g. `feature/deadline-reminders`.
3. **Pre-flight checks** (don't ship broken code):
   - Syntax-check any changed JS: `node --check <file>` for each `src/**/*.js`.
   - If the change is browser-observable, follow the project's verify steps
     (serve on :5174, check console, screenshot) before shipping.
   - Confirm no secrets are staged: `git status --short` must show nothing under
     `.passwords/`, no `.env`, no `*secret*`/`service_role` keys.
4. **Commit.** Stage with `git add -A`, then commit with a clear message:
   - Subject: imperative, ≤ ~72 chars (e.g. "Add deadline reminder badges").
   - Body: what + why if non-obvious.
   - End the message with this footer (required in this environment):
     ```
     Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
     ```
5. **Push.** `git push -u origin <branch>`.
6. **Open the PR into develop:**
   ```
   gh pr create --base develop --head <branch> \
     --title "<one-line summary>" \
     --body "<body>"
   ```
   PR body should include: what changed, why, how it was verified, and end with:
   ```
   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```
7. **Report the PR URL** to the user. Offer to merge: `gh pr merge <num> --squash --delete-branch`
   (develop is unprotected, so self-merge is fine once they confirm).

## Mode B — Release to prod (develop → main)

Use when the user says "release", "deploy to prod", or "promote develop".

1. Make sure `develop` is pushed and green.
2. Open the release PR:
   ```
   gh pr create --base main --head develop \
     --title "Release: <summary of what's included>" \
     --body "<changelog-style summary>\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"
   ```
3. `main` requires a PR (enforced for admins) but needs **0 approvals**, so it can
   be self-merged: `gh pr merge <num> --merge` (use a merge commit for releases so
   history shows the release point; squash for feature PRs).
4. After merge, prod rebuilds automatically (~1–2 min) at
   https://jmalcolmo.github.io/bookclub/ . Confirm the deploy **actually shipped the
   change**, not just that a build ran:
   - `gh api repos/jmalcolmo/bookclub/pages/builds/latest --jq '.status'` → wait for
     `built` (poll; it starts as `building`), and check its `.commit` is the release commit.
   - **Grep the served file, not just the HTTP code.** `curl` a changed file with a
     cache-buster and confirm the new code is present and the old code is gone, e.g.
     `curl -s "https://jmalcolmo.github.io/bookclub/src/views/picker.js?cb=$(date +%s)" | grep -c wheelSVG`.
     A 200 only means the site is up; it does not prove the new bundle deployed.
5. Tell the user to **hard-refresh (Ctrl+Shift+R)** or use Incognito — a cached ES
   module can otherwise keep showing the old behavior even after a correct deploy.

## Mode P — Publish (all the way to prod, one shot)

Use when the user says **"publish"**. This is a standing instruction: carry the change
end to end so **every branch (feature, develop, main) and every environment (prod)
is synced** — without stopping to ask again between stages. The word "publish" IS the
confirmation for both merges. Do not merge feature→develop and then stop; keep going.

Run the whole pipeline:

1. **Mode A steps 1–6** — branch, pre-flight, commit, push, open the feature PR into
   `develop`. (Do all the pre-flight safety checks; those still apply.)
2. **Merge into develop:** `gh pr merge <num> --squash --delete-branch`.
3. **Mode B** — open the release PR `develop` → `main` and merge it
   (`gh pr merge <num> --merge`).
4. **Verify prod** per Mode B step 4 (poll build to `built`, grep the served file).
5. **Sync everything locally too**, so no branch is left behind:
   ```
   git switch develop && git pull --ff-only
   git fetch --prune                 # drop deleted remote feature branches
   git branch -d <feature-branch>    # if a local copy lingers
   ```
   Then confirm: local `develop` == `origin/develop`, and `git log origin/main..origin/develop`
   is **empty** (nothing left unreleased).
6. **Report once**, at the end: feature merged, released, prod verified serving the
   change, all branches synced. One "publish" → done.

If any stage hits a **hard safety stop** (below), pause and surface it — but that's the
only reason to interrupt a publish.

## Guardrails

- **Confirmation:** for **Mode A** ("ship"), offer the merge and let the user confirm.
  For **Mode B** ("release") and **Mode P** ("publish"), the user's word IS the
  confirmation — proceed through to prod without asking again. "Publish" specifically
  means *don't make them say it twice.*
- **Hard safety stops** (pause and surface even during a publish):
  - A staged secret: `git status --short` shows anything under `.passwords/`, a `.env`,
    or a `*secret*`/`service_role` key.
  - A pre-flight failure: `node --check` errors, or the browser-verify step shows a
    broken screen/console error.
  - A schema change not yet applied to BOTH Supabase projects and reflected in
    `supabase/schema.sql` (see CLAUDE.md) — a merged frontend expecting new columns
    will break prod.
  - A merge conflict / non-CLEAN PR mergeStateStatus.
- Don't bypass branch protection or use `--no-verify`.
