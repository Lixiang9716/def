#!/usr/bin/env node
/**
 * a2ui-genui-e2e.mjs — one-command receipt for the M5 mapping wing: push the
 * three app-shell fixtures through specToA2UI → toGenuiMessages →
 * @lynx-js/genui's MessageProcessor and assert zero errors: beginRendering +
 * surfaceUpdate per fixture, root detected, every child/child ref resolvable
 * inside the processor's surface.
 *
 * Run:  node test/panel/a2ui-genui-e2e.mjs
 * Needs @lynx-js/genui in test/panel/node_modules (not a tracked dep):
 *   cd test/panel && npm install --no-save @lynx-js/genui
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let MessageProcessor;
try {
  ({ MessageProcessor } = require('@lynx-js/genui/a2ui/store'));
} catch {
  console.error('a2ui-genui-e2e: @lynx-js/genui not provisioned — cd test/panel && npm install --no-save @lynx-js/genui');
  process.exit(1);
}

const { specToA2UI, toGenuiMessages } = await import('../../system-plugins/dsh-appshell/lib/appshell-to-a2ui.js');
const { FIXTURES } = await import('../../system-plugins/dsh-appshell/lib/mock.js');

let failures = 0;
for (const [name, fixture] of Object.entries(FIXTURES)) {
  const { ok, errors, a2ui } = specToA2UI(fixture, { accent: fixture.theme.accent });
  if (!ok) {
    console.error(`${name}: specToA2UI rejected — ${JSON.stringify(errors)}`);
    failures += 1;
    continue;
  }
  const proc = new MessageProcessor();
  proc.processMessages(toGenuiMessages(a2ui.components));
  const surface = proc.getSurfaces().get('appshell');
  const problems = [];
  if (!surface) problems.push('no appshell surface created');
  if (surface && surface.rootComponentId !== 'root') problems.push(`rootComponentId=${surface.rootComponentId}`);
  const stored = surface ? surface.components : new Map();
  for (const c of a2ui.components) {
    if (!stored.has(c.id)) problems.push(`component ${c.id} missing from surface`);
    for (const kid of c.children || []) if (!stored.has(kid)) problems.push(`${c.id} children ref ${kid} unresolved`);
    if (c.child !== undefined && !stored.has(c.child)) problems.push(`${c.id} child ref ${c.child} unresolved`);
  }
  if (problems.length === 0) {
    console.log(`${name}: PASS — ${a2ui.components.length} components, root=root, all refs resolve, zero errors`);
  } else {
    failures += 1;
    console.error(`${name}: FAIL — ${problems.join('; ')}`);
  }
}

if (failures > 0) {
  console.error(`a2ui-genui-e2e: ${failures} fixture(s) failed`);
  process.exit(1);
}
console.log('a2ui-genui-e2e: 3/3 fixtures zero-error through genui v0.7.0 MessageProcessor');
