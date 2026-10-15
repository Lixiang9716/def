# Agent Note: dev-web-carrier BYOK onboarding legs + the web-client-v2 onboarding panel's audit pass

Status: implemented
Related: D9

## Problem

The local dev carrier (`tools/dev-web-carrier`, both the official-client
carrier and the `--client next` mode that serves web-client-v2) answered
`onboarding/status` with the structured `gateway/unimplemented` envelope —
so in the local loop the BYOK first-run panel never appeared (the panel
shows only when status answers `mode:"mock"`), and the #519 UX pass had to
skip auditing it for lack of a screenshot. The carrier's claim surface and
the panel's wire had drifted apart: every on-device seat serves
`onboarding/status|save|clear` (the coverage plane,
`runtime/dsh/upstream/web-write-onboarding.js`; the harmony seat's recorded
wire confirms the shapes), the dev carrier served none of them.

The panel itself had never been through the five-lens audit its siblings
had: keyboard focus, the key-reveal toggle's hit region, and the
contrast/type floors were unverified on this surface.

## Decision

The carrier's onboarding legs ship as one pure module,
`tools/dev-web-carrier/onboarding-route.mjs` (the plugins-route.mjs
precedent: pure exported face, server files stay unimportable), mounted by
BOTH carriers — `dev-carrier.mjs`'s `apiOutcome` and `next-mode.mjs`'s api
handler — over an in-memory mock keychain. Shapes are the runtime legs'
field for field: status answers the mockRoute boot face
(`{mode:'mock', provider:'mock', model:'mock-1'}`) or byok after a save
(`{mode:'byok', provider, baseURL, model}` — never the key, never
contextWindow); save validates with the runtime credential grammar
mirrored (llm-route.js validateCredential, same rejects, same order, same
`onboarding/save: <field> — <why>` message shape) and stores exactly the
runtime's encodeCredential fields; clear takes no arguments, deletes the
ref, is idempotent. The `onboarding/test` probe stream deliberately stays
`gateway/unimplemented`: a probe is a real chat-completions turn over the
caller's endpoint, and a dev carrier dialing arbitrary URLs with pasted
keys would be a new surface, not a port; the panel renders the probe
failure readably and keeps Save disabled (its own gate), so the status/
save/clear round trip and the manage face stay fully exercisable.
`onboarding-route.test.mjs` pins 24 behaviors (boot face, the flip, no key
material on the wire, 11 bad-request rejects with keychain unchanged,
idempotent clear, re-save, fall-through, grammar boundaries).

The panel audit (apple-design five lenses, computed values on the live
carrier, dark + light) came back GOOD — every text tier already clears
4.5:1 on the glass card in both appearances (lowest: the 0.6-opacity
bilingual label at 4.85:1 light; enabled save white-on-ocean 4.81:1), and
all type sits at or above the 11 pt floor. Two fixes landed, both inside
the #519 caliber (tone layer / type floors / touch targets), no redesign:
a deliberate `:focus-visible` rule in theme.css (2px `var(--link)`
outline — every control is custom-styled borderless, so the engines'
leftover UA rings were the only indicator; the desktop dev loop
tab-navigates this same page), and the key-reveal toggle now stretches to
its field's height (37→47px hit region, the row's input it toggles) via
`align-items: stretch` on `.onboarding-key-row`. Mirrors re-staged
(android assets, harmony rawfile) byte-identical through the stagers.

## Alternatives considered

- Porting the runtime modules directly (`import` from
  `runtime/dsh/upstream/`) into the carrier: rejected — the runtime legs
  import the gateway and logger bindings that only exist inside the
  QuickJS runtime; the repo's stated convention for cross-surface
  vocabulary is deliberate mirroring (onboarding-core.js, web-write-llm.js
  all do this), so the carrier mirrors the pure grammar with a test net
  pinning the mirror to the wire shapes.
- Implementing `onboarding/test` in the carrier (a scripted loopback
  probe like next-mode's dev-echo turn): rejected for this round — it
  would make the carrier a proxy that dials whatever URL a pasted key
  claims, a new network surface the real carrier only exposes through the
  runtime's transport; the honest unimplemented envelope is the same
  answer an older seat gives, and the page already renders it gracefully.
  If a round needs the full setup flow locally, a loopback-only scripted
  probe over next-mode's fixture machinery is the shape to revisit.
- Scoping the focus rule to the onboarding panel only: rejected — focus
  is not panel-specific; a per-panel rule would leave the rest of the
  page's controls with engine-default rings, which is exactly the
  inconsistency the rule removes.
- Swapping the key-toggle's 👁 emoji for a monochrome glyph (craft lens
  note: it is the only color emoji on the panel): left as-is — a glyph
  swap is a design decision outside the uncontroversial caliber, and the
  control is labeled (aria-label) and functional.
- Accepting the save button's two-line label wrap at 390px (craft lens
  note): left as-is — both buttons stretch to equal height and the wrap
  is the honest responsive behavior of a bilingual label, not a defect.
