# Fleet Orchestration Contract — v1

The shared agreement between three parties in the plan → compile → run pipeline:

- **You (author):** plan freely, in whatever prose/structure you think best.
- **`/plan-compile` (producer):** turns your freeform plan into the canonical **fleet-plan
  block** below, and validates the safety invariants. Emits errors you must resolve.
- **`/fleet` (consumer):** executes a fleet-plan block. Before dispatching it **re-validates**
  against this same contract — it never assumes a plan was compiled.

Both skills READ this file so their rules can't drift apart. If you change a rule here, both
sides pick it up. Bump `contract_version` when you make a breaking change.

---

## The canonical fleet-plan block

`/plan-compile` emits exactly one fenced block, tagged `fleet-plan`, in YAML. `/fleet` looks
for this block in the file it's pointed at. Freeform prose may surround it and is ignored by
the orchestrator (it's for humans).

```fleet-plan
contract_version: 1
project: the-reading-room
integration_branch: develop      # feature branches merge here; NEVER main
release_target: main             # only a human merges develop -> main
workstreams:
  - id: WS1                      # stable short id, referenced by depends_on
    title: iOS theme fonts
    branch: feature/ios-theme-fonts
    target: ios                  # web | ios | both  (drives verify defaults)
    model: opus                  # opus | sonnet  (feature-heavy -> opus)
    db_migration: false          # true iff file_boundaries include supabase/schema.sql
    file_boundaries:             # EXPLICIT paths/globs; the collision check runs on these
      - ios/ReadingRoom/Theme/**
      - ios/ReadingRoom/App/ReadingRoomApp.swift
      - ios/ReadingRoom/Views/**       # (scoped: only font edits)
    depends_on: []               # ids that must be merged first
    seed: >                      # 2-3 sentences handed to the worker verbatim
      Make every piece of readable text in the iOS app use the theme fonts
      (Crimson Pro / DM Mono) instead of the default system font ...
waves:                           # ordered; each wave runs concurrently
  - [WS1]
  - [WS2, WS5]
  - [WS3]
  - [WS4]
  - [WS6]
  - [WS7]
```

### Required fields per workstream
`id`, `branch`, `file_boundaries` (non-empty), `db_migration`, `depends_on`, `seed`.
`title`, `target`, `model`, `verify` are optional (sensible defaults applied).

---

## Safety invariants (enforced by BOTH compile and fleet)

A plan is **valid to run** only if all hold. Violations are hard errors — resolve them at
compile time, not by hoping the orchestrator copes.

1. **No shared files within a wave.** For any two workstreams in the same wave, their
   `file_boundaries` must not overlap (no path/glob intersection). Overlap → conflicts.
2. **One DB migration per wave.** At most one workstream per wave with `db_migration: true`.
   All local sessions share one dev database; two concurrent `schema.sql` migrations corrupt
   each other.
3. **Dependencies precede.** `depends_on` is acyclic, and every workstream's wave index is
   strictly greater than the wave index of each of its dependencies.
4. **Completeness.** Every workstream has non-empty `file_boundaries` and a non-empty `seed`.
5. **No forbidden targets.** `file_boundaries` may not include prod-only or release-gated
   paths, and no workstream targets `main` or the prod Supabase project.

If `/plan-compile` cannot satisfy these automatically (e.g. two streams genuinely need the
same file), it reports the conflict and asks you to split, reorder, or serialize — it does not
silently guess.

---

## Execution guarantees (what `/fleet` promises)

- Each workstream runs as a background sub-agent in its **own git worktree**, handed only its
  `seed` + `file_boundaries` (cold, scoped context).
- Success path: worker → PR → **squash-merge into `integration_branch`** with branch delete.
- **Never merges or pushes to `release_target` (`main`). Never applies schema to prod.**
- Failure path: quarantine the branch, **skip its dependents**, keep going.
- Human seams (Google OAuth, real-device push, prod schema, signing assets) are **flagged as
  `NEEDS-HUMAN`**, never faked.
- Everything is logged to `scratchpad/fleet-log.md` (the audit trail).
- The run ends at an **open `develop → main` PR** for your one batch review.

---

## Versioning

`contract_version` in the block must match the `v` in this file's title. On mismatch, `/fleet`
refuses and tells you to re-run `/plan-compile`. This is what makes the pipeline safe across
machines and across time.
