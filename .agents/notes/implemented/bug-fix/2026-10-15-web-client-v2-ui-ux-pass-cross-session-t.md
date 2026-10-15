# Agent Note: web-client-v2 UI/UX pass: cross-session transcript leak, WCAG-AA tone layer, type and target floors

Status: implemented

## Problem

An apple-design five-lens audit of `presentation/web-client-v2/web` (driven on the
live `tools/dev-web-carrier` next-mode carrier, mobile viewport, dark and light)
found one Critical functional defect and a cluster of accessibility failures.
Worst: every `openSession` appended a fresh transcript host pair to `#transcript`
without clearing it, so the previous session's rows stayed visible on top of the
new session's transcript (measured: 4 host nodes after two opens; the before
screenshots show a new session opening with the fixture session's "回合结束（未知）"
rows above its own user bubble) and the DOM grew without bound over a long app
life. Alongside it: light-theme tertiary text `#8A93A3` measured 2.64–3.10:1 and
dark `#6B7686` 3.60–4.17:1 (both under the 4.5:1 floor HIG accessibility quotes
from WCAG AA); the semantic hues faired worse in small sizes (light orange tool
text 2.35:1, chips 2.27–3.25:1, dark reasoning purple 3.10:1, dark links 3.99:1,
home session meta 4.35:1 at the backdrop's bright regions); three labels sat
below the 11 pt type minimum (9.5 / 10 / 10.5 px); the ambient animations
(ocean drift, status dot, stream caret) had no `prefers-reduced-motion` answer;
the reasoning expander was a pointer-only `<div>` (~19 px tall, no keyboard or
screen-reader reach); the copy affordance measured ~25 px tall.

## Decision

`createChatRenderer` now `replaceChildren`s its host pair, so each session owns
exactly one transcript (the scroll-pinning wiring moved to a `wirePinToBottom`
helper to stay inside the code-size function cap). theme.css gains an adaptive
small-text tone layer — `--link`, `--tone-tool`, `--tone-reason`, `--tone-fail`,
`--tone-done` — the SAME semantic meanings as the brand hues, tuned per
appearance so every one clears 4.5:1 on its worst real surface (values computed,
documented inline next to each token); `--text-3` moved to `#667085` light /
`#828C9C` dark (≥4.5:1 on bg and raised). The 9.5/10/10.5 px labels sit at the
11 px floor (weight lowered 800→700 so the eyebrows stay quiet); the session-row
meta dropped its 0.75 opacity (full mist, worst case 6.33:1). The reasoning
expander is a real button with a 28 px min-height, the copy affordance 28 px
tall, and the back / send / jump-latest controls 44 px. Both stylesheets stop
the ambient loops under `prefers-reduced-motion`. Copy: the process-group header
no longer appends a meaningless `· N` (it counted reasoning+tool items, not
anything a reader could act on), and a session row's meta line no longer repeats
the short id its title already shows. Onboarding inputs render at 16 px so
WKWebView/ArkWeb do not zoom the page on focus.

## Alternatives considered

- Re-deriving the whole palette for higher contrast (new brand tokens): rejected
  — the clarklevis deep-ocean palette is the product's own visual and passes
  everywhere text is large; only small colored text needed dedicated faces, so a
  tone layer preserves identity and fixes legibility with five tokens.
- Raising contrast by darkening the light-theme `--text-3` to match `--text-2`
  (#5F6B7A-class values): rejected — it collapses the visual difference between
  the secondary and tertiary tiers; #667085 clears 4.5:1 on every surface the
  tier actually sits on except `--fill`, whose one occupant
  (`.item-notice-label`) moved to `--text-2` instead.
- Fixing the transcript leak in `openSession` (clearing `#transcript` in
  main.js): rejected — the renderer owns the host nodes it creates; clearing at
  the call site would leave two owners for one subtree and regress again the
  next time a renderer is built.
- Remaking the session-row title from a future title surface instead of the
  short id: noted as the v2 ask (render-home.js header already says so); out of
  scope for a restraint-first pass.
- A light "减少了动画" user setting: rejected — the system media query is the
  platform answer; an app-specific toggle contradicts HIG dark-mode/motion
  guidance about app-specific switches.
