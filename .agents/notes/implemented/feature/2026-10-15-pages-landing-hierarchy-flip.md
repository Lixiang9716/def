# Agent Note: Pages landing hierarchy flipped — the static client shell is not a hero

Status: implemented
Date: 2026-10-15
Class: feature
Refs: #514, #519, demo/index.html, doc/test-coverage.md

## Problem

The Pages landing made the live client render the hero ("your first look at
DSH is the real client"). In practice the static, no-backend client shows its
connecting state with cramped rendering — composer overflowing the frame edge,
the drawer glyph over the wordmark. Visitors read a broken app, not a product.
The rest of the page was 80% dead dark space, the aurora identity was nearly
invisible, and the CTAs were plain underlined links.

## Decision

Flip the hierarchy. The page is now a product landing first: display-type hero
(clamp 38-60px two-tone headline), CTA buttons (glass style, labelled),
capability cards, and the live client demoted to a clearly-labelled
"Try it live" section with the honest caption ABOVE the frame — the connecting
state is expected before it is seen. The aurora backdrop is raised to visible
levels as the brand surface. An inline SVG favicon and og/description meta
landed. The lynx-view mount, the shadow-root flex compensation script, the
tokens-only palette rule, relative paths, and the honest static-preview copy
are preserved unchanged.

## Alternatives considered

- **Populate the client frame with fake session content** — rejected: it
  fabricates product state the static shell does not have (the repo's
  honesty rule).
- **Keep the client as hero and fix only its internal rendering** — rejected:
  the cramped render is the client's real narrow-width behavior; fixing it is
  a web-client task, and a landing page must not depend on it.
- **Full brand redesign with custom type/motion** — rejected: the tokens-only
  discipline and no-motion stance are the page's own documented constraints.

## Consequences

The page reads as a product landing at both widths (verified 1440 and 390 in
the browser, pre-merge screenshots in the session artifacts). The static
client remains visible in "Try it live" with expectations set — if the client
gains a mock session mode, the frame can be promoted again. A favicon and og
meta now exist for link previews.
