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
- **"publish"** → **Mode P** (EVERYTHING to prod, one shot). "Publish" means every change
  reaches prod and **nothing is left on `develop` ahead of `main`**. The ONLY thing that
  may hold a change back is a **security concern** — never docs, skills, config, or "it
  doesn't need deploying". They should never have to say it twice.

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
   - **Schema check (report-only):** if `git diff --name-only origin/main...origin/develop`
     includes `supabase/schema.sql`, flag in your summary that it must be applied to BOTH
     Supabase projects (see Mode P step 3). Never blocks.
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

## Mode P — Publish (EVERYTHING to prod, one shot)

Use when the user says **"publish"**. Publish is absolute: **get everything to prod and
leave NOTHING behind.** When you finish, `develop` and `main` are identical, prod serves
it, and there are no open PRs waiting (except ones git physically can't merge). "Publish"
is the standing confirmation for **every** merge in the pipeline — never stop to ask
again, never narrow the scope to "just this change", and never decide something "doesn't
need" to ship. Docs, skills, and config all ship. The user removes anything they didn't
want; your only job is to get it all out.

Sweep all of it in one pass:

1. **The working change**, if any — Mode A steps 1–6 (branch, commit, push, PR into
   `develop`), then merge it: `gh pr merge <num> --squash --delete-branch`.
2. **Every OTHER open PR into `develop`** — merge each one too, not just yours. List them
   first (`gh pr list --state open --base develop --json number,title,mergeStateStatus`)
   and merge each CLEAN one: `gh pr merge <num> --squash --delete-branch`. Leave a PR
   only if git blocks it (see Guardrails) — never by choice.
3. **Schema-awareness scan (REPORT-ONLY — never blocks a publish).** Prod has its own
   Supabase project; a schema change applied to dev but not prod will break the released
   frontend (CLAUDE.md rule 5), and no test catches it because tests run on dev. Detect it:
   ```
   git fetch -q
   git diff --name-only origin/main...origin/develop | grep -qx supabase/schema.sql && echo "SCHEMA CHANGED" || echo "no schema changes"
   ```
   - If it says **no schema changes**, note that and move on.
   - If **SCHEMA CHANGED**, capture what changed
     (`git diff origin/main...origin/develop -- supabase/schema.sql`). If a prod
     service_role key exists (`.passwords/prod-service-role.txt`), optionally spot-check
     that the changed tables/columns/policies already exist in prod (see the
     `supabase-change` skill) — read-only, never a migration from here. Either way, do NOT
     halt: carry a **loud reminder** into the final report — *"This release changes
     schema.sql; apply it to BOTH dev and prod, or prod will break."*
4. **Drain `develop` → `main`** — open ONE release PR `develop` → `main` and merge it with
   a merge commit (`gh pr merge <num> --merge`). This releases EVERYTHING on develop,
   including work merged there before this publish. Do not cherry-pick; release all of it.
5. **Verify prod** per Mode B step 4 — poll the Pages build to `built` and confirm its
   `.commit` is the release commit, then `curl` a changed file with a cache-buster and
   confirm the new code is served.
6. **Sync + PROVE nothing is left.** Run:
   ```
   git switch develop && git pull --ff-only
   git switch main && git pull --ff-only
   git fetch --prune
   ```
   Then assert ALL of these — if any fails, you are NOT done, go finish:
   - `git log origin/main..origin/develop` is **empty** (develop is not ahead of main).
   - `origin/develop` and `origin/main` point at the same tree.
   - `gh pr list --state open` shows **0** (or only PRs git physically can't merge).
7. **Report once**, at the end: what shipped, prod verified serving it, `develop == main`,
   zero open PRs, and the **schema-scan result** (the loud reminder if schema.sql changed).
   Then remind the user to hard-refresh (Ctrl+Shift+R) for anything browser-observable.

**Never** end a publish with a note that something was left behind. If you are about to
write *"one thing to note: X wasn't released"*, the publish is NOT finished — go release
X. A finished publish has nothing to note, because nothing is behind.

## Mode R — Roll back prod (undo a bad release)

Use when a release broke prod and the user says "roll back", "revert prod", "undo the
release". Goal: make prod good again FAST, then keep `develop == main` so the bad change
doesn't sail right back out on the next publish.

1. **Find what to undo.** The latest release on `main`:
   ```
   git fetch -q
   git log --merges --oneline origin/main -5    # top "Merge pull request #NN" is usually the release
   ```
   Note the SHA. Revert the **merge** to back out the whole release, or revert a specific
   commit to back out just that.
2. **Revert on a hotfix branch** (`main` is PR-only, so no direct push):
   ```
   git switch main && git pull --ff-only
   git switch -c hotfix/rollback-<slug>
   git revert -m 1 <release-merge-sha>          # -m 1 keeps main's prior state, drops what the merge added
   #   or: git revert <bad-commit-sha>          # targeted single-commit undo
   git push -u origin hotfix/rollback-<slug>
   ```
3. **PR into main and merge** (a revert is a normal change; 0 approvals needed):
   ```
   gh pr create --base main --head hotfix/rollback-<slug> --title "Rollback: <what>" --body "Reverts <sha> — <why>"
   gh pr merge <num> --merge
   ```
4. **Verify prod recovered** per Mode B step 4 — poll the build to `built` on the revert
   commit, then `curl` a changed file and confirm the BAD code is gone.
5. **Re-sync develop, or the bad change comes right back.** The revert landed on `main`,
   but `develop` still has the bad commits — the next publish would re-ship them. Pull the
   revert into develop:
   ```
   git switch develop && git pull --ff-only
   git merge origin/main
   git push
   ```
   Confirm `git log origin/main..origin/develop` is empty (develop == main again).
6. **Report:** what was rolled back, prod verified recovered, develop re-synced. If the
   change should return once fixed, note that a revert can itself be reverted to bring it
   back.

## Guardrails

- **The ONLY reason to hold anything back from a publish is a SECURITY concern.** Nothing
  else — not docs, not a skill/config change, not "low value", not "doesn't need
  deploying", not a failing check — is grounds to leave work on `develop`. Publish means
  publish.
  - **Security stop (the one hard stop):** a staged or committed secret — anything under
    `.passwords/`, a `.env`, or a `*secret*`/`service_role` key showing in the diff or
    `git status --short`. Pause, surface it, and do NOT push it to prod.
- **Confirmation:** the word "publish" IS the confirmation for every merge in the
  pipeline — do not ask again between stages. (Mode A "ship" still offers the single merge
  and waits; Mode B "release" proceeds on the user's word.)
- **Pre-flight is report-only during a publish.** Run `node --check` on changed JS (and
  the browser verify if relevant) and REPORT any failure — but a failing check does NOT
  halt a publish. The user owns that tradeoff and will revert if needed. Only a security
  stop halts.
- **Schema changes: report, don't block.** If a release includes a schema change not yet
  applied to BOTH Supabase projects (CLAUDE.md rule 5), flag it in the final report — but
  still publish.
- **Physically blocked ≠ left behind by choice.** The only work that may remain after a
  publish is a PR git literally cannot merge (a merge conflict / non-CLEAN
  mergeStateStatus). Surface it clearly and publish everything else. Never *choose* to
  leave anything.
- Don't bypass branch protection or use `--no-verify`.
