# Agent Note: the creation tool speaks the measured plugin contract

Status: implemented

## Problem

The `dsh-create` tool (`plugin_create`) taught the model a contract written
from the implementation's intent, not from the measured upstream facts, and
it taught only a fragment of the surface. The description said `kind` was
"timer or e.g. calendar" while the generated template can in fact render
only timer/calendar — a custom kind without authored source silently dated a
card instead of refusing. Mount failures surfaced as one-line strings (or
throws) with no step, no underlying reason, and no remediation, so the model
could not self-correct: it renamed plugins to escape "already mounted",
retried after the user had explicitly declined the approval dialog, and had
no way to learn WHY a source failed to link. And the description was silent
on everything authoring actually depends on: `ctx.effect`'s
setup-returns-disposer semantics under vendored cordis@4.0.2, the one-shot
timers-shim discipline plus its mandatory `import "upstream/shims/timers.js"`,
the loader's bare-import map (what a plugin may import at all), the
`LlmAdapter` base-class rule, the `card.present/card.state/card.complete`
field table (a missing card `id` is silently dropped by every host), and it
shipped no runnable example. Chat-created plugins therefore needed several
corrective turns; one-shot correctness is the bar, and it was not being met.

## Decision

`dsh-create` v0.3.0 hardens the creation flow on four layers:

1. **The description carries the measured contract** (`PLUGIN_CREATE_DESCRIPTION`,
   module-level constant). The trigger broadens beyond the literal
   做/创建插件 to ANY make-a-runnable-thing ask (app, pomodoro, countdown,
   habit tracker, …) while keeping first-reply / no-text-answer /
   no-confirmation. A numbered authoring contract states the measured facts,
   each grounded in its consumer: `ctx.effect` runs setup immediately and its
   return value IS the disposer (Promise/generator collect async disposers,
   null/undefined register nothing, anything else throws); timers require the
   shim import and setTimeout is ONE-SHOT — repetition is a re-arm loop, with
   setInterval demoted to a polyfill that warns; imports resolve through the
   loader map only (bundle-root modules, shimmed node: builtins, pinned
   vendored packages); LLM adapters MUST extend `LlmAdapter` and register via
   `ctx.llm.registerAdapter` with `attributionHeaders()` on every request; the
   card.* message field table (id REQUIRED — silently dropped otherwise; only
   "timer" gets the countdown face; presenting again replaces; state re-anchors
   remainingMs/label only; complete auto-dismisses on iOS/Android, stays on
   harmony). One ≤20-line runnable pomodoro example closes it — the disposer
   must stop the loop AND the posts — all within a ~40-line description budget.
2. **kind converges to an enum.** `TEMPLATE_KINDS = ['timer','calendar']`;
   a custom kind without `indexSource` refuses BEFORE any write, naming the
   supported list; with authored source, kind rides the manifest as the free
   field it always was (proved by the flip probe: a `kind: "hologram"` plugin
   with source mounts and runs).
3. **Mount refusals are structured in-band values, never throws:** step +
   underlying reason verbatim + a step-specific remediation. Approval refusal
   = the user's decision, do not retry; `context` = already mounted, with the
   honest statement that session tools cannot unmount a live fiber — take a
   new name or have the user remove it in the app's plugin management;
   authoring breaks = fix indexSource and re-call with the SAME name (renaming
   never fixes source). An authored source calling `setInterval` still writes
   and mounts, but the result carries a non-blocking discipline warn (the
   clean control draws none).
4. **The generated template learns the discipline it preaches:** the timer
   loop gains the alive-flag disposer so unmount stops the loop AND the posts.

The negative legs are pinned deterministically in the plugin.forms CLI e2e
leg as a new phase 11 (`runtime/dsh/scenario/plugin-forms-refusals.js`,
split out of the driver for the code-size cap): bad syntax and a plugin-less
export refuse at `linked` with the registry adoption rolled back and no live
fiber left; an unknown template kind refuses with the supported list;
a same-name remount refuses at `context` with the live fiber undisturbed;
the setInterval warn rides the dirty result with a clean control
(`create.refused` ×2, `create.kindrefused`, `create.warned` — pinned in
`test/e2e/scenarios/plugin-forms.json`, receipt `proves` extended). Docs:
`docs/plugin-dev.md` + `.zh.md` gain "The chat-created plugin contract"
(the same contract, human-facing) and the ctx.effect example switches from
setInterval to the re-arm discipline; the pairing record is re-confirmed.
Staged images re-synced byte-identical (android assets + harmony rawfile,
sha256 abd00be7…; `build/build.sh sync android|harmony` idempotent).

Acceptance honesty: the refusal legs are deterministic and green; the
POSITIVE one-shot write rate against a real LLM remains the owner's manual
acceptance test — this change hardens what the model is told and how
failures teach, it cannot prove the hit rate from a CLI leg.

## Alternatives considered

- **Longer prose without the runnable example** (smaller token cost): lost —
  the example is the part the model copies verbatim; a contract the model
  must generalize from needs one whole worked instance, and the ~40-line
  budget already prices the prose tightly.
- **Throwing on authoring/mount failure** (the old face, less code): lost —
  a throw reaches the model as a generic tool error, indistinguishable from
  a transport failure; in-band `{mounted:false, step, reason}` + remediation
  lets the model fix and re-call inside the same turn. Throws carried
  strictly less information.
- **Hard-refusing setInterval at mount** (discipline as a gate): lost — the
  shim's re-arm polyfill genuinely runs, so the refusal would veto working
  (if fragile) plugins; the non-blocking warn keeps the honest statement
  without blocking the user's ask.
- **Auto-replace on same-name remount** (unmount + remount inside the tool):
  lost — no session tool unmounts a live fiber today (`plugin_manager`
  remove_bundle edits the registry row only; the remove face is the app's
  plugin-management plane), and building an unmount path into the creation
  tool would reach around the gateway; the remediation text states the real
  options instead of pretending one exists.
- **A separate plugin_lint tool the model must call before creating**: lost —
  an extra round-trip the model can forget; refusal-with-remediation keeps
  one tool and one turn, and the failure already carries the exact step.
