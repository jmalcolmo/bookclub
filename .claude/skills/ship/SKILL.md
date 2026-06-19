---
name: ship
description: Ship the current working changes through this repo's git flow — pre-check, commit, push a feature branch, and open a PR into develop; or release develop into main (prod). Use when the user says "ship", "ship it", "commit and PR", "open a pull request", "push these changes", "make a PR", or "release to prod".
---

# Ship

Move the current changes through The Reading Room's branch workflow safely.
**Never push to `main` directly — it's protected and auto-deploys to prod.**

## Branch model (recap)

- `main` = prod (protected, Pages deploys it). Changes land only via PR.
- `develop` = integration branch (unprotected).
- `feature/*` → PR into `develop`. Release = PR `develop` → `main`.

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
   https://jmalcolmo.github.io/bookclub/ . Confirm with:
   `gh api repos/jmalcolmo/bookclub/pages/builds/latest --jq '.status'` → `built`,
   then a quick `curl -s -o /dev/null -w "%{http_code}"` on the prod URL.

## Guardrails

- Stop and ask before merging if the user hasn't confirmed.
- If a schema change is part of this work, it must already be applied to BOTH
  Supabase projects and reflected in `supabase/schema.sql` (see CLAUDE.md). Flag it
  if not — a merged frontend that expects new columns will break prod.
- Don't bypass branch protection or use `--no-verify`.
