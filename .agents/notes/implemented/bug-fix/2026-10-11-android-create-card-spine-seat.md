# The Android create-card leg rides a real spine seat (and the scripted approval actually settles)
Status: implemented


## Problem

The create-approve-hotmount chain's E2E leg (scenario `create.card`,
manifest `test/e2e/scenarios/create-card.json`) could not pass on Android.
The drive imports dsh-create's `pluginCreateExecute` directly, but the live
mount needs the REAL cordis context (`ctx.plugin`), which only exists where
`upstream/boot.js` mounted DshCreate (its `apply()` captures it). On the
bare binding seat nothing ever ran that apply, so the mount refused at
`plugin_create: no cordis spine on this seat (mount impossible)`. iOS has
the same disease (`-dsh-mode create-card` boots the same bare entry);
reported, not fixed here.

Two further defects surfaced once the seat was fixed:

- The scripted-approval seam (`--es dsh.script.approval approve`) never
  actually settled a `presentApproval`: its lambda pre-set the one-shot
  `approvalSettled` flag, so `settleApproval`'s exactly-once guard bailed
  before `done.settle` — the JS await hung until the 180 s watchdog. No
  earlier leg exercised the seam end-to-end (card.player presents no
  approval), so this was its first real crossing. It also left the dialog
  on screen, though its own contract says it settles "exactly the way the
  tapped button would".
- The scenario's success-marker check demanded `已安装并激活` — the message
  from the pre-cordis-native dsh-create. The mount pipeline's return value
  changed under it (`已作为真实 cordis 插件在线插入`), so even a successful
  mount read as a failure.

## Decision

- `scenario/create-card.js` boots the FULL mobile profile spine first
  (`bootUpstream`, the parity leg's pattern): DshCreate mounts inside it and
  captures the context; `pluginCreateExecute` then live-mounts the authored
  plugin into THAT spine. The required llm route is explicit never-dialed
  boot wiring (`http://127.0.0.1:9/never-dialed`, provider `mock`) — no
  model turn runs. Boot-inventory records ride `log.debug`, keeping the
  manifest's stream one-to-one with the mount chain.
- `plugin-mount.js` grows an optional `opts.onStep(step, fields)` — the
  pipeline's observability seam. The `plugin.mount.*` records keep their own
  scenario; a drive that narrates the chain under its own scenario id
  subscribes and names the steps itself.
- dsh-create maps `approved → approval.answered {name, approved}` and
  `adopted → registry.installed {name}` under scenario `create.card` (the
  same id its `package.written` already rode).
- BindingHost narrates the NATIVE surface's face acts for this drive only:
  `card.face.presented {id, kind}` / `card.face.completed {id}` from
  `busPosted`, gated on the create-card scenario so every other drive's
  stream stays byte-shaped. MainActivity gained the `dsh.createcard` extra;
  `BindingHost.startCreateCard` is the drive factory.
- The manifest pins the seat's real face: `client.selected`,
  `create.card.spine.booted`, the mount-chain events above, and the stale
  success-marker check now matches the pipeline's actual return value.
- `run-create-card.sh` drives the leg with `pm clear` first: the leg proves
  the FIRST-RUN chain, and the gateway fs persists — a previous run's
  enabled registry row made the next boot live-mount the plugin
  (`mountBootRows`) and the drive's own mount refuse ("already mounted").
- The settle window after `tool.returned` is `DURATION + 6000`: the
  plugin's re-arm loop re-arms only after each fire crosses back onto the
  runtime queue, and this seat carries the whole spine's boot traffic —
  measured drift put the eighth tick ~600 ms past a +1500 window, the
  scenario completed first, `m4End` tore the runtime down, and the complete
  line never crossed.
- The scripted-approval seam: the one-shot flag is set in `settleApproval`
  and only there; the settle also dismisses the dialog (the tapped-button
  equivalence the seam's contract names).

## Alternatives considered

- Give the bare binding seat a minimal `ctx.plugin` face (path b): rejected
  — it would fabricate a second, weaker meaning of "mounted into the spine"
  when the REAL spine boot is one import away and already proven on this
  exact seat (the parity leg).
- Pin the boot-inventory events (llm/runtime, upstream/profile,
  upstream/services) in the manifest: rejected — the parity manifest owns
  those pins; this leg's story is the mount chain, so its boot evidence
  rides debug (the lines exist, below the assertion stream).
- Have `mountWorkspacePlugin` emit the drive-named events itself: rejected —
  the product pipeline must not know drive scenario ids; the onStep seam
  keeps the naming at the drive's edge.
- Scenario self-heals a warm workspace (unmount + delete stale tree):
  rejected — silently mutating the workspace hides exactly the state a
  rerun needs to see; the runner's `pm clear` makes first-run determinism
  explicit and the mount's refusal stays the loud diagnostic.

## Consequences

- The create-approve-hotmount chain now has its Android proof: 12/12
  manifest events in order, native approval dialog presented + scripted-
  answered, registry row on disk, plugin live-mounted into a running spine,
  its own apply() driving the native card face (screenshots in
  hosts/android/artifacts/create-card/).
- Any future leg that presents an approval under a scripted drive inherits
  the fixed seam — the old code would have hung every one of them.
- iOS still refuses at the same spine check; its drive needs the same
  boot-the-spine treatment (or a spine seat) as a follow-up.