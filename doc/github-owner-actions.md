# Owner actions

The repository's agent workforce has no repository-management PAT: everything
in this runbook needs the owner's hands. It began as the GitHub-web-UI
checklist — most items still are a click in the settings pages — and now
carries the owner's whole open backlog: the release go, the phone-side and
server-side actions, and one local-machine action. A backlog the owner has
to reassemble from session memory is a backlog that stalls. Each item names
**Where** (the exact settings path or surface), **Why** (what breaks or
stays open without it), and **Done when** (the state to verify afterwards).
The agent can prepare files and workflows, but the switches below are the
owner's hands.

Repository-state facts below were verified read-only via the API on
2026-10-13 (`gh api repos/Lixiang9716/def` and
`gh api .../branches/main/protection`); items that could not be re-verified
that day carry their own older date. Re-check before acting if time has
passed:

- Required status checks on `main`: `gates` **and `ci-verdict`** (item 2
  is done).
- Dependabot alerts: **disabled** (`gh api .../vulnerability-alerts`
  answers 404 "Vulnerability alerts are disabled"); Dependabot security
  updates: **disabled** (`automated-security-fixes.enabled: false`).
- Secret scanning: **enabled**; push protection: **enabled** (verified
  2026-09-30; the 2026-10-13 re-check could not read that endpoint —
  either way, no action).
- Discussions: **off**. Pages: **off**.
- Environments: `release` exists but carries **no protection rules**
  (GitHub auto-created it once the package workflows referenced it — the
  inert state [release.md](release.md) describes); `github-pages` exists
  the same way; there is **no `marketplace` environment**.
- The three package workflows and `marketplace-publish.yml` all declare
  their `environment:` now — the workflow references are landed; what
  remains is arming them (items 3 and 7).
- The repo's only Actions secret is `RELEASE_PLEASE_TOKEN` (retired; item
  8); the only variable is unrelated to publishing.

---

## GitHub web actions

### 1. Enable Dependabot security updates

- **Where**: Settings → **Code security** → Dependabot, in this order:
  1. **Dependabot alerts** → **Enable** — this is the prerequisite, not an
     optional extra.
  2. **Dependabot security updates** → **Enable**.
- **Why**: version updates are already wired by `.github/dependabot.yml`
  (weekly, grouped: `github-actions` over the workflows, `npm` over
  `test/upstream-suite` — the one manifest with a lockfile). That cadence
  bumps pins on a schedule; security updates open a pull request the moment
  an advisory lands against a pinned version, instead of waiting up to a week
  for the next scheduled pass. The two compose automatically — there is no
  per-ecosystem security switch to configure in the file.
- **Why alerts come first**: security updates are *triggered by* Dependabot
  alerts — GitHub's docs state the feature "is available for repositories
  where you have enabled the dependency graph and Dependabot alerts", and
  grouped security updates (which the `npm` group in `dependabot.yml` uses)
  additionally require alerts enabled. With alerts off, the security-updates
  toggle has no advisory source: whether the toggle itself refuses to enable
  could not be verified read-only, but the observable failure is worse — it
  enables, the **Security** tab stays empty, and the item looks done while
  nothing can ever fire. Enable alerts first and the tab is also the
  verification surface.
- **Current state**: both off (re-verified 2026-10-13). The version-updates
  half is demonstrably alive — dependabot pull requests land weekly (e.g.
  #481, #482) — which makes the missing security half the only gap.
- **Done when**: Dependabot alerts reads "Enabled", the security-updates
  toggle reads "Enabled", and the **Security** tab lists Dependabot alerts
  (and their security-update pull requests) instead of nothing.

### 2. Make the `ci-verdict` check required on `main` — DONE

- **State (2026-10-13): done.** Verified via the API: `main`'s protection
  requires `gates` **and** `ci-verdict`. The rationale below is kept for the
  record — why this check and not a platform pipeline, and why the merge
  queue stays unadopted.
- **Where**: Settings → **Branches** → protection rule for `main` → edit →
  **Require status checks to pass** → add **`ci-verdict`** (keep **`gates`**;
  GitHub has been migrating this page to Settings → Rules → Rulesets — if the
  branch-protection page shows a migration banner, do the same edit there).
- **Why**: this is a long-standing backlog item. The three platform pipelines
  are path-filtered, so a docs-only pull request runs none of them — naming
  any platform pipeline as required would leave it "expected" and wedge the
  merge forever. `ci-verdict` is path-less: it always runs, and its verdict is
  derived from every check run that exists on the head commit, with the legs
  that never ran named out loud (see the header of
  `.github/workflows/ci-verdict.yml`). Requiring it closes the gap between
  "gates passed" and "everything that ran is green".
- **How**: the check name is exactly `ci-verdict` (the job id; the job sets no
  display name). If it does not appear in the picker yet, type the name
  manually — the picker lists checks that have already run at least once.
- **Merge queue — think before toggling, do not adopt casually**: with
  required status checks on, GitHub will suggest a merge queue so that
  "green at head" cannot silently become "red at merge". The honest context:
  `doc/decisions.md` **D13** records a rejection of `merge_group`/merge
  queue — but that rejection was scoped to a different problem (working
  around the release PR's check provenance: "it changes the merge model of
  the whole repository to work around one PR's provenance"). It does not
  automatically carry over, but a merge queue genuinely does change the
  repository's merge model, and this repo merges by squash on a standing
  owner authorization. Recommendation: make `ci-verdict` required now;
  reconsider the queue only if interleaved merges actually produce merged-main
  breakage, and land that as its own reviewed decision.
- **Deliberately not recommended here**: "Require review from Code Owners"
  (`.github/CODEOWNERS` now exists). Required reviews are 0 by design — the
  review routing file is a declaration, not a gate, and flipping it would put
  a human approval in front of every automated merge.
- **Done when**: `main`'s required checks list both `gates` and `ci-verdict`.
  *(Met — verified 2026-10-13.)*

### 3. Arm the `release` environment with a required reviewer

- **Where**: Settings → **Environments** → `release` → **Required
  reviewers** → add yourself → **Protect**.
- **State**: half-done, by design. The environment exists but has **no
  protection rules** (verified 2026-10-13 — the inert reference), and the
  workflow side has landed: all three package jobs (`release-ios.yml` job
  `ios-package`, `release-android.yml` job `android-package`,
  `release-harmony.yml` job `harmony-package`) declare
  `environment: release` (#271). The original sequencing warning — create the
  environment before the workflow references land — is resolved; what
  remains is exactly one checkbox page.
- **Why**: this turns "a release needs an explicit go" from a convention
  into a mechanical approval gate — on every tag push, each package job
  pauses until the reviewer approves, before it builds.
- **One checkbox decides what the gate is worth on a single-maintainer
  repo**: leave **Prevent self-review** OFF. Left off, the reviewer can
  approve the run they triggered — a recorded go, but your own; left on, the
  user who pushed the tag cannot approve it at all, which on a solo repo
  waits forever and parks the queued release runs. Treat the recorded
  approval as a deliberate second look by your future self, not a second
  pair of eyes (the fuller discussion lives in [release.md](release.md)).
- **Done when**: the `release` environment shows one required reviewer, and
  the next tag push pauses on that approval before packaging.

### 4. Turn on Discussions

- **Where**: Settings → General → **Features** → check **Discussions** →
  **Set up discussions**.
- **Why**: the beta-feedback channel. The default category set (Announcements,
  Ideas, Polls, Q&A — with Q&A as the general discussion) is enough to start;
  tune categories later if the beta traffic asks for it.
- **Current state**: off (re-verified 2026-10-13).
- **Done when**: the repository's **Discussions** tab renders.

### 5. Configure Pages — the workflow has landed red

- **Where**: Settings → **Pages** → **Build and deployment** → **Source** →
  **GitHub Actions**.
- **Why**: the wait named here is over: the deployment workflow has landed —
  `.github/workflows/pages.yml`, the lynx-client online demo — and its deploy
  leg fails on every qualifying push to `main`. The file header documents
  this as the expected first-run failure ("Pages not enabled"; latest red
  run 2026-10-12), so this is no longer "flip the switch when the workflow
  lands": the workflow is landed and red until you flip. The workflow alone
  was never enough — the switch is the missing half.
- **Current state**: off (re-verified 2026-10-13 — `has_pages: false`).
- **Done when**: the next `pages/demo` run on `main` deploys green and the
  demo URL serves.

### 6. Secret scanning — no action needed

- **State**: secret scanning **and** push protection are both **enabled**
  (verified 2026-09-30; the 2026-10-13 API re-check could not read that
  endpoint with this token — nothing suggests a change). Nothing to toggle;
  this item exists so nobody hunts for a switch that is already on.
  (Validity checks are off; leaving them off is fine — enabling them is an
  optional extra, not part of this runbook.)

### 7. Marketplace publish secrets and the `marketplace` environment

- **Where**: Settings → **Secrets and variables** → **Actions** (three
  secrets + one variable, below) and Settings → **Environments** →
  **New environment** → name `marketplace` → **Required reviewers** → add
  yourself → **Protect**.
- **State (2026-10-13)**: none of it exists yet — the repo's only Actions
  secret is the retired `RELEASE_PLEASE_TOKEN` (item 8), the only variable
  is unrelated to publishing, and there is no `marketplace` environment. The
  workflow side is ready and inert: `marketplace-publish.yml` already
  declares `environment: marketplace` (#271) — arming the environment is
  what makes the go gate real.
- **Why**: `.github/workflows/marketplace-publish.yml` packages
  `system-plugins/` into the frozen DSH package format and signs the
  catalog index with ed25519 — the signature IS the marketplace's trust
  (the 2026-10-01 contract proposal: tampered hosting can never produce an
  installable package). With no signing secret every run fails at the
  signing step, by design: the catalog does not exist unsigned. The
  deploy secrets are what turns a real publish from a loud failure into a
  deployment; the environment is what keeps a real publish a human's
  decision.
- **What to add, in order**:
  1. Generate the signing key:
     `node tools/marketplace-rotate-key.mjs gen --key-id dsh-market-1`.
     It prints the SEED and the raw public key. The seed is shown ONCE —
     it is never stored in the repository; copy it now. (Rotation later:
     the same tool's `window-index` subcommand — its header documents the
     whole dual-sign-window runbook.)
  2. Secret **`MARKETPLACE_SIGNING_KEY`** = the seed from step 1 (base64 of
     the 32-byte ed25519 seed — exactly what the tool printed).
  3. Variable **`MARKETPLACE_BASE_URL`** = the public URL prefix the
     packages will live under (e.g. `https://dl.example.com/market`).
     Every `tgzUrl` in the signed index is built from it; with neither the
     variable nor the dispatch input set, the run FAILS on purpose — a
     signed index never carries a placeholder URL.
  4. Deploy secrets (needed only for real publishes; dry-run works without
     them): **`MARKETPLACE_DEPLOY_HOST`** (`user@host` or an ssh alias),
     **`MARKETPLACE_DEPLOY_PATH`** (absolute target directory),
     **`MARKETPLACE_DEPLOY_SSH_KEY`** (a private key authorized on that
     host), **`MARKETPLACE_DEPLOY_PORT`** (optional, default 22). A real
     publish without them fails loud, naming each missing secret.
  5. The `marketplace` environment with yourself as required reviewer. The
     publish job pauses until you approve — same mechanics as the
     `release` environment (item 3), and the same arming advice: leave
     **Prevent self-review** OFF, the solo maintainer is the only
     reviewer, so checking it deadlocks every publish run. Until the
     environment is armed the workflow reference is inert — nothing waits.
- **The GitHub half is half the story**: a real publish also needs the
  hosting server — STANDBY since the 2026-10-01 probe (unreachable, no
  credentials; item 11 and
  [deploy/marketplace/README.md](../deploy/marketplace/README.md) hold the
  server checklist). The `dry_run` leg needs neither the deploy secrets nor
  the server.
- **Done when**: a `workflow_dispatch` run of marketplace/publish with
  `dry_run: true` (the default) ends green and carries the
  `marketplace-dist` artifact with a signature-verified index inside; and a
  real publish (tag `marketplace-v*`, or a dispatch with `dry_run`
  unchecked) waits on your approval, then deploys — `deploy.sh` verifies
  the remote index digest after upload, so the run also proves the bytes
  that landed.

### 8. Delete the retired `RELEASE_PLEASE_TOKEN` secret

- **Where**: Settings → **Secrets and variables** → **Actions** →
  `RELEASE_PLEASE_TOKEN` → remove.
- **Why**: `release-please` is retired (D14) and the secret "is read by
  nothing" ([release.md](release.md)) — yet it is still set (verified
  2026-10-13). A live credential nothing reads is attack surface and drift
  bait: the next reader wastes a round trip asking whether it matters.
- **Done when**: the Actions secrets list no longer shows
  `RELEASE_PLEASE_TOKEN`.

## Release-side actions

### 9. Give (or withhold) the release go — the tag push

- **Where**: not a settings page. The pipeline is documented in
  [release.md](release.md): **PREPARE** —
  `packages/release/bump-version.py X.Y.Z`, read the changelog it writes,
  land it as an **ordinary** pull request — then **PACKAGE** — push the
  `vX.Y.Z` tag; the three `release/<host>` workflows build per host and
  attach the packages to the tag's Release. With item 3 armed, each package
  job then pauses for your approval: the go becomes a recorded click.
- **Why**: the release has been staged and explicitly waiting on the
  owner's go since 2026-09-30 — the draft notes
  ([release-notes-v0.0.2.md](release-notes-v0.0.2.md)) and the regression
  evidence package
  ([release-checks/release-regression-v0.0.2.md](release-checks/release-regression-v0.0.2.md))
  were cut that day, and the package says it outright: "No release action
  (bump, tag, release) was executed — that is the owner's explicit go."
  `version.txt` still reads `0.0.1` (verified 2026-10-13): nothing has
  shipped since v0.0.1 (2026-09-21). The evidence package names its own cut
  line and is now two weeks stale — `main` has moved hundreds of commits —
  so the informed go decides what that means: rerun the regression, or
  accept CI's dev legs and record that choice.
- **The version number is your call at bump time**: the prepared drafts say
  v0.0.2, session memory has said v0.0.3, and `bump-version.py` prints what
  the commits since the last tag imply as a hint — a person makes the call,
  and the script insists on it.
- **Done when**: the tag's Release carries the three packages — or the hold
  is explicit: a "not yet" with a date and a reason beats a silent wait,
  which is how this item became a backlog row.

### 10. Google Play registration — memory-only row, confirm or strike

- **Provenance first**: this row is recorded from project session memory
  (2026-10). **Nothing in the repository corroborates it** — no Play/2SV
  record in `doc/`, the agent notes, or the commit log (checked
  2026-10-13). If your Play Console shows no such block, delete this row;
  the runbook must not outlive its facts.
- **Where**: Play Console — the 2-Step Verification challenge (phone-side;
  only the account owner can complete it) and the account dashboard behind
  it.
- **Why**: per that memory, registration is parked mid-flow at the 2SV
  step. The runbook's job is to make the stuck point visible to the one
  person who can unstick it, instead of letting it live only in a chat log.
- **Done when**: 2SV is cleared and registration proceeds. After that, the
  standard requirement for personal developer accounts (created after
  2023-11-13) applies before production access: a closed track with at
  least **12 testers opted in continuously for 14 days** (Google's
  policy). The Android package those testers install is item 9's output.

## Server-side actions — the STANDBY packages

### 11. Marketplace hosting: un-standby it (or record the hold)

- **Where**: the owner checklist in
  [deploy/marketplace/README.md](../deploy/marketplace/README.md) — a
  reachable host + an authorized SSH key, the security group open on
  80/443, a domain with TLS (caddy recommended) — plus item 7's
  `MARKETPLACE_DEPLOY_*` secrets. Your server console and your GitHub
  settings page, in that order.
- **Why**: the marketplace v0 is a signed static site; CI can sign the
  catalog (item 7), but the bytes need a home. The hosting kit has been
  **STANDBY since its 2026-10-01 probe**: the server was unreachable and
  the machine held no credentials — nothing deployed, and the README
  claims exactly that, with the probe record attached. `deploy-local.sh`
  fails loud until `DEPLOY_HOST` exists: the standby state is by design,
  not an error to work around.
- **Done when**: an SSH probe to the real host answers, item 7's secrets
  exist, and a real publish leaves a signature-verified index at the
  domain (`deploy.sh` verifies the remote index digest after upload) — or
  the hold is recorded here with a date.

### 12. IdP standby package: deploy or hold

- **Where**: the owner checklist in
  [deploy/idp/README.md](../deploy/idp/README.md) — a Linux host sized for
  Logto, operator SSH keys, a security group (80/443 public, 22
  restricted), two DNS names for Logto's `ENDPOINT`/`ADMIN_ENDPOINT`.
- **Why**: marketplace v2 (publisher identity) needs an OIDC IdP. The
  package is prepared and pinned — Logto preferred, PocketBase as the
  honest fallback — and **STANDBY since 2026-10-01** (same probe outcome:
  unreachable, missing credentials). Nothing downstream is blocked on it
  today; this is an owner prioritization call, which is exactly why it
  belongs in this runbook instead of in someone's memory.
- **Done when**: `./deploy.sh --host USER@HOST --check-only` answers
  against the real host and you either run the full deploy or record the
  hold.

## Local machine actions

### 13. Refresh `~/tools/aoci` to the next official release

- **Where**: `~/tools/aoci/aoci` — this machine, not GitHub.
- **State (2026-10-13)**: the binary is a one-off build from upstream
  `main` — `v0.1.0-rc20-62-g7586820`, built 2026-10-13 — not a release
  artifact. It exists because of a now-resolved blocker: upstream
  [aoci-spec/aoci-code#117](https://github.com/aoci-spec/aoci-code/issues/117)
  (twin-identical orphan Entries refused removal with a backwards
  `write_conflict`). The fix landed on upstream `main`, the local binary
  was cut from it, and the three parked twin orphans were removed with it
  (#490) — the repository reports zero orphans as of today. (The issue
  itself stays open pending the maintainers' rc21 verification round.) An
  earlier draft of this row read "wait for rc21" — overtaken by events.
- **Why**: a dev build is unreproducible; an official release tag is the
  supported artifact, and future sessions' cognition receipts cite the MCP
  service version.
- **Done when**: `~/tools/aoci/aoci --version` reports an official release
  tag (rc21 or later, no `-g<sha>` dev suffix) and the repository's MCP
  service answers on it. Until then nothing is blocked: the current build
  is newer than rc20.

---

- Bilingual counterpart: [github-owner-actions.zh.md](github-owner-actions.zh.md)
- Related: [release.md](release.md) (the tag-push release model the `release`
  environment gates) · the STANDBY packages:
  [deploy/marketplace/README.md](../deploy/marketplace/README.md) and
  [deploy/idp/README.md](../deploy/idp/README.md)
