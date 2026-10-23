# dsh-mobile — plan (2026-10-21, merged)

English | [中文](plan.zh.md)

One source of truth for everything that must, should, or could be done. Merges the fleet plans of
2026-10-21 (MCP-seat and row-15-seat drafts, `plan.md` at the primary root) with the session
backlog and the 2026-10-20 findings (node differential #626/#627, iOS process survey). Baseline:
main = `722d69fe` (#632 MCP streamable-HTTP landed). Per rule 12, update this file in the same PR
that lands a phase.

**Legend.** Size: S (< 1 day) · M (days) · L (weeks). Gate: 🔒 owner decision / explicit go ·
🔧 hardware, credentials, external party · — none. Status: open · in flight · blocked · parked.
Each row's "why / entry" names the evidence or the entry point a picking-up session starts from.

## 1. 🔴 Immediate — AOCI cognition closeout (the only owner-held blocker)

`aoci_maintain` reports `blocked: scope_change_required` since 2026-10-20: #625's relaxed budget
identity is not activated. **27 unindexed sources wait on it** (#632's MCP files, #631's
`tools/test/sweep*.mjs`, the changed `test/verifications.mjs`, shims, notes, evidence files).
`T-0268` (sweep-driver card, 6/7 ticked) closes item 7 with the resulting `chore(aoci)` PR.

- **What the approval applies** (fresh preview `activate-1904454454`, generated 2026-10-21 against
  the clean tree after §6.0 was resolved; supersedes `activate-2582042714`, `activate-3410094958`
  and `activate-1967926623`): policy identity unchanged; **budget identity `56f2…` → `54b0…`** (the
  #625 re-baseline — the sole reason the risk level is `high`: `budget_relaxation`); **index_added
  15** (flakes.json, ensure-seat.sh, mcp-http-transport.js ×2, mock-mcp-server.mjs,
  run-mcp-streamable-http-e2e.sh, mcp-streamable-http.js + its scenario JSON, verifications.mjs,
  fras-lint.mjs, flake-retry.mjs, sweep.mjs + 2 test files, SchibstedGrotesk woff2);
  **index_removed 1** (`test/e2e/run-ios-m1.sh`, renamed 2026-10-20); observe_added 17 (was 111
  before the Stryker residue was removed). `scope apply` asks for the preview's confirmation phrase.
- Owner (or owner-delegated) commands, in order:
  `~/tools/aoci/aoci --repo <root> scope approve --preview-file .aoci/scope-change/activate-1904454454/preview.json --actor <id> --out-file .aoci/scope-change/activate-1904454454/approval.json`
  then `scope apply --preview-file … --approval-file …`. **An agent never signs on its own
  initiative** — only on the owner's explicit instruction, under the owner's identity.
- After approval, agent picks up: `aoci_maintain` → author FRAS for the ~27 sources →
  `node tools/aoci/fras-lint.mjs` precheck → `aoci_update_entry` → `chore(aoci)` PR. Half a
  session. Closes T-0268 item 7. Size S. Gate 🔒. Status done (2026-10-21 — the owner approved
  `activate-1904454454` and the closeout landed: 61 sources authored across five machine
  batches, aligned, T-0268 closed).

## 2. Ship now (the next 2–4 weeks)

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 2.1 | **v0.0.3 release**: full feature-test precheck → `bump.py` + tag (D12–D14 train) → TestFlight · APK on GitHub Releases (self-sign) · Harmony sideload | Launch sprint 2026-09-30 = zero blockers; no public build since; woaiys3 (513★) proves GitHub-Releases APK distribution. Next tag per `doc/github-owner-actions.md` is v0.0.3. Release needs explicit go. | M | 🔒 | open |
| 2.2 | Hero video (≤ 60 s) on Pages: chat → generated plugin → live insert → glass card | Pages lacks a "what it does" proof; loop works (#427, #599) | S | — | open |
| 2.3 | Google Play 2SV unblock | Stuck on the owner's phone since 2026-10-07 | S | 🔧 | blocked |
| 2.4 | Marketplace v0 real deploy: server credentials + `deploy/marketplace/deploy-local.sh`; IdP also STANDY per owner-actions doc | 6/6 program landed, credentials missing | S | 🔧 | blocked |
| 2.5 | `doc/github-owner-actions.md` refresh (S3): item 5 "Pages — landed red" expired (live 2026-10-15, HTTP 200); re-verify items 1/3/4/7/8; unfinished list: Dependabot security updates · `release` environment required reviewer (without it every release run deadlocks) · Discussions · marketplace publish secrets + environment · delete retired `RELEASE_PLEASE_TOKEN` · release go · Play row confirm-or-delete · marketplace/IdP STANDBY decisions · `~/tools/aoci` formal release | Minutes-level; bilingual + `gov verify pairing --write` | S | — | open; queued — another agent |
| 2.6 | Close fixed-but-open issues with evidence (recurring) | 2026-10-19 found six "fixed, never closed" | S | — | recurring |

## 3. Verification infrastructure (what 2026-10-20/21 found)

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 3.1 | **Prerequisite for 3.2: classify the 86 "NO" rows** (#631's honest node column; family spread hooks 9, llm 9, web 8, session 6, shell 6, …) into (a) harness artifacts like #626, (b) Node-face gaps, (c) real runtime deltas, (d) specs needing Node-only abilities. The class table decides 3.2's re-baseline scope and the tier-2 call; registry `reason` rewritten to the classified reality | Entry: `/tmp/dsh-sweep-differential/sweep-compare.md`, or `node tools/test/sweep.mjs --paral 4` filtering `agree==NO` (per-row logs `tmp/upstream-suite-logs/<stem>.{qjs,node}.log`). Workflow shape: one subagent per family + spot confirmers + `world.run` two-leg single-spec reruns as the deterministic gate | M | — done (2026-10-21 — per-family workflow over the fresh 681-spec run: a 58 (the #626 blast radius) · b 15 (node-leg seams: fixture seeding, storage globals, fetch loopback, tsx intrinsics) · c 24 (real runtime deltas — the differential's value) · d 4 (persistence worker; tier-2). 53 rows independently re-confirmed, 53 through the two-leg rerun gate. Table: the testing/2026-10-21 note; registry reason rewritten to the classified reality) |
| 3.2 | **#626** node leg: `NODE_BUILTIN_PASSTHROUGH = new Set(['node:child_process'])` + one early return in `test/upstream-suite/smoke-hooks.mjs`; fix `test/verifications.mjs` reason/status; re-measure via the Node driver / weekly sweep | Root cause verified both directions (9/22 ↔ 31/0); ~100 specs / 38 families spawn on the node leg | S code / M measure | — | done (2026-10-22 — superseded by 3.17: #645/#647/#649/#651/#653/#660/#661 landed the passthrough, the Tier-2 extension, the seams/seeding, the loader wiring, the node-pty vendor, and the terminal 15-row ledgered surface); history: open; repro drivers in `../dsh-mobile-lsp-diff-fork/tmp/` done (2026-10-21 — the passthrough landed; the re-baseline is deliberately NOT the clean flip: 101→83 disagreements, 21 of the 58 a-rows flip clean, 37 now run the real spawn and fail on their own merits (new triage list → 3.17), 4 newly-disagreeing (media-references exposes a qjs gap; spawn-runner asserts seam-era paths; egress + sdk-client newly informative). Surprise ×3 ride this change) |
| 3.3 | Node leg tier 2: all 11 `node:*` shim rows served as real builtins; own PR, own re-baseline (`node:vm` etc. flip to qjs-red/node-green = real runtime gaps) | `runtime-modules.js` rows: string_decoder, stream/promises, tls, inspector, dns/promises, readline, vm, http, net, child_process, url | M | — done (2026-10-21 — NODE_BUILTIN_PASSTHROUGH extends to all eleven node:* rows; the re-baseline: 83 -> 63 disagreements, 25 rows flip clean (the fetch/proxy/egress families — real transports at last), 5 regressions re-classified with signatures (ssh TLS rows -> d; acp bridge + otel egress -> c). Final table a 18 / b 18 / c 17 / d 10 — see the Tier-2 testing note) |
| 3.4 | **#627** ensure-seat completeness: `external/node_modules` farm row (or run `parity-node-modules.sh`), sweep builds the farm itself, `git submodule update --init` for `third-party/deepseek-harness`, seat-pointed node_modules links, `generation.mjs` fingerprint covers the submodule corpus (`git ls-tree HEAD third-party/deepseek-harness` + dependency-path probe), `transpile.mjs` warns instead of silently rewriting the tracked manifest on ENOENT exclusions. Accept: fresh seat transpiles 681 = main with identical stamps | Seat: 648 vs 681 with identical `.generation`; manifest.json (tracked) silently rewritten 681→648. #629 already added `presentation/official-web/dist` + `client-bundles/npm` rows to materialization — same file. Surprise sig `linked-worktree-materialized-buildensure-seatsh` | S–M | — done (2026-10-21 — manifest `provision` array (clone-submodule + parity farm, built in-seat never rsynced); generation fingerprints the submodule; transpile warns loud; sweep self-materializes the farm; acceptance: fresh seat transpiles 681 = main, zero missing/extra) |
| 3.5 | Sweep driver follow-ups (#631): classify `MODULE-LEVEL FAILURE` / `ERR_DSH_NO_SEAM` as environment red; triage node NOSUM 43 after 3.2 | Node column honest since #631 | S | — | open; queued — another agent |
| 3.6 | Registry statuses derived from runs (live/dead/divergent computed from the latest sweep table; prose only for reasons) | The same leg's status text was wrong twice on 2026-10-20 (dead reason, divergent reason) | M | — | open; queued — another agent |
| 3.7 | Cold-seat CI leg: fresh worktree → `ensure-seat --verify` → transpile → one-spec qjs+node smoke, as a materialization-completeness gate | Would have caught the farm + submodule | M | — | open; queued — another agent (the 2026-10-22 cold-seat pty regression is fresh evidence for it) |
| 3.8 | **#633** e2e-matrix currency: 33 `runtime/spike/artifacts` rows → `runtime/dsh/`; Totals 93/206/213 regenerated to `matrix.mjs`-measured 137/257/250; add 2026-10 CLI leg rows (llm.piai-probe, dsh-shell-js, appshell-spec, llm.chaos.*, seam-inventory, mcp-streamable-http…); optional: totals generated by `matrix.mjs --out` (kills the drift class). en+zh + `gov verify pairing --write e2e-matrix` | Half-hour scale | S–M | — | done (#637 — the three tables regenerated from `matrix.mjs --out`, the coverage matrix widened, spike rows rerouted, 25 CLI dirs registered; the optional totals-by-derivation adopted in the same emit) |
| 3.9 | lsp-stdio `instance.spec` 22/1 on the qjs leg (backpressure timing; reproduces with #614 reverted) | The one real lsp-family residual | S | — | open; queued — another agent (ledgered as a c-delta: abort-vs-backpressure race, testing note 2026-10-22) |
| 3.10 | Receipt tree-line hygiene (S2): `hosts/android/ci/run-ble.sh:151` / `run-device-plane.sh:191` / `run-session-persist-restart.sh:161` read the tree at receipt time — in-place reruns get marked dirty; follow `run-upgrade-matrix.sh` (#629). Decide the `"tree": "origin/main <sha>"` literal: #629 audited 22/36 committed receipts whose sha is not on origin/main | Note: `.agents/notes/implemented/testing/2026-10-20-upgrade-matrix-receipt-tree-line-pinned-.md` | S | — | done (#638 — the three sibling runners pin the tree line at run start, following run-upgrade-matrix.sh #629) |
| 3.11 | **#628** `AssetSync.kt` dead reconciler copy: recommend **delete** (detekt baseline shrinks); alternative B = complete the extraction (AssetSync sole implementation + JournalKeeper, `MainActivity.syncAssetDir` / `SessionPersistRestartSession` route through it); either way move the JournalKeeper R from "called by AssetSync" to `MainActivity.syncAssetDir` | Zero call sites; wiring as-is re-introduces the journal wipe | S | — done (2026-10-21 — recommendation A: AssetSync.kt deleted, zero call sites verified; row-15 title re-homed to the mechanism; AOCI relations re-bind at the next maintenance) |
| 3.12 | #258 TLS design round · #260 `node:net` fd-wrap (D5 draft exists: `contract/proposals/2026-10-19-net-fd-wrap.md`, awaiting adoption) · #257 socket-seam per-host serve legs + e2e | Socket-seam family, L/M/L | L | 🔒 (design rounds) | open/parked |
| 3.13 | Windows ladder level 4: **A (recommended)** `drive` fields for ios-boot-carrier / panel / harmony-host-e2e → `run-verifications.mjs` scheduler over the whole table → a dedicated `gov run` mode ("govrail picks/judges/attests, Node executes, ceremony in its own mode, retry stays in the driver"); first step = drive schema draft + a `--dry-run` scheduler skeleton. **B** Windows face: MSVC probe, shell-less spawn resolution (`npm.cmd`), CRLF already tolerated. Bash shim retirement keeps one weekly cycle (rule 10 sweep: weekly `run:` line, `doc/release-checks/`, registry prose, ops-dispatch) | Levels 1–3 landed #624/#625/#631; gates.json fields verified | M | — | open |
| 3.14 | Stryker policy: rerun on family change, never a gate. Residue `test/mutation/.stryker-tmp` (502 MB, two sandboxes) **removed 2026-10-21** — it occupied 111 observe rows in the scope evaluation | Pilot found a dead counter-example net (publisher-token) | S | — | done |
| 3.15 | Two stale stashes in the shared `.git` (gaps-integration 2026-10-11; feat/device-plane WIP) — land or drop | Seen 2026-10-21 | S | — | open; queued — another agent |
| 3.16 | 2026-10-26 03:17 UTC: watch the weekly sweep's first Node-driver run (totals parsing, first NO rows, NOSUM shrink); backfill numbers into the driver's note; red = inspection finding, not infra failure | Entry: `.github/workflows/weekly-sweep.yml`; `node test/verifications.mjs --why upstream-sweep` | S | — | scheduled |
| 3.17 | Re-triage the 37 former-a rows + the 4 newly-disagreeing rows after the #626 passthrough (they now run the real spawn and fail on their own merits: preset-mount loader seam, hooks real-spawn behavior, spawn-runner seam-era assertions, media-references qjs gap, sdk-client one-test delta, subprocess egress ALL_PROXY) | The #641 class table's (a) label meant "never reached the tested code" — the passthrough unmasks them; the registry reason carries the post-fix counts | M | — done (2026-10-21 — the re-triage ran post-Tier-2 instead of post-Tier-1 (one sweep serves both): the final table is a 18 / b 18 / c 17 / d 10; the 41 rows from the Tier-1 snapshot re-classified with mechanisms named; the rerun gate executed 0 times (seat path moved) — disclosed; counts anchored by the three compared sweeps and the weekly sweep going forward)  A node-leg seams seat then landed 6 of the 18 b rows (web faces, tsx intrinsics, FormData dual-realm): 63 -> 58, b 18 -> 12; the remaining 12 need per-family fixture seeding, loader-internals wiring, a node-pty vendor row, and the resolve-semantics fix  The fixture seeding then landed 24 more rows (per-process work roots, isolation over leakage): 63 -> 58 -> 46, and five leakage-blessed rows flipped to NO — fresh triage material (testing note 2026-10-21, fixture seeding)  The shim tables then wire on the node harness (runtime-modules + npm-bridges-c executed at startup): the row interiors improve (mount 14/39 -> 51/2, inventory all-fail -> 9/3) with the surface steady at 46 — the remaining rows name their mechanisms (loader-internals edges, node-pty vendor row [owner decision], the qjs staged-fs manifest read for typert)  The b-closeout then vendored the node-pty pair (controller flips: node 55/0), moved the typert resolve face to the staged-fs read, and re-measured: 63 -> 42, with the same five leakage-blessed rows NO under the correct isolation (testing note 2026-10-21, b-closeout) | The diff-closeout seat (2026-10-22, testing note) then landed the final waves: 30 rows flipped to agreement (the loader bridge row, the node-pty provisioning compile, the transpile-inline sibling staging, the enumerated farm re-anchor, the dual-realm FormData gate, sparse fs truncate, exports-map resolve, the vitest-faithful stubEnv, the VFS-miss existsSync fall-through, the child stdio close, and more) and the remaining 16 rows moved into the committed differential ledger (test/upstream-suite/differential-ledger.json — 9 d-contract, 5 c-delta, 2 both-red), which the sweep driver reads: the totals now report documented vs unexplained and name every unexplained or stale row. The surface work of 3.17 is DONE; the weekly sweep audits the ledger from here. |
| 3.18 | AOCI index slimming: whole-index tokens ~313k against a 330k target (warning 370k), climbing ~0.5–1k per PR — plan a low-value-entry consolidation (merge/retire stale mirror-row entries, demote duplication) before the warning line | Entry: the budget block in any `aoci_maintain` output; `aoci index agent guide` for the current count | M | — | queued — another agent |
| 3.19 | Ledger deep digs (optional, each a seat): (a) session-telemetry-otel egress — the OTLP dispatch reaches the loopback client face (setTimeout armed) but the collector records zero; the failing hop is agent-lookup routing or swallowed exporter handling (probe-evidenced, testing note 2026-10-22); (b) acp turns cancel-delivery — the web-streams reader faces add microtask depth vs native same-tick delivery (fix = reduce promise-layer depth; no correctness bug) | Entry: `test/upstream-suite/differential-ledger.json` rows + the 2026-10-22 triage logs | S–M each | — | queued — another agent |

## 4. 🧭 MCP onto devices (the "universal tool" mainline, two steps)

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 4.1 | **Host staging**: the 5 promoted MCP pins into every host embed list (iOS `ios-TREES.rows` / harmony `harmony-closure.rows` @walk / android `android-pins.rows`) → `build/build.sh sync ios+android+harmony` → closures/bundle-files/staging green. Key decision: **dist trimming** — client dist ships .cjs/.map/.d.ts (MBs); devices need only dist/*.mjs (whitelist rows or an extract variant in ensure) | #632 landed the transport + probe; devices cannot reach it. `vendor-package` skill is the process spec; materialization.json untouched | M (re-materialization dominates) | — | open |
| 4.2 | **`dsh-mcp` system plugin**: config face (`__dshMcpServers` global or `DSH_MCP_SERVERS` env, credentials via keychain) → boot connects each server (`createMcpHttpTransport` + `Client.connect`) → `listTools` registers `mcp_<server>_<tool>` into `ctx.tools` → `callTool` forwarding. Probe spec = mock server + scenario + manifest + runner (#632 template). Iron rules: D6 (compose vendored client, zero edits), D8 (event-driven tool runs); open question for an Agent Note: approval granularity (suggest first version = per-server one-time authorization) | The plugin OS needs external tools; #632's ledger names this as the next step | M | — | open |
| 4.3 | Follow-ups after 4.2: stdio bridge stays judged infeasible (no subprocess seam) unless D5 adds a primitive — do not reopen; MCP resources/prompt faces stay absent-features ledger rows; OAuth step-up evaluated together with BYOK credential storage | 2026-10-21 fleet plan | — | — | parked |
| 4.4 | Upstream re-pin evaluation: upstream was 1754 commits ahead of pin 0.1.6-alpha.2 at the 09-23 survey; re-pin cascades (presets seed regeneration, receipt version literals, E2E manifest re-pins) | Owner sets the cadence | M | 🔒 | open |

## 5. Ingress and growth contracts (1–2 months)

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 5.1 | SAEP/Doubao ingress four-piece via D5: static declaration + deeplink scenario routing + SessionServe + approval seam extended to deeplinks | Owner decision 2026-10-15; listing window cheap now; sits in the D5 proposal pool | M | 🔒 freeze | open |
| 5.2 | Android "hand": screen/ui/input primitive family + orchestration plugin | Competitor APK ships accessibility/shizuku — table stakes | L | 🔒 contract | open |
| 5.3 | iOS "mouth": App Intents + Live Activity (tier 1); ReplayKit read-only optional; tier 3 not pursued | Only sanctioned iOS shapes; nobody else has an iOS host | L | 🔒 | open |
| 5.4 | #266 real-device legs — **prerequisite is signing**: iOS free Apple ID auto-sign (7-day expiry, 3 devices); Harmony needs a real-name Huawei developer account (no DevEco / signing material on this machine) | Camera iOS/Harmony, BLE ×3, Harmony parity + matrix | M | 🔧 | blocked |
| 5.5 | Ecosystem API-direct plugins (the realistic first "order a bubble tea" = cordis route) | Qwen's version is API-direct, not screen control | M | 🔧 BD | open |
| 5.6 | Import standards: SKILL.md compatibility + MCP client (after 4.2, catalog + import UX) | OpenMinis action item | M | — | open |
| 5.7 | **#268** D5: profile-as-app-manifest — the undefined app defines itself (def keystone); D5 pool also holds the AgentVM/WALI contract and event-channel v1.6.0 + system-capability-plane freeze cadence | Unfrozen since 2026-09-30 | L | 🔒 | open |
| 5.8 | `def` naming → decision entry in `doc/decisions.md` (memory-only; D18 is WALI) | Naming settled 2026-09-27, never recorded | S | 🔒 | open |

## 6. Docs and repository structure

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 6.0 | Stray `plan.md` at the primary root (the MCP/row-15 fleet draft, untracked): merged into this file and **moved to `../dsh-mobile-lsp-diff-fork/tmp/plan-fleet-draft-2026-10-21.md`** on 2026-10-21 so AOCI does not index an untracked file; delete that copy once this plan lands | Two plan files coexisted | S | — | done |
| 6.1 | Structure readability track A: layout diagram + READMEs for undocumented roots (measured 2026-10-21: only contract/ presentation/ runtime/ system-plugins/ of 21 top dirs have READMEs) + `.gitignore` pass, one PR. (A fleet draft claimed track A landed — measured: not.) | Owner 2026-10-19: "can't tell what is what" | S–M | — | open |
| 6.2 | Track B renames (`src`→`host-core`, `third-party`→`upstream`, `external` deep-integration) | Renames churn every open seat; after a release | M | 🔒 | parked |
| 6.3 | ARCHITECTURE §10: verify the four 2026-10 milestones (shell-js, ishRun retired, Harmony real, hardening) are present after #625's count fix | Rule 12 | S | — | open |
| 6.4 | Agent-notes archive pass (400 implemented / 0 archived) | archive-agent-notes skill | S–M | — | open |
| 6.5 | ops-dispatch acceptance (touchstone prompts) | Landed #622 | S | — | open |
| 6.6 | Doc tooling decision: doc-refine skill vs writing-for-agents vs none | Undecided since 2026-10-16 | S | 🔒 | open |
| 6.7 | Vendor closure drift: host asset mirror tree half | Staging half landed 2026-10-19 | M | 🔒 | open |
| 6.8 | Upstream submodule ↔ pin table machine binding | Upstream issue open, awaiting owner | S | 🔧 | blocked |

## 7. Product polish

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 7.1 | GenUI direction sign-off + landing: v6 pipeline (colors.csv 193 palettes → build → critic R1–R10) and v7 (four skills 60 KB + 390×844 canvas + free creation) await owner review; def interaction prototype v1 (`/tmp/def-prototype` — verify it survived) same batch. Landing shape: skill pack into plugin + pipeline + CSS, one PR | Judged best-of-line (9/10 one-shot) | M | 🔒 review | open |
| 7.2 | Streaming TTFT progressive render | Thinking-time 11–26 s dominates; experience layer | M | — | open |
| 7.3 | **#267** theme ladder rung 2: token editor on the single-source mechanism | Tokens exist, mechanism missing | M | — | open |
| 7.4 | **#265** Lynx client: host-side `--client` selection + device pixels | Pilot #248 landed | M | — | open |
| 7.5 | Pomodoro tails: card JSON contract; serve-seat app-layer defect | #427 leftovers | S | — | open |
| 7.6 | Desktop-plugins staged-next ledger (appendix table): fs over gateway scopes + tool-fs-search (ripgrep binary), web fetch + keyed search, tool-ask-user / dsh-user-approval (presetJoin Harmony-only), compaction host wiring (`options.compaction` on serve seats + `/compact` UI), titles(auto) / plan-mode / permission-presets, tool-cordis (needs `cordisInspect` HOST service) | `doc/dsh-desktop-plugins.md` "Still staged" | M total, per-row S | — | open |
| 7.7 | Open Design install | Needs external nexu-io daemon | — | 🔧 | parked |

## 8. Architecture bets (a quarter out; after §2)

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 8.1 | AgentVM wasm tenant: contract proposal; two-week spike — wasm3 interpreter tenant vs WebContent-process tenant (WebKit wasm engine via JSPI, the Wasmer 2026-09 route; iOS 27+; bridge tax). Operator stays native QuickJS ("all-wasm is a regression" stands) | 2026-10-20 survey: WebContent is the only JIT-bearing second process iOS grants | L | 🔒 | open |
| 8.2 | Fiber scheduler for tenants | Design only | L | — | parked |
| 8.3 | Cloud tenant as a negotiated capability | Cosyra (2026) signal; differentiator stays local residency | M | 🔒 | parked |
| 8.4 | **#264** forkpty face: v1.9.0 proposal DRAFT → freeze into `primitives.md` | Implemented (D-b) | S | 🔒 | open |
| 8.5 | Real-fs ladder (S6): ① strict mirror (S) — sessions-root mirror failures become observable/throws (dropped-bytes count; root cause traced to `fs-workspace-write.js` best-effort mirroring, not the upstream backend); ② real-fs adapter flag-gated default-off (M) — `fs-promises` routes sessions root to real disk on v1.11.0 `fsPublishAtomic/fsSync`; acceptance = row-16 full-disk leg turns from instrument into regression (`run-starvation.sh` journal face); ③ gateway completeness (D5): link/fsync/truncate/mkdtemp/realpath when a second real-disk consumer appears | #580/#584 guards landed; #571-class silent loss | S/M/🔒 | open |
| 8.6 | Bare-metal phase 2 (sink pure data transforms; never touch tools/presets/commands/skills/plugins) | Two-phase strategy | L | 🔒 | parked |
| 8.7 | MCU/XS direction (ESP32-S3 via wasm3 ~64 KB; XS candidate; AsyncContext re-push) | Exploratory | L | 🔒 | parked |

## 9. Governance, govrail, AOCI (after §1)

| # | Item | Why / entry | Size | Gate | Status |
|---|---|---|---|---|---|
| 9.1 | Land surprise records: two from the lsp seat (branch `docs/plan-2026-10`); cold-tree family ≥ 3 signatures → rule-11 process note. ⚠️ Until govrail#456 is fixed: rebase onto origin/main before opening any PR that appends to `.gov/surprises.jsonl` (GitHub ignores custom merge drivers → parallel surprise PRs go CONFLICTING with zero checks) | Rule 11 | S | — | open |
| 9.2 | govrail backlog (filed, awaiting fixes): #454 `gov task new` id-collision infinite loop (hot-fixed locally in site-packages, **any `uv tool install govrail` wipes it** — "bumping" spam = recurrence); #455 `task tick --evidence` for auditable ticks (T-0246 false tick); #456 surprises.jsonl merge driver ignored by GitHub → shard the ledger per-entry; #457 `note check` stray "superseded by" banner + `task close` lacks a post-merge outcome vocabulary; #458 `gov verify pairing <stem>` read-only form is a usage error (two sessions hit it). Recheck #385: `task close` still runs 28 gates | Standing duty | — | 🔧 upstream | recurring |
| 9.3 | Surprise digest block in AGENTS.md (recurrence ≥ 2 in, promotion out) + first-contact injection | Proposal 2026-10-18, admission line undecided | S | 🔒 | open |
| 9.4 | AOCI service → formal release (rc20-62 dev build today) | External | — | 🔧 | blocked |

## 10. Local hygiene (no PR)

- Stryker residue removed 2026-10-21 (done above).
- Android emulator `pixel` (emulator-5554) running since 2026-10-20 — shut down if unused.
- Sibling seats (`../dsh-mobile-lsp-diff-fork` included): `git worktree remove` the same day their work lands.

## 11. Watchlist

- Peers: woaiys3/deepseek-harness-android-app (513★, active), PalmClaw (1169★, dormant), OpenMinis (5.3k★), Cosyra (cloud agents), Lobbowen "Lob OS". No second isomorphic project; no iOS host anywhere.
- Platform: Wasmer WebKit/JSPI needs iOS 27+; DMA engine entitlement EU-only, JIT restricted; TrollStore spawn closed on iOS 18+; UTM SE shows Apple accepts interpreter-only emulators.
- Upstream DSH: pin 0.1.6-alpha.2 (+#632 promotions); next bump triggers an upstream-suite re-sweep (see 4.4).

## 12. Recommended order (merged)

1. ✅ §1 AOCI approve/apply (owner) + the cognition closeout PR (61 sources, closes T-0268) — landed 2026-10-21.
2. 🟢 Land this plan (`docs(plan)` PR from `docs/plan-2026-10`) + the "evidence hygiene" mini-convoy: #633 (3.8) + #627 (3.4) + #628 (3.11) + tree-line (3.10) — disjoint files.
3. ✅ 3.1 classified (2026-10-21: 101 rows = a 58 / b 15 / c 24 / d 4) → §3.2 the #626 fix with its re-baseline (expected delta: the 58 a-rows flipping).
4. 🟢 2.1 release precheck → v0.0.3 go (owner) → 2.2 video.
5. 🧭 4.1 → 4.2 MCP mainline (2–3 sessions).
6. 🟠 5.x contracts, 6.x docs, 7.1 GenUI review — owner's priority call, mutually independent.
7. 👀 3.16 weekly-sweep first Node run (2026-10-26).

## Appendix A — dsh-desktop-plugins "still staged" (post-#632)

| Row | Gap | Note |
|---|---|---|
| fs over gateway scopes + tool-fs-search | subprocess/fs-service seam; ripgrep binary | real-disk write-through discussed, not built |
| web fetch + keyed search | `fetch: false`, no fetch provider over httpFetch | keyless present; keyed is a recorded gap |
| tool-ask-user / dsh-user-approval | presetJoin serves Harmony only; iOS/Android seats don't pass it | probe proven |
| compaction host wiring | boot proven on CLI; serve seats lack `options.compaction`; `/compact` UI | known gap 2026-10-12 |
| titles(auto) / plan-mode / permission-presets | dsh-plan-mode vendored, not mounted; titles not carried; permissionPresets empty | independent small items |
| tool-cordis | needs the `cordisInspect` HOST service of vendored cordis-host-runner | the only row missing a host service |
