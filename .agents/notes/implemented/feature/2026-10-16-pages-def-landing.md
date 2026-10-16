# Pages landing: the def identity, matte page / glowing client

Status: implemented
Date: 2026-10-16
Class: feature
Supersedes: the #524-era landing hierarchy (product-page-first with a
tech-stack hero) — that page's structure survives in git history; its
honest-caption-above-the-frame decision is carried forward, not superseded.

## Problem

The Pages landing page sold the implementation (QuickJS runtime, capability
gateway, pluggable web client) instead of the product's own identity. The
owner settled the content direction in the 2026-10-16 design review: the
page leads with vision ("It starts undefined. You define it."), wears the
def identity, and ships nothing fictional — capability examples appear only
when real ones exist. A further review finding stood from the same day: the
previous aurora-and-glass treatment put glass on content cards, which fails
the liquid-glass review checklist (glass is for the floating functional
layer, never content). The page also had to keep consuming the generated
token face only (`web.tokens.css` from `theme/tokens.json`) — earlier
redesign proposals with their own palettes were rejected on exactly that
single-source discipline.

## Decision

`presentation/lynx-client/demo/index.html` is rebuilt around one material
idea — the page is matte, the product is the only light:

- Hero is the owner's line verbatim; the def wordmark (with an unblinking
  cursor) names the product; title/meta keep dsh-mobile for discoverability.
- The debossed UNDEFINED seal is the page's single bold object. The
  "What can it do" section holds six honest empty seats (the real extension
  vocabulary: tool, command, skill, preset, plugin, card), each marked
  `unclaimed`; the section chip carries `data-state="UNDEFINED"` and is the
  flip target to PASS when a real example lands (mechanism documented in
  the HTML comment). No fictional screenshots, numbers, or example names.
- Surfaces are recessed/engraved (inset shadows, hairline + light lip, 4.5%
  film grain) — no glass anywhere. The aurora tokens glow only behind the
  live client frame ("matte page, glowing product").
- Type: Schibsted Grotesk (SIL OFL 1.1, `OFL.txt` ships beside the woff2)
  self-hosted for display; system stack for body; the monospace stack is
  reserved for genuine machine state (`unclaimed`, the stamp chip).
  `stage-pages.sh` stages the font + license and fails loud if either is
  missing.
- Token discipline is kept: every chromatic value is a `var()` from the
  generated face; alpha variants derive via `color-mix`; neutral
  black/white appear only as material light (shadows, recess darkening,
  grain), documented in the page header.
- No motion ships: hover/focus color transitions only, scroll-behavior is
  guarded by `prefers-reduced-motion`, so reduced motion is satisfied by
  absence.

## Alternatives considered

- **Keep the tech-stack hero (#524 face)**: rejected — it describes the
  implementation, not the product; the owner redirected the content
  direction to vision-first.
- **Glass cards over the aurora backdrop (the #514 face)**: rejected —
  glass on content fails the liquid-glass checklist, and three identical
  glass cards read as the generic SaaS kit.
- **A new landing palette** (earlier same-day proposals V2/V3): rejected —
  collides with the tokens.json single-source discipline that the page's
  own footer states.
- **Google Fonts CSS embed instead of a committed woff2**: rejected — it
  adds a third-party runtime dependency to a page whose deploy artifact is
  fully staged from the repo; a 46 KB committed OFL file with its license
  keeps the artifact self-contained (the pin is reviewed in the diff, same
  discipline as any vendored asset).

## Consequences

- When the first real plugin examples exist, filling a seat is a content
  edit plus flipping the chip's `data-state` and text to PASS — the
  mechanism is annotated in the HTML.
- The display face is a committed binary (~46 KB); regenerating or
  swapping it means re-checking the OFL file beside it.
- `stage-pages.sh` now fails loud on the font file, so a lost asset breaks
  staging at the right place instead of silently degrading typography.

## Correction (same day, before the ink dried)

The full owner-correction record (five rounds, 2026-10-16 morning session)
superseded two choices this landing made when it first shipped (#558):

- **The live client mount is gone.** Correction 3 had already removed the
  phone/client section from every approved mockup, with the implementation
  note that the real page drops the lynx-view mount, the web-core scripts,
  and the staged bundle — a pure static single page. #558 kept the mount;
  this correction removes it. `stage-pages.sh` stages page + font + license
  only, and `pages.yml` loses the npm/build/pin steps (its header records
  the bundle's history).
- **The INIT PALETTE law.** Correction 4: the page renders in pure neutral
  grayscale — neutral IS the undefined state — and the only color it may
  ever carry is verification green, only on verified facts (a PASS stamp,
  counted evidence). #558 used the product's ocean blue as its living
  accent; this correction replaces every chromatic value with the page's
  own neutral scale (`:root` in the page header), inverts the primary CTA
  to solid ink, and reserves `--verified: #4ADE80` as the documented,
  currently-unused contract. The page no longer consumes
  theme/tokens.json, so the old "every color is a theme token" footer
  claim is replaced by the law itself.

What survives from #558 unchanged: the hero line, the def wordmark, the
debossed UNDEFINED seal (now gray by law — grayscale is the undefined
state), the six honest seats and the UNDEFINED→PASS flip mechanism, the
material language (recess, engraving, grain), the self-hosted display
face, and the no-motion stance.
