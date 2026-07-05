---
name: plan-compile
description: Turn a freeform multi-workstream plan into the canonical fleet-plan block and validate it against the orchestration contract before any tokens are spent running it. Use when the user says "compile the plan", "make this importable into fleet", "validate my plan", "prep this plan for the orchestrator", or points at a plan file and asks whether it's safe to run in parallel. Emits the machine-readable plan plus a report of what it fixed and what you must resolve.
---

# Plan-compile — the bridge from freeform plan to runnable fleet-plan

You convert a human's freeform plan into the **canonical `fleet-plan` block** and **validate
the safety invariants** defined in `docs/fleet-contract.md`. You are the producer side of the
handshake; `/fleet` is the consumer. Your real value is the validation — catching the
expensive mistakes now, while the user is still in planning headspace.

**Read `docs/fleet-contract.md` first, every time.** It is the single source of truth for the
block format, the required fields, and the invariants. Do not hardcode a private copy of the
rules here — read them from the contract so the two never drift.

## Input

A path to a plan file (default: ask). The plan may be prose, tables, `WORKSTREAM` blocks,
anything. Your job is to extract the structure, not to demand a format.

## Procedure

1. **Read the contract**, then read the plan file.
2. **Extract one workstream per unit of work.** For each, pull `id`, `branch`, `title`,
   `file_boundaries`, `depends_on`, `seed`. Infer what's inferable:
   - `db_migration: true` iff any boundary includes `supabase/schema.sql`.
   - `target` from the boundaries (`ios/**` → ios, `src/**`/root → web, both → both).
   - `model`: opus for feature-heavy streams, sonnet for mechanical/CSS/config.
   - If `file_boundaries` are vague ("the profile view"), resolve them to concrete repo
     paths by inspecting the tree; if you cannot, flag it — do not invent boundaries.
3. **Assign waves** (respecting the contract's invariants, in this priority):
   - Topologically order by `depends_on` (a stream's wave index > all its deps').
   - Within an eligible set, never co-schedule two streams whose boundaries overlap.
   - Never place two `db_migration: true` streams in the same wave.
   - Prefer isolation over parallelism when uncertain.
4. **Validate** every invariant in the contract. For each violation, don't silently fix by
   guessing — surface it:
   - overlapping boundaries in a wave → split into separate waves or ask the user to narrow one;
   - two DB migrations colliding → serialize them;
   - cyclic//unsatisfiable `depends_on` → report the cycle;
   - missing boundaries or seed → ask the user to supply.
5. **Emit** the `fleet-plan` block. By default append it to the source plan file under a
   `## Compiled fleet-plan` heading (or write a sibling `<plan>.fleet.md` if the user prefers).
   Keep the human prose above it intact.
6. **Report** — print a short summary the user reviews:
   - the wave schedule (a table: wave · workstreams · which is the DB stream);
   - what you inferred (db flags, targets, models);
   - what you normalized/renamed;
   - **BLOCKERS** the user must resolve before `/fleet` will run it (if any).

## Guardrails

- **Never widen a workstream's boundaries to make a conflict disappear.** If two streams must
  touch the same file, the honest outputs are: sequence them, or merge them into one stream.
- **Never emit a block that fails an invariant.** A compiled plan is a *safe-to-run* plan. If
  it can't be made safe automatically, emit the block commented-out with the blockers listed,
  so nothing accidentally runs it.
- **Stamp `contract_version`** from the contract file so `/fleet` can reject stale plans.
- You only read and validate; the only file you write is the compiled plan output. You never
  create branches, spawn workers, or run git — that's `/fleet`.
