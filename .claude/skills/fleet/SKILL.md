---
name: fleet
description: Orchestrate a multi-workstream plan across parallel git-worktree sub-agents, then hand back an audit trail for one batch review. Use when the user says "run the fleet", "orchestrate the plan", "execute the workstreams", "run the plan file", "fan this plan out", or points at a workstreams/waves plan file and says "do it" / "run it end to end". Turns the current session into an unattended orchestrator that dispatches workers, merges each into develop, cleans up, and stops at the develop→main gate for human review.
---

# Fleet — plan orchestrator

Take a plan made of **workstreams grouped into waves** and execute it end to end with as
little human involvement as possible. You (this session) are the **orchestrator**: you hold
the plan and a running log; the actual coding happens in **background sub-agents, each in its
own git worktree**, that you hand a single scoped task. You never write feature code yourself.

**Read `CLAUDE.md` first** for the branch model and invariants.

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
   `gh pr merge --squash --delete-branch` — which also deletes the branch, so no manual cleanup.

## Input

One argument: a path to a plan file (default: ask). The plan must contain, for each workstream:
`branch`, `worktree`, `file_boundaries`, `depends_on`, and a `task_prompt_seed`. It should also
contain a **wave/schedule** (which streams run together vs solo). If no explicit schedule is
present, derive one:
- Group by `depends_on` (topological order).
- Flag any stream whose boundaries include `supabase/schema.sql` as **DB-migrating**; never put
  two of those in the same wave.
- Never co-schedule streams that share any file in their `file_boundaries`.
- Prefer isolation over parallelism when in doubt.

Echo the derived wave plan back and **pause for one confirmation** before the first dispatch.
After that, run unattended.

## Setup (once, before wave 1)

1. `git fetch origin`, ensure `develop` is current: `git switch develop && git pull`.
2. Detect already-in-progress work: `git worktree list` and `git branch --list 'feature/*'`.
   If a workstream's branch already exists (e.g. the user started one by hand), **adopt** it —
   don't recreate it; wait for/verify it, then merge it in its wave slot. Report what you adopted.
3. Open a run log at `scratchpad/fleet-log.md` (append-only): timestamp, wave, workstream,
   status, PR URL, test result, notes. This is the user's audit trail.

## Per-wave loop

For each wave, in order:

1. **Dispatch every workstream in the wave at once** (one message, multiple `Agent` calls) as
   **background** workers with **`isolation: "worktree"`**. Give each worker the prompt template
   below and nothing else — a cold, tightly-scoped context (do NOT paste the whole plan). Pick
   `model: opus` for feature-heavy streams, `sonnet` for mechanical ones.
2. **Wait** for their completion notifications. Do not poll on a short timer; you are re-invoked
   when a background worker finishes. If a worker has produced no signal for a long time, check it
   with the task tools and, if hung, mark it **blocked** and move on.
3. **On each worker success:** open its PR into `develop` and merge:
   `gh pr merge <n> --squash --delete-branch` (or invoke the `ship` skill's Mode A). Then
   `git worktree remove` its worktree if the Agent didn't auto-clean it. Log it.
4. **On each worker failure / failed verification:** do **not** merge. Quarantine it — leave the
   branch, log the reason, and **skip any workstream that depends on it**. Continue with
   independent streams.
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
> **Stay strictly within these files — touch nothing else:** {file_boundaries}
>
> **Branch:** create/commit on `{branch}` (off `develop`).
> **When done:** (1) verify — web: `python devserver.py <free-port>` boots clean + run the
> `test` skill; iOS: build the xcodeproj + run `ReadingRoomTests`. (2) If your change touches the
> database, apply it to the **dev** Supabase project only and update `supabase/schema.sql`; never
> touch prod. (3) Commit and push `{branch}`. (4) Report back: what you changed, the verification
> result, and anything a human must check by hand (e.g. Google OAuth, a real-device push).
> Do NOT open a PR or merge — the orchestrator does that.

## Human seams (flag, don't fake)

Some things can't be verified headless. When a worker reports one, **log it as
`NEEDS-HUMAN`** and still merge the code if it otherwise passed:
- Google OAuth sign-in (needs a real browser session).
- Real-device push delivery (WS-style push/APNs tasks) — you can confirm it builds and registers,
  not that a notification landed on a phone.
- Anything requiring the prod database or an Apple Developer signing asset.

## Finish

When all waves are done (or blocked):
1. Post a summary to `scratchpad/fleet-log.md` and to the user: per-workstream status, PR links,
   `NEEDS-HUMAN` items, and anything quarantined.
2. Open the release PR **but do not merge**: `gh pr create --base main --head develop …`
   (or `ship` Mode B up to the PR step). Give the user the URL.
3. Stop. The user reviews the full `develop → main` diff and merges when satisfied.
