// dsh:logging-exempt (test leg: assertions ARE the product)
/**
 * axe-sweep.test.mjs — the axe-core a11y regression leg (test-hardening
 * row 3): the dev carrier's next-mode seat serves web-client-v2, this file
 * drives it through the four audited states (onboarding / home /
 * marketplace / session) in BOTH appearances and asserts ZERO critical or
 * serious violations under the WCAG 2.x A/AA ruleset. Moderate and minor
 * violations are printed as inventory, never asserted — the gate is the
 * one the #519 manual pass left behind, now repeatable.
 *
 * Family placement: the dev-carrier test style (onboarding-route.test.mjs,
 * plugins-route.test.mjs) — the test sits next to its subject, runs under
 * the tools vitest face (the tools glob in test/tools), and rides the
 * machine's installed Chrome (test/tools/helpers/carrier-page.mjs
 * discovery; CI's ubuntu runners carry Google Chrome on PATH). Log
 * assertions only — this leg asserts DOM facts, never screenshots
 * (E2E-by-logs, AGENTS.md).
 *
 * Honest contrast boundary: axe's color-contrast is conclusive where the
 * computed background is (the session transcript, 1 inconclusive node) and
 * hedges to `incomplete` where translucent glass sits over the ocean
 * gradient (the #519 audit hand-computed those pairs from hex values; this
 * net adds the structural rules plus conclusive contrast on computable
 * surfaces — it does not replace the hand audit).
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeCarriedPage, openCarriedPage, scanAxe, walkStates,
} from '../../test/tools/helpers/carrier-page.mjs';

const APPEARANCES = ['dark', 'light'];
const SERIOUS = (violation) => violation.impact === 'critical' || violation.impact === 'serious';

/** Prints the scan's inventory: the gate rows (critical/serious) named with
 * their selectors, and everything below the gate as a one-line tally. */
const reportScan = (appearance, rows) => {
  const serious = rows.flatMap((row) => row.violations
    .filter(SERIOUS).map((violation) => ({ state: row.state, ...violation })));
  if (serious.length > 0) {
    console.error(`[axe-sweep:${appearance}] critical/serious violations:\n`
      + serious.map((violation) => `  ${violation.state}: ${violation.impact} ${violation.id}`
        + ` — ${violation.help}\n    ${violation.nodes.join('\n    ')}`).join('\n'));
  }
  const below = rows.flatMap((row) => row.violations
    .filter((violation) => !SERIOUS(violation))
    .map((violation) => `${row.state}:${violation.impact}:${violation.id}`));
  console.log(`[axe-sweep:${appearance}] scanned 4 states; `
    + `critical/serious: ${serious.length}, below-gate inventory: ${below.length}`
    + (below.length > 0 ? ` (${below.join(', ')})` : ''));
  return serious;
};

describe('axe-core a11y regression (web-client-v2 on the next-mode carrier)', () => {
  const sessions = [];

  afterAll(async () => {
    for (const session of sessions.splice(0)) await closeCarriedPage(session);
  });

  it.each(APPEARANCES)('no critical/serious violations in the %s appearance', async (appearance) => {
    const session = await openCarriedPage({ colorScheme: appearance });
    sessions.push(session);
    const rows = [];
    await walkStates(session.page, async (state, page) => {
      rows.push({ state, violations: await scanAxe(page) });
    });

    expect(reportScan(appearance, rows)).toEqual([]);
  }, 180_000);

  it('proves its own teeth: an injected nameless control is caught', async () => {
    // rule 6 posture (a net that never fires is not evidence): one nameless
    // button must surface as a critical button-name violation through the
    // same scan face the assertions above use — injected and removed inside
    // the test, touching nothing on disk.
    const session = await openCarriedPage({ colorScheme: 'dark' });
    sessions.push(session);
    await walkStates(session.page, async () => {});
    await session.page.evaluate(() => {
      const nameless = document.createElement('button');
      nameless.id = 'axe-teeth-probe';
      nameless.type = 'button';
      nameless.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;width:44px;height:44px;';
      document.body.appendChild(nameless);
    });
    const rows = await scanAxe(session.page);
    await session.page.evaluate(() => document.getElementById('axe-teeth-probe')?.remove());
    expect(rows.some((violation) => violation.id === 'button-name'
      && (violation.impact === 'critical' || violation.impact === 'serious'))).toBe(true);
  }, 180_000);
});
