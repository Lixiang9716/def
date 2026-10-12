# ANALYSIS — seat m4c (`feat/android-m3-ondevice`)

**Summary:** the branch merged long ago (HEAD `f68056ae` is an ancestor of
`origin/main` = `98869dd1`), and main has since renamed the whole spike tree
semantic (#402) and re-covered the install leg with semantic scenarios — the
dirty state is the never-landed spike-era **m3 on-device install** WIP: 5
untracked JS assets are byte-identical to main under new paths, while the m3
driver/host/manifest/task-card exist only here; everything is archived and the
seat is safe to tear down.

Method: `git -C /Users/lixiang/workspace/dsh-mobile-m4c status --porcelain`
(13 dirty paths: 4 tracked-modified, 9 untracked); per tracked file
`git diff origin/main -- <path>` (empty ⇒ already-in-main; `.gov/` ⇒
ledger-residue; else judged by content); untracked files compared by content
against main counterparts (`diff`/`cmp` of `git show origin/main:<path>`).
Full tracked delta: `tracked.patch`. Main-missing .gov record: `SALVAGE-NOTES.md`.

| # | path | verdict | note |
|---|------|---------|------|
| 1 | `hosts/android/app/src/main/cpp/dsh_spike_m4.c` | substantive-wip | Uncommitted +18/-3 m3 JNI entry points; file absent on main — #402 renamed spike/m4 codenames to `dsh_jni_binding.c`/`dsh_jni_scenario.c`, whose semantic evolved far past this base. |
| 2 | `hosts/android/app/src/main/java/com/dshmobile/spike/CarrierServer.kt` | substantive-wip | Uncommitted +25: dynamic package route (`onPackageGet`/`onPackageServed`, `/gateway-e2e/pkg/`) for the m3 fetch-install; main's `host/CarrierServer.kt` (renamed in #402) has none of it (grep empty). |
| 3 | `hosts/android/app/src/main/java/com/dshmobile/spike/MainActivity.kt` | substantive-wip | Uncommitted +57: `--ez dsh.m3` launch mode + `startM3()` wiring `SpikeHostM3`; main's `host/MainActivity.kt` has no m3 mode. |
| 4 | `hosts/android/ci/run-android-full.sh` | substantive-wip | Uncommitted +87/-9: full runner phase 3 (`m3.android-install` session, logcanary capture, checker, receipt artifacts); main's runner evolved separately (DSH_PHASES #341, `SCEN=test/e2e/scenarios`) with no m3 phase. |
| 5 | `.gov/tasks/T-0011-m3-installer-proven-on-device-through-th.json` | ledger-residue | Untracked task card for exactly this WIP (status open, receipt null); main has no card with this slug/title — main's `T-0011` is a different task (cross-host evidence matrix; sha256 `6555ad11…` vs `4cb76cb6…`); full record in `SALVAGE-NOTES.md`. |
| 6 | `hosts/android/app/src/main/assets/spike/config-layer.js` | already-in-main | Byte-identical to `main:runtime/dsh/config-layer.js` (canonical moved out of host assets). |
| 7 | `hosts/android/app/src/main/assets/spike/fixtures/dsh-badge.js` | already-in-main | Byte-identical to `main:runtime/dsh/fixtures/dsh-badge.js`. |
| 8 | `hosts/android/app/src/main/assets/spike/fixtures/dsh-badge-source.js` | already-in-main | Byte-identical to `main:runtime/dsh/fixtures/dsh-badge-source.js`. |
| 9 | `hosts/android/app/src/main/assets/spike/install-fetch.js` | already-in-main | Byte-identical to `main:hosts/android/app/src/main/assets/dsh/install-fetch.js`. |
| 10 | `hosts/android/app/src/main/assets/spike/receipt-journal.js` | already-in-main | Byte-identical to `main:hosts/android/app/src/main/assets/dsh/receipt-journal.js`. |
| 11 | `hosts/android/app/src/main/assets/spike/scenario/m3-android-install.js` | substantive-wip | 15 KB android-specific E2E driver ("exists ONLY in hosts/android assets" per its header); main's `assets/dsh/scenario/` carries no install scenario — only copy of this driver. |
| 12 | `hosts/android/app/src/main/java/com/dshmobile/spike/SpikeHostM3.kt` | substantive-wip | 9.5 KB m3 session host driver; no `SpikeHostM3`/`installFromFetch` Kotlin on main — only copy. |
| 13 | `tools/e2e/scenarios/m3-android-install.json` | substantive-wip | Checker manifest (28 expected↔logged events, `dsh.spike.log:` prefix) for the m3 driver; main's `test/e2e/scenarios/` (117 manifests, 5 semantic install-*) has no `m3-android-install` — only copy. |

No untracked file exceeded 5 MB and none was vendor/build product (the
`assets/spike/vendor/` copies are all tracked), so all 9 were archived at their
relative paths. Nothing here blocks teardown: the only content main truly lacks
is the retired spike-era m3 proof harness (#4-5, #11-13), kept in this archive.
