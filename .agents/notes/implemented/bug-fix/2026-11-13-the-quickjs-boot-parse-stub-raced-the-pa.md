# Agent Note: the quickjs-boot-parse stub raced the parallel closures walk — exclusivity per rule 6

Status: implemented

## Problem

The pre-push gate DAG failed deterministically on `closures` ("hosts/ios/gen.sh
failed") while the same gate passed standalone, under `gov run`, and under a
complete manual replication of the hook's judged tree — the T-0299 card-closure
push could not land. The captured gen.sh stderr (a PATH-intercepted `sh`
wrapper) named it: `gen_bundle_header: missing tree input
.../gov-prepush.B8Bvvc/runtime/dsh/scenario/ci-quickjs-parse-probe.js`.

The mechanism: gov's runner executes same-wave gates in parallel threads
(ThreadPoolExecutor, `concurrency`-capped). `quickjs-boot-parse` and
`closures` both `need` only `self-test`, so they share a wave. The parse gate
writes an untracked stub (`runtime/dsh/scenario/ci-quickjs-parse-probe.js`,
"never committed" per its own header), compiles it under quickjs-ng, and
deletes it on exit; meanwhile closures' gen.sh walks `runtime/dsh/scenario/`
(`collect_tree_files()` rglobs every `.js`) and embeds what it finds — the
walk included the stub and the deletion landed between `is_file()` and
`read_bytes()`, killing gen.sh and reding the whole push. This is the second
independent recurrence of the same signature: the ccore seat recorded the
`check` gate racing the same stub's cleanup 100 minutes earlier
(.gov/surprises.jsonl, sig `gates-one-scoped-dag`). Rule 6 exists for exactly
this shape ("a case that mutates the live tree must never run concurrently
with gates that read it").

## Decision

`quickjs-boot-parse` is now `"exclusive": true` in gates.json — the scheduler
drains the pool before it and admits nothing else until it settles, so no
sibling ever reads the tree while the stub exists. The edit went through the
documented hand-edit exception (`gov gate add` refuses existing ids — "gate id
is identity"), followed by `gov self-test` (the rule-6 mandate when touching
gates.json) and the recorded seal ritual (`gov verify-plane --write
--confirm-unattended`) accepting the constitution change. The gate's command,
needs, timeout, description, and scoping are byte-identical — the diff is the
one `exclusive` line.

## Alternatives considered

- Mark `closures` exclusive instead — lost: closures itself mutates the tree
  (gen.sh writes hosts/ios/App/Generated + DSHHost.xcodeproj), so it deserves
  the same protection, but the stub's creator is the mutating party rule 6
  names; isolating the reader would leave the next tree-walking gate (asset
  mirrors, staging-check on a scope change) exposed to the same race.
- Move the stub out of the embedded tree (a temp dir outside runtime/dsh) —
  lost: the probe's imports (`../logger.js`, `upstream/shims/fs.js`) resolve
  relative to its location under runtime/dsh; relocating it breaks the very
  surface the gate proves (the boot graph's shim splits under the real
  loader).
- Serialize by adding a `needs` edge (closures needs quickjs-boot-parse) —
  lost: `needs` is a correctness edge, not a scheduling primitive; a false
  edge would skip closures whenever the parse gate skips, and exclusivity is
  the flag rule 6 names for this exact contract.
