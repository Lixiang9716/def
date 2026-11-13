# Agent Note: the dsh-mcp plugin — approval granularity and the two config grammars

Status: implemented
Related: plan §4.2, D5, D6, D8, T-0301, the T-0269 transport note (2026-10-20)

## Problem

Plan §4.2 named one open design question for an Agent Note: **approval
granularity** for a system plugin that mounts EXTERNAL tools into the
session — the first place the model's toolset reaches beyond this
repository's own contracts onto arbitrary third-party servers. The question:
when the plugin connects a server and registers `mcp_<server>_<tool>`, who
authorized that, at what granularity, and what does the user see?

A second, smaller question surfaced during implementation: the CLI's
`--env` launch-env parser structurally refuses quotes
(`example/main_cli.c:1865` — an injection guard), so the plan's suggested
`DSH_MCP_SERVERS` env tier could not carry the JSON roster spelling.

## Decision

**Approval granularity: per-server, one-time, CONFIG-SIGNED.** Listing a
server in the config IS the grant. The plugin records one
`mcp/server.authorized {server, url, basis: 'config'}` before the first
connect, and the connect proceeds. Nothing is cached across boots; the
config is re-read every boot, so the standing grant is exactly the standing
config.

Why this is the honest v1, not a shortcut:

- **The authority is already the user.** The config surfaces
  (`__dshMcpServers` global / `DSH_MCP_SERVERS` env) are assembled by the
  host operator — the same person an approval dialog would ask. A dialog
  asking "connect to the server you just configured?" is theater, not
  consent.
- **Per-tool approval is prompt fatigue** (rejected): an MCP server can
  list dozens of tools; approving each registration is a cascade of dialogs
  that trains the user to approve blindly — the opposite of the intended
  safety.
- **Tool RUNS are not registrations.** The dangerous act is calling the
  tool, and every call already crosses the session's own approval seams
  where the session policy demands them (the #441 approval boundaries are
  tool-run-time, not registration-time). Registration-time approval adds a
  second gate at the layer where nothing executes.

**The named v2 step-up** (when there is a UI to manage servers): the first
connect of a server NOT in the static config — i.e. a server the user added
through a settings surface at runtime — presents `face.approval@1` (the
R3 approval face) with a remember policy riding the keychain. The scripted
approval seams the hosts already have (`-dsh-script-approval` /
`dsh.script.approval`) make that leg deterministically testable. v1 has no
runtime server-add surface, so there is nothing to step up yet — the gate
would guard an absent action.

**Config grammars: two spellings, one face.** The global tier
(`__dshMcpServers`) speaks the JSON array (the carriers' spelling). The env
tier accepts EITHER the JSON array OR a quote-free pipe grammar —
`name|url[|credentialRef[|headerName]]`, rows on `;` — because the CLI's
`--env` guard refuses quotes and would otherwise make the env tier
unreachable from the launch environment (the probe leg's runner passes
exactly this grammar). One small parser, two documented spellings; the
pipe grammar is named in the plugin header next to the face it serves.

## Alternatives considered

- **Per-tool registration approval** (a dialog per `mcp_<server>_<tool>`): rejected —
  prompt fatigue trains blind approving; a server listing forty tools would fire forty
  dialogs for tools the session may never call.
- **No record at all** (connect silently): rejected — the `mcp/server.authorized` record
  is what makes the grant auditable; a silent connect is indistinguishable from an
  accidental one in the E2E stream and the audit trail.
- **presentApproval at v1 with an always-auto CLI answer**: rejected — a CLI backend that
  answers its own approval dialog is the approval-as-theater shape; the honest CLI v0 is
  config-signed, and the dialog joins when a runtime-add surface exists to guard.
- **JSON-only env tier**: rejected — the CLI `--env` guard refuses quotes
  (example/main_cli.c:1865), so JSON would leave the launch-env face provable only by the
  carriers; the pipe grammar keeps the CLI leg real at the cost of one small parser.

## Consequences

- The E2E leg proves the whole chain on the CLI: def-bundle mount →
  DSH_MCP_SERVERS (pipe grammar) → keychain credential roundtrip → vendored
  transport connect → listTools → `mcp_demo_echo`/`mcp_demo_add` through
  the REAL ToolRuntime dispatch → the two error layers, both structured
  (the toolset's local INVALID_ARGS refusal; the server's isError content
  forwarded as the tool outcome).
- The mock gained one probe-safe isError trigger (`add(0, 0)` → isError
  content result). The T-0269 probe manifest pins nothing this changes
  (it dials 19+23 and echoes; the tools-listed names are unchanged).
- The v2 rows, named: face.approval@1 step-up for runtime-added servers;
  a server-management settings surface (which is also when the plugin
  joins the spine inventory — v1 omits the inventory row because the
  inventory mapper's exact-name `visibleTools.has(tool)` check has no
  stable name for a dynamic `mcp_*` roster, and a wildcard row would lie);
  OAuth step-up rides the vendored transport's own flows, evaluated
  together with BYOK storage per plan §4.3.
