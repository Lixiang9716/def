# Agent Note: Install-pipeline REL_PATH guard now rejects interior .. segments; traversal pins (row 18)

Status: implemented
Related: D6

## Problem

The install pipeline treats a package as hostile-until-verified data, but its
manifest path guard did not enforce its own invariant. `REL_PATH`
(runtime/dsh/install-pipeline.js:69) anchored its negative lookahead at
position 0 only, so `validateManifest` accepted entries with INTERIOR `..`
segments — `bundle/../../main.js` validated clean (measured: the old class
returned null) and survived into `bundle/${entry}` path construction and the
loader's moduleId. End-to-end it stayed fail-closed only by borrowed luck:
tar-mini's member guard (tar-mini.js:44-49) refuses any member carrying `..`,
so the entry lookup could never succeed, and the C loader additionally
refuses resolved paths containing `..` (dsh_runtime_host.c:903). A guard
whose correctness depends on a different layer's guard is one refactor away
from silent failure, and nothing pinned any of this: no test seeded a
malicious package against the pipeline. The audit (test-hardening row 18)
also measured the rest of the attack surface — symlink/hardlink/GNU-longname/
pax members die at the tar type gate, the ustar prefix field forges nothing
(the reader reads the 100-byte name field only, and the entry check fails
closed), NUL padding truncates without extending, and URL-encoded/backslash
spellings stay literal names because nothing in the chain decodes them.

## Decision

`REL_PATH` is tightened to reject a `..` segment at ANY position
(`/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/`) — the manifest guard now stands
alone, matching what its shape always claimed (install-pipeline.js:69-73).
The harmony rawfile copy rides the same bytes via `build/build.sh sync all`
(closures gate green: "android + harmony committed copies byte-identical").
The proof is a new panel suite, test/panel/install-path-traversal.test.js
(19 pins): every hostile member class driven through the REAL
`installPackage` with an honestly computed trust record (so a rejection can
only come from the guard under test), each asserting the guard names itself
AND the containment invariant — after every attempt the workspace holds only
the content-addressed blob, the staging tree, the promoted package tree and,
only on success, the receipt; a rejected install writes no receipt, and in
journal mode the §4 pending marker is never written (the abort precedes
journalPending). Known residue, reported not fixed (outside this change's
file face): the ANDROID staged copy
(hosts/android/app/src/main/assets/dsh/install-pipeline.js) still carries
the old guard — the android stager's root-file roster
(hosts/android/ci/stage-spine-closure.sh:325/332) does not name
install-pipeline.js, so neither sync nor the closures gate touches it; the
surprise record for it crashed (`gov surprise record` dies with
KeyError: 'expectation' at govrail surprise.py:179) and is reported here
instead.

## Alternatives considered

- Fix nothing (rely on the tar guard + loader refusals forever): rejected —
  the pins would then be pinning borrowed safety, and the first innocent
  refactor of tar-mini's member guard (e.g. to support long-name members)
  would silently re-open the manifest path into `bundle/${entry}`
  construction. One regex buys a guard that means what it says.
- Reject `.` segments too (the iOS gateway's safeRelative refuses them at
  the fs boundary, so `./main.js` installs on the panel shim but fails on a
  device): rejected for this change — it is a cross-layer consistency nit,
  not a traversal (the path stays inside the sandbox; fail-closed), and
  tightening it would invalidate currently-valid manifests for no security
  gain. Recorded as a candidate follow-up.
- Pin only at the tar-mini unit level (no full-pipeline installs): rejected —
  the containment property this row exists to prove ("nothing lands outside
  the package tree") is a property of the PIPELINE over the shim's honest
  (scope, path) keys, and unit pins would not see a staging/promotion escape.
