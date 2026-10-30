/**
 * appgen-scorecard: the merged percentage scorecard — one table from the
 * latest committed ledgers of every benchmark family (census, port,
 * chain, visual). A viewer, not a runner: it reads what the loop
 * measured, never re-runs anything. Prints the table the runbook's
 * §scorecard section quotes; stale ledgers are named, not hidden — and
 * neither are dead-endpoint runs: a ledger whose rows are dominated by
 * provider-side failures is quoted as RUN INVALID, never as a family
 * reading (rounds 15-18 each shipped one as 11.7% / zeros).
 */
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../../tools/dev-web-carrier/artifacts/appgen-bench/', import.meta.url);
const evalDir = new URL('../../tools/dev-web-carrier/artifacts/appgen-eval/', import.meta.url);

const newest = (d, prefix) => {
  // By ledger meta.at, never filename order — 'systemv2' sorts after
  // 'iter9' alphabetically and would masquerade as the latest.
  const files = readdirSync(d).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  const parsed = files.map((f) => {
    try { return JSON.parse(readFileSync(new URL(f, d), 'utf8')); } catch { return null; }
  }).filter((l) => l?.meta?.at);
  parsed.sort((a, b) => new Date(b.meta.at) - new Date(a.meta.at));
  return parsed[0] ?? null;
};

const port = newest(dir, 'webgen-port-deepseek-v4-flash-');
const portGlm = newest(dir, 'webgen-port-glm-5.3-flash-');
const chain = newest(dir, 'appgen-chain-deepseek-v4-flash-');
const visual = newest(dir, 'appgen-visual-deepseek-v4-flash-');
const census = newest(evalDir, 'appgen-census-deepseek-v4-flash-');
const censusGlm = newest(evalDir, 'appgen-census-glm-5.3-flash-');

// Same massacre signature the round driver refuses on: provider-side
// failures (balance drained, rate limit, server error, network) dominating
// a ledger's rows. Row shapes: port/visual/chain rows carry `error`
// (string; port may carry startFailureClass), census rows carry `errors`
// ([{code, msg}]).
const ENDPOINT_FAIL = /HTTP (402|408|429|5\d\d)\b|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|insufficient_balance/i;
const massacre = (l) => {
  const rows = l?.rows ?? [];
  if (!rows.length) return null;
  const bad = rows.filter((r) =>
    (typeof r.error === 'string' && ENDPOINT_FAIL.test(r.error))
    || r.startFailureClass === 'endpoint'
    || (Array.isArray(r.errors) && r.errors.some((e) => ENDPOINT_FAIL.test(String(e?.msg ?? ''))))
  ).length;
  return bad * 2 >= rows.length ? `${bad}/${rows.length} rows` : null;
};
const invalid = (l) => (massacre(l) ? `RUN INVALID — endpoint-failure ${massacre(l)}; ` : '');

const dv = port?.categories?.['Design Validation Testing']?.accuracy ?? null;
console.log('=== def appgen scorecard (latest committed ledgers) ===');
if (port) {
  console.log(`port (dsflash${port.runsPerInstruction > 1 ? `, ${port.runsPerInstruction}-run mean` : ', single-run'}, corpus v${port.meta.portVersion ?? 1}): ${invalid(port)}accuracy ${port.meanAccuracy ?? port.overall.accuracy}% | DV ${dv}% | start-fail ${port.diagnostics.startFailedInstructions}`);
}
if (portGlm) console.log(`port (glm-5.3-flash${portGlm.runsPerInstruction > 1 ? `, ${portGlm.runsPerInstruction}-run mean` : ', single-run'}): ${invalid(portGlm)}accuracy ${portGlm.meanAccuracy ?? portGlm.overall.accuracy}%`);
if (chain) console.log(`chain (backend axis): ${invalid(chain)}${chain.overall.accuracy}% | refusals ${chain.diagnostics.rejectedUpdates}`);
if (visual) console.log(`visual: ${invalid(visual)}background ${visual.visual.backgroundYes} YES / ${visual.visual.backgroundPartial} PARTIAL / ${visual.visual.backgroundNo} NO | appearance ${visual.visual.meanAppearance}/${visual.visual.appearanceScale ?? 5} (rubric ${visual.meta.appearanceRubric ?? 'v1'})`);
if (census) console.log(`census (dsflash): ${invalid(census)}structuralValid ${census.percentages?.structuralValid}% | constitution ${census.percentages?.constitution}% | alignment ${census.percentages?.alignment}%`);
if (censusGlm) console.log(`census (glm-5.3-flash): ${invalid(censusGlm)}structuralValid ${censusGlm.percentages?.structuralValid}% | constitution ${censusGlm.percentages?.constitution}% | alignment ${censusGlm.percentages?.alignment}%`);
if (!port || !chain) console.log('NOTE: missing families — run the loop before quoting the scorecard.');
