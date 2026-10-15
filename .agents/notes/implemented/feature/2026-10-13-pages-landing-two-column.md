# Agent Note: the Pages landing becomes a two-column page per the finalized design plate

Status: implemented
Related: D5 (token single source, by way of the demo's zero-own-palette rule)

## Problem

The Pages demo landed as a proof of the mount recipe, not as a landing page:
a single centered column stacked the wordmark, one tagline line and a hint
above the client frame, and a visitor got no pitch, no statement of what the
product actually does, and no path to the docs or source. Three accessibility
deltas rode along: the hint and footer sat in `--text3` (#6B7686 on the
`--bg` #0B0F14 base computes to ~4.17:1 — below the 4.5:1 small-text minimum,
`accessibility.md › Vision` contrast table) at under 12px; links had no
visible keyboard-focus state; and the only heading was the wordmark `h1`.
A finalized design plate called for a two-column landing that fixes these
without inventing a visual language the demo does not own.

## Decision

`presentation/lynx-client/demo/index.html` is rebuilt to the plate. At
>=760px a two-column grid (max-width 1060px, centered): the left column
carries the wordmark (28px/700/3px tracking), one pitch paragraph, three
capability rows (bold lead + short description, wording from README
"What works today"), and a project-links row (Read the docs / Architecture /
Source, `target="_blank" rel="noopener"`); the right column is the glass
frame — the unchanged `.frame` token surface holding the byte-identical
`<lynx-view url="./main.web.bundle">` mount, `web-core/static/js/client.js`
module script, and shadow-root flex compensation — sticky and vertically
centered while the left column scrolls. Below 760px it degrades to the
single column (intro, frame+hint, footer). A11y: hint and footer promoted to
`--text2` at 12px (#9AA4B2 on #0B0F14 computes to ~7.6:1 — above the 4.5:1
minimum and the 7:1 small-text aspiration, `dark-mode.md › Best practices`);
links are underlined (link identity is not color-alone) and carry a
`:focus-visible` outline in `--text`; heading hierarchy is `h1` (wordmark) to
`h2` ("What works"); landmarks (main/header/nav/footer) are kept. The aurora
backdrop stays static — the page ships no motion at all, so
prefers-reduced-motion is satisfied by absence rather than a media query
(`accessibility.md › Cognitive`: Reduce Motion exists to reduce automatic
animation; an animation-free page has none to reduce). Meta gains
`description`, `og:title`, `og:description`, `og:type` — deliberately no
`og:image`. The page language stays English (a public landing for a public
repo; the in-repo bilingual pairing rule governs docs, not the deployed
artifact). Every color, radius and gradient remains a token custom property;
zero palette is introduced. Trade-off stated honestly: 12px sits under the
HIG 10 pt (~13.3px) desktop minimum (`typography.md › Ensuring legibility`
table) — the plate's explicit call, compensated with the 7.6:1 contrast
above.

## Alternatives considered

- **Redo the whole brand visual (new palette, display typeface, gradient
  CTAs)**: rejected — token single-source discipline. Every value must flow
  from theme/tokens.json through web.tokens.css; a second visual language on
  the landing page would drift from the product's own face, which is exactly
  what the demo exists to show. The signature stays "the real client in a
  glass frame"; everything around it stays quiet (no 01/02/03 markers, no
  gradient buttons, no new fonts).
- **Numbered capability markers**: rejected — three parallel capabilities
  are not a sequence; numbering would be structure that says something
  false.
- **Animated aurora gated by prefers-reduced-motion**: rejected — with zero
  animation there is nothing to reduce; adding motion only to gate it spends
  complexity on nothing.
- **Upgrading the copy to "live demo"**: rejected — no session backend is
  connected; the honest "Static preview: the UI shell runs; no session
  backend is connected." sentence survives verbatim, now as the frame's
  caption.
- **A bilingual (en/zh) landing**: rejected — the public Pages face follows
  the repo's English-first public surface; a language switch would add
  surface the plate did not ask for.

## Consequences

- The page now scrolls (the old `body { overflow: hidden }` full-viewport
  shell is gone); on short viewports the sticky frame keeps the client
  visible while the intro scrolls.
- The plate's finalized 12px hint/footer size is below the HIG desktop
  minimum by ~1.3px — revisiting means touching the plate, not a regression
  introduced here.
- stage-pages.sh is untouched: the staged artifact layout is identical, so
  the pages.yml pull_request leg validates this page with no workflow
  change.
