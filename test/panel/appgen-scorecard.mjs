/**
 * appgen-scorecard: the merged percentage scorecard — one table from the
 * latest committed ledgers of every benchmark family (census, port,
 * chain, visual). A viewer, not a runner: it reads what the loop
 * measured, never re-runs anything. Prints the table the runbook's
 * §scorecard section quotes; stale ledgers are named, not hidden.
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
const newestAll = (d, prefix) => {
  const files = readdirSync(d).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  const parsed = files.map((f) => {
    try { return JSON.parse(readFileSync(new URL(f, d), 'utf8')); } catch { return null; }
  }).filter((l) => l?.meta?.at);
  return parsed.sort((a, b) => new Date(b.meta.at) - new Date(a.meta.at));
};

// Port ledgers are matched by their meta.generator, never by filename: the
// rr-series battery writes every generator under the legacy
// 'webgen-port-deepseek-v4-flash-' stem (rr29+ all carry generator
// glm-5.3-flash), so filename matching mislabeled the Zhipu line as dsflash
// and read the misnamed webgen-port-glm-5.3-flash-r21.json (a deepseek run,
// 0%) as the glm line. meta.generator is the truth; the stem is legacy.
// Census rows are the same disease with a different truth key: the census
// runner stamps meta.model (never meta.generator), and the rr-series census
// lives under the legacy 'appgen-census-deepseek-v4-flash-' stem too — the
// filename match printed the Zhipu rr-series as the "dsflash" line and read
// appgen-census-glm-5.3-flash-r16.json (rubric v1, constitution 26.7%) as
// the glm line. Rubric versions never mix: v1 (everything before r29)
// judged the raw request, v2 judges the minted spec.
const portLedgers = [
  ...newestAll(dir, 'webgen-port-deepseek-v4-flash-'),
  ...newestAll(dir, 'webgen-port-glm-5.3-flash-'),
].sort((a, b) => new Date(b.meta.at) - new Date(a.meta.at));
const glmPorts = portLedgers.filter((l) => l.meta.generator === 'glm-5.3-flash');
const dsPorts = portLedgers.filter((l) => l.meta.generator === 'deepseek-v4-flash');
const port = dsPorts[0] ?? glmPorts[0] ?? null;
const chain = newest(dir, 'appgen-chain-deepseek-v4-flash-');
const visual = newest(dir, 'appgen-visual-deepseek-v4-flash-');
const censusLedgers = [
  ...newestAll(evalDir, 'appgen-census-deepseek-v4-flash-'),
  ...newestAll(evalDir, 'appgen-census-glm-5.3-flash-'),
].sort((a, b) => new Date(b.meta.at) - new Date(a.meta.at));
const glmCensus = censusLedgers.filter((l) => l.meta.model === 'glm-5.3-flash');
const glmCensusV2 = glmCensus.filter((l) => l.meta.rubricVersion === 2);
const glmCensusV1 = glmCensus.filter((l) => l.meta.rubricVersion !== 2);
const dsCensus = censusLedgers.filter((l) => l.meta.model === 'deepseek-v4-flash');

console.log('=== def appgen scorecard (latest committed ledgers) ===');
if (glmPorts.length) {
  const [a, b] = glmPorts;
  const mean = b ? Math.round((a.meanAccuracy + b.meanAccuracy) / 2 * 10) / 10 : null;
  console.log(`port (glm-5.3-flash${mean !== null ? `, Zhipu 2-round mean ${mean}%` : ', single-run'}, corpus v${a.meta.portVersion ?? 1}): newest ${a.meanAccuracy}% (${a.meta.at.slice(0, 10)})${b ? ` | prior ${b.meanAccuracy}% (${b.meta.at.slice(0, 10)})` : ''} | start-fail ${a.diagnostics?.startFailedInstructions ?? '?'}`);
}
if (dsPorts.length) {
  const p = dsPorts[0];
  const dv = p.categories?.['Design Validation Testing']?.accuracy ?? null;
  console.log(`port (dsflash, ${p.meta.at.slice(0, 10)}${p.runsPerInstruction > 1 ? `, ${p.runsPerInstruction}-run mean` : ', single-run'}, corpus v${p.meta.portVersion ?? 1}): accuracy ${p.meanAccuracy ?? p.overall?.accuracy}%${dv !== null ? ` | DV ${dv}%` : ''} | start-fail ${p.diagnostics?.startFailedInstructions ?? '?'}`);
}
if (chain) console.log(`chain (backend axis): ${chain.overall.accuracy}% | refusals ${chain.diagnostics.rejectedUpdates}`);
if (visual) {
  const v = visual.visual.judgeSelfVariance;
  const noise = v ? ` | judge self-variance ±${v.meanAbsDelta} mean|Δ| (max ${v.maxDelta}, within-5 ${Math.round(v.within5Rate * 100)}%)` : '';
  console.log(`visual: background ${visual.visual.backgroundYes} YES / ${visual.visual.backgroundPartial} PARTIAL / ${visual.visual.backgroundNo} NO | appearance ${visual.visual.meanAppearance}/${visual.visual.appearanceScale ?? 5} (rubric ${visual.meta.appearanceRubric ?? 'v1'})${noise}`);
}
const censusLine = (l) => `${l.percentages?.structuralValid ?? '?'}/${l.percentages?.constitution ?? '?'}/${l.percentages?.alignment ?? '?'}`;
if (glmCensusV2.length) {
  const [a, b] = glmCensusV2;
  const mean = (k) => b ? Math.round((a.percentages[k] + b.percentages[k]) / 2 * 10) / 10 : a.percentages[k];
  console.log(`census (glm-5.3-flash, Zhipu${b ? ' 2-round mean' : ' single-run'} ${mean('structuralValid')}/${mean('constitution')}/${mean('alignment')}, rubric v${a.meta.rubricVersion}): newest ${censusLine(a)} (${a.meta.at.slice(0, 10)})${b ? ` | prior ${censusLine(b)} (${b.meta.at.slice(0, 10)})` : ''}`);
}
if (glmCensusV1.length) {
  const c = glmCensusV1[0];
  console.log(`census (glm-5.3-flash, rubric v1, ${c.meta.at.slice(0, 10)} — pre-minted semantics, not comparable with v2): structuralValid ${c.percentages?.structuralValid}% | constitution ${c.percentages?.constitution}% | alignment ${c.percentages?.alignment}%`);
}
if (dsCensus.length) {
  const c = dsCensus[0];
  const rub = c.meta.rubricVersion ? `rubric v${c.meta.rubricVersion}` : 'rubric v1 (pre-minted semantics, not comparable with v2)';
  console.log(`census (dsflash, ${c.meta.at.slice(0, 10)}, ${rub}): structuralValid ${c.percentages?.structuralValid}% | constitution ${c.percentages?.constitution}% | alignment ${c.percentages?.alignment}%`);
}
if (!port || !chain) console.log('NOTE: missing families — run the loop before quoting the scorecard.');
