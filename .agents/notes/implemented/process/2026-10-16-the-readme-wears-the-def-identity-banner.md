# Agent Note: The README wears the def identity — a designed banner and a hero-first opening

Status: implemented
Related: supersedes the front-door framing of
`2026-10-15-the-readme-becomes-a-human-first-front-d.md` (the human-first
structure and the evidence value it protected are kept whole) and refreshes
the site CTA line of `2026-10-16-the-readme-currency-refresh-the-live-sit.md`.

## Problem

The README opens as a plain `# dsh-mobile` title plus a paragraph — typographically
anonymous, and by now off-identity: the product's public face is the def landing
page (the app you define; "It starts undefined. You define it."), while the repo
front door still leads with the host's name and no visual identity. The same pass
surfaced currency drift the #562 landing change created: three lines still told
readers the project site renders the Lynx client live, which stopped being true
when the page went pure-static.

## Decision

Both README ±zh gain a hero-first opening and a designed banner, then keep every
section of the human-first structure intact:

- **Banner**: `doc/assets/banner-{dark,light}.svg` — the def wordmark with its
  cursor, the owner's line verbatim ("It starts undefined. You define it."), and
  the debossed UNDEFINED seal, on a 1200×336 neutral ground with film grain and a
  top sheen. Wired through `<picture>` with `prefers-color-scheme` sources so
  GitHub renders the right face. The INIT PALETTE law holds: pure neutral
  grayscale, no green — nothing on a banner is a verified fact. System font
  stack only (`<img>`-embedded SVG cannot load webfonts; the display face stays
  the landing page's privilege).
- **Hero block**: centered under the banner — one identity line ("def — the app
  you define; dsh-mobile is the open-source mobile host behind it"), then one
  link row (project site, what-works anchor, quickstart anchor, language
  switch). The old `# dsh-mobile` h1 and the "see it in the browser first"
  paragraph fold into this block; the language-switch line survives below it for
  plain-text readers.
- **Currency fixes** (rule 12, riding the same PR): the three "live Lynx render
  on the project site" claims (intro, the UI-is-a-plugin bullet, the quickstart
  fallback) now describe the site honestly — the UI-is-a-plugin bullet cites the
  render-surface pilot, and the no-toolchain fallback says the site tells you
  what the project is.
- Typography everywhere else is untouched: the human-first sections, the
  milestone table, and the doc map keep their #512-verified shape.

## Alternatives considered

- **Shields.io badge row instead of a designed banner** — rejected: badge chrome
  is the template look every repo wears, carries third-party color the INIT
  PALETTE law does not permit, and says nothing specific about def.
- **Commit a PNG render instead of SVG** — rejected: SVG is crisp at every DPI,
  diffable, and license-clean as a text asset; both faces total ~6 KB.
- **Rename the repo title to `# def`** — rejected: this repository is dsh-mobile
  (the host); def is the product it carries. The hero block states both names in
  one breath, which is the honest relationship.
