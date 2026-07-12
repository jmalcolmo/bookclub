---
name: fleet
description: Orchestrate a multi-workstream plan across parallel git-worktree sub-agents, then hand back an audit trail for one batch review. Use when the user says "run the fleet", "orchestrate the plan", "execute the workstreams", "run the plan file", "fan this plan out", or points at a workstreams/waves plan file and says "do it" / "run it end to end". Turns the current session into an unattended orchestrator that dispatches workers, merges each into develop, cleans up, and stops at the develop→main gate for human review.
---

# Fleet - plan orchestrator

Take a plan made of **workstreams grouped into waves** and execute it end to end with as
little human involvement as possible. You (this session) are the **orchestrator**: you hold
the plan and a running log; the actual coding happens in **background sub-agents, each in its
own git worktree**, that you hand a single scoped task. You never write feature code yourself.

**Read `CLAUDE.md` first** for the branch model and invariants, then **read
`docs/fleet-contract.md`** - it is the single source of truth for the plan format and the
safety invariants. You are the *consumer* side of that contract; `/plan-compile` is the
producer. Do not keep a private copy of the invariant rules here; enforce the ones in the
contract so the two skills can never drift.

## Golden rules (never break these)

1. **Never merge to `main`. Never push to `main`.** The day ends at an *open* `develop → main`
   PR that a human reviews and merges. That gate is the point of the whole run.
2. **Never apply schema to the PROD Supabase project.** Workers may migrate the shared **dev**
   project only. Prod schema happens at release, by a human.
3. **One DB-migrating workstream at a time.** All local sessions share one dev database, so two
   concurrent `supabase/schema.sql` migrations corrupt each other. Serialize them even if their
   files wouldn't collide.
4. **Respect `depends_on` and shared-file collisions.** A workstream starts only after every
   stream it depends on is merged into `develop`. Two streams that edit the same file never run
   in the same wave.
5. **Feature work goes worker → PR → `develop`.** You merge into `develop` (unprotected) via
   `gh pr merge --squash --delete-branch` - which also deletes the branch, so no manual cleanup.
6. **Workers never build, launch a simulator, run the app, or run test suites.** Verification is
   the human's job. Workers self-review their diff and write **clean, manual test steps** into
   the audit trail; they must not run `xcodebuild`, boot an iOS simulator, run `ReadingRoomTests`,
   the `test` skill, or otherwise execute the app. Running builds/sims wastes tokens and is
   explicitly unwanted.

## Input

One argument: a path to a plan file (default: ask). Expect it to contain a **compiled
`fleet-plan` block** conforming to `docs/fleet-contract.md`.

1. **Check `contract_version`** against the contract file. On mismatch, stop and tell the user
   to re-run `/plan-compile`.
2. **Re-validate every invariant** in the contract against the block (belt-and-suspenders - you
   never assume a plan was compiled): no shared files within a wave, one DB migration per wave,
   acyclic dependencies with correct wave ordering, complete boundaries + seeds, no forbidden
   targets. If any fails, **refuse to dispatch** and report the violation.
3. If the file has **no `fleet-plan` block** (raw/uncompiled plan), stop and tell the user to run
   `/plan-compile <plan>` first. Do not improvise a schedule from prose - that's the compiler's
   job and its validation is the safety net.

Echo the validated wave plan back and **pause for one confirmation** before the first dispatch.
After that, run unattended.

## Setup (once, before wave 1)

1. `git fetch origin`, ensure `develop` is current: `git switch develop && git pull`.
2. Detect already-in-progress work: `git worktree list` and `git branch --list 'feature/*'`.
   If a workstream's branch already exists (e.g. the user started one by hand), **adopt** it -
   don't recreate it; wait for/verify it, then merge it in its wave slot. Report what you adopted.
3. Open a run log at `scratchpad/fleet-log.md` (append-only): timestamp, wave, workstream,
   status, PR URL, test result, notes. This is the user's audit trail.

## Per-wave loop

For each wave, in order:

1. **Dispatch every workstream in the wave at once** (one message, multiple `Agent` calls) as
   **background** workers with **`isolation: "worktree"`**. Give each worker the prompt template
   below and nothing else - a cold, tightly-scoped context (do NOT paste the whole plan). Pick
   `model: opus` for feature-heavy streams, `sonnet` for mechanical ones.
2. **Wait** for their completion notifications. Do not poll on a short timer; you are re-invoked
   when a background worker finishes. If a worker has produced no signal for a long time, check it
   with the task tools and, if hung, mark it **blocked** and move on.
3. **On each worker success:** open its PR into `develop` and merge:
   `gh pr merge <n> --squash --delete-branch` (or invoke the `ship` skill's Mode A). Then
   `git worktree remove` its worktree if the Agent didn't auto-clean it. Log it.
4. **On each worker error / unclean self-review:** do **not** merge. Quarantine it - leave the
   branch, log the reason, and **skip any workstream that depends on it**. Continue with
   independent streams. (Workers do not run builds/tests; a "pass" means a clean diff + self-review
   + written manual test steps, not an executed test.)
5. Before starting the next wave: `git switch develop && git pull` so the next wave branches off
   everything merged so far.

## Worker prompt template

Hand each worker exactly this shape (fill the braces from the plan):

> You are implementing ONE workstream of a larger plan, alone, in your own git worktree.
> Read `CLAUDE.md` for conventions and invariants (spoiler-gate, api.js boundary, escape user
> input, realtime cleanup, schema applied to dev then reflected in `supabase/schema.sql`).
>
> **Task:** {task_prompt_seed}
>
> **Stay strictly within these files - touch nothing else:** {file_boundaries}
>
> **Branch:** create/commit on `{branch}` (off `develop`).
> **Do NOT build, launch a simulator, run the app, or run any test suite** (`xcodebuild`, iOS
> simulators, `ReadingRoomTests`, the `test` skill, `devserver`). Verification is done manually
> by the human - your job is to make that easy, not to run it.
> **When done:** (1) Self-review your diff for correctness against the task and `CLAUDE.md`
> invariants. (2) Write **precise manual test steps** into your report and `scratchpad/fleet-log.md`
> - for iOS: the scheme/target to build and the exact in-app actions + expected results; for web:
> the route/page, the exact clicks, and expected results, plus any dev-Supabase data setup needed.
> (3) If your change touches the database, apply it to the **dev** Supabase project only and update
> `supabase/schema.sql`; never touch prod. (4) Commit and push `{branch}`. (5) Report what you
> changed, the manual test steps, and anything else a human must check (e.g. Google OAuth, a
> real-device push). Do NOT open a PR or merge - the orchestrator does that.

## Human seams (flag, don't fake)

All verification here is manual - workers write the steps, the human runs them. Everything the
human must check goes into the log as a **`NEEDS-HUMAN`** item with its exact test steps; still
merge the code on a clean diff + self-review. Especially call out:
- iOS build/run of any kind (the whole target - workers never build it).
- Google OAuth sign-in (needs a real browser session).
- Real-device push delivery (APNs).
- Anything requiring the prod database or an Apple Developer signing asset.

## Finish

When all waves are done (or blocked):
1. Post a summary to `scratchpad/fleet-log.md` and to the user: per-workstream status, PR links,
   `NEEDS-HUMAN` items, and anything quarantined.
2. Open the release PR **but do not merge**: `gh pr create --base main --head develop …`
   (or `ship` Mode B up to the PR step). Give the user the URL.
3. Stop. The user reviews the full `develop → main` diff and merges when satisfied.
