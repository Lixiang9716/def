// tool-card-face.test.js — the P3 card-face upgrade pins (seam-collapse
// program, plan.md §13): every def tool plugin the upgrade touched now
// declares the pin's full face — parameters schema, output.schema,
// output.render (pure projection), output.presentationMeta (replayable
// meta for top-level calls), presentCall/presentResult (render-intent
// cards). These assertions pin the three discipline rules the upgrade
// promised:
//
//   1. PRESENTATIONMETA IS TOTAL — it always returns lossless JSON (the
//      registry's snapshotProjection throws on undefined/non-JSON, which
//      would fail the tool call), even on a body it does not recognize;
//   2. PRESENTERS DEGRADE, NEVER THROW — presentCall/presentResult return
//      undefined (the pin's generic-card fallback) for error results and
//      alien meta shapes, and never throw on any input;
//   3. THE VIEWS ARE THE PIN'S VOCABULARY — card:'read' for the line-
//      numbered word_read face (the tool-fs read pattern), card:'generic'
//      everywhere else (a spreadsheet grid and a slide outline are not
//      line-numbered code; the pin has no office-specific card kind).
//
// The e2e legs (office/appshell/plugin-forms/open-design) already prove the
// meta projector runs clean on the real dispatch path (a throw would have
// failed the one-to-one log match); this file pins the replay-side
// presenters no seat consumer runs yet.
import { describe, it, expect, vi } from 'vitest';
import { registerWordTools } from 'system-plugins/dsh-office/word.js';
import { registerExcelTools } from 'system-plugins/dsh-office/excel.js';
import { registerPptCreate } from 'system-plugins/dsh-office/ppt-create.js';
import { registerPptRead } from 'system-plugins/dsh-office/ppt-read.js';
import { apply as applyAppshell } from 'system-plugins/dsh-appshell/index.js';
import { apply as applyManager } from 'system-plugins/dsh-plugin-manager-tools/index.js';
// dsh-create is runtime-only (no root marketplace mirror), so it rides the
// runtime tree directly — the appshell-render suite's lib-import precedent.
// Its module top arms the timers shim, whose gateway import expects the
// bus's onEvent hook; the panel gateway shim doesn't carry it (no bus here),
// so this file's alias of gateway.js adds the no-op (the timers-gateway-
// seam suite's pattern of providing the hook before the import).
vi.mock('gateway.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, onEvent: actual.onEvent ?? (() => {}) };
});
const { apply: applyCreate } = await import('../../runtime/dsh/system-plugins/dsh-create/index.js');
import { openDesignMeta, presentCallFor, openDesignResultView } from 'system-plugins/dsh-open-design/present.js';

/** Capture registrations exactly as boot.js's spine does. */
const registerAll = (apply) => {
  const tools = new Map();
  apply({ tools: { register: (tool) => tools.set(tool.name, tool) } });
  return tools;
};

const officeTools = new Map([
  ...registerWordTools().map((tool) => [tool.name, tool]),
  ...registerExcelTools().map((tool) => [tool.name, tool]),
  ...[registerPptCreate(), registerPptRead()].map((tool) => [tool.name, tool]),
]);
const appshellTools = registerAll(applyAppshell);
const managerTools = registerAll(applyManager);
const createTools = registerAll(applyCreate);

const WORD_READ_VALUE = { path: 'notes.docx', text: 'first\nsecond', totalChars: 13, truncated: false, sizeBytes: 900 };

describe('office: word_read carries the read card (the tool-fs pattern)', () => {
  const tool = officeTools.get('word_read');
  const meta = tool.output.presentationMeta({ path: 'notes.docx' }, WORD_READ_VALUE);

  it('presentationMeta projects line-numbered structure', () => {
    expect(meta).toEqual({
      view: 'read', path: 'notes.docx', offset: 1,
      lines: [{ number: 1, text: 'first' }, { number: 2, text: 'second' }],
      totalLines: 2, truncated: false, totalChars: 13, format: 'text',
    });
  });

  it('presentResult narrows the meta into card:read', () => {
    const view = tool.presentResult({ path: 'notes.docx' }, {
      isError: false, meta,
      content: [{ type: 'text', text: 'first\nsecond' }],
    });
    expect(view.card).toBe('read');
    expect(view.path).toBe('notes.docx');
    expect(view.lines).toHaveLength(2);
    expect(view.content[0].text).toBe('first\nsecond');
  });

  it('presentResult degrades on error and alien meta, never throws', () => {
    expect(tool.presentResult({}, { isError: true, meta, content: [] })).toBeUndefined();
    expect(tool.presentResult({}, { isError: false, meta: { view: 'edit' }, content: [] })).toBeUndefined();
    expect(tool.presentResult({}, { isError: false, meta: null, content: [] })).toBeUndefined();
    expect(tool.presentResult({}, { isError: false, meta: 42, content: [] })).toBeUndefined();
    expect(() => tool.presentResult({}, { isError: false, meta: [], content: 'x' })).not.toThrow();
  });
});

describe('office: create/update tools carry structure metas + generic cards', () => {
  it('word_create meta + generic completed card', () => {
    const tool = officeTools.get('word_create');
    const meta = tool.output.presentationMeta({}, { path: 'a.docx', sizeBytes: 10, paragraphCount: 2, bulletCount: 1, tableRows: 0 });
    expect(meta).toMatchObject({ view: 'edit', path: 'a.docx', paragraphs: 2, bullets: 1 });
    const view = tool.presentResult({}, { isError: false, meta, content: [] });
    expect(view.card).toBe('generic');
    expect(view.title).toContain('a.docx');
  });

  it('excel_read meta carries the sheet grid summary (no row JSON)', () => {
    const tool = officeTools.get('excel_read');
    const meta = tool.output.presentationMeta({}, {
      path: 'book.xlsx', sizeBytes: 5,
      sheets: [{ name: 'S1', rows: [['a', 'b'], ['c']], truncated: true }],
    });
    expect(meta.sheets).toEqual([{ name: 'S1', rowCount: 2, colCount: 2, truncated: true }]);
    const view = tool.presentResult({}, { isError: false, meta, content: [] });
    expect(view.card).toBe('generic');
    expect(view.content[0].text).toContain('S1 2x2');
  });
});

describe('office: the ppt outline + the full-face presence walk', () => {
  it('ppt_create/ppt_read metas carry the outline (heading/title proxies)', () => {
    const create = officeTools.get('ppt_create');
    const createMeta = create.output.presentationMeta({}, {
      path: 'deck.pptx', sizeBytes: 9, slideCount: 1,
      slideWidthInches: 13.33, slideHeightInches: 7.5,
      slides: [{ index: 1, elements: [{ type: 'title', xIn: 1, yIn: 1, wIn: 2, hIn: 1, text: 'Roadmap' }] }],
    });
    expect(createMeta.outline).toEqual([{ index: 1, heading: 'Roadmap' }]);
    expect(create.presentResult({}, { isError: false, meta: createMeta, content: [] }).content[0].text)
      .toContain('Roadmap');

    const read = officeTools.get('ppt_read');
    const readMeta = read.output.presentationMeta({}, {
      path: 'deck.pptx', sizeBytes: 9, slideCount: 1, slideWidthInches: 13.33, slideHeightInches: 7.5,
      truncated: false, slides: [{ index: 1, title: 'Roadmap', paragraphs: ['p'], imageCount: 0, elements: [] }],
    });
    expect(readMeta.outline).toEqual([{ index: 1, paragraphs: 1, images: 0, title: 'Roadmap' }]);
    expect(read.presentResult({}, { isError: false, meta: readMeta, content: [] }).content[0].text)
      .toContain('Roadmap');
  });

  it('every office tool declares the full face (schema+render+meta, presentCall+presentResult)', () => {
    for (const tool of officeTools.values()) {
      expect(typeof tool.output.schema).toBe('object');
      expect(typeof tool.output.render).toBe('function');
      expect(typeof tool.output.presentationMeta).toBe('function');
      expect(typeof tool.presentCall).toBe('function');
      expect(typeof tool.presentResult).toBe('function');
    }
  });
});

describe('appshell: surface intent as structured meta, not echo-text parsing', () => {
  it('appshell_render meta carries {surfaceId,title,spec} and a pending/completed card', () => {
    const tool = appshellTools.get('appshell_render');
    const meta = tool.output.presentationMeta({}, { ok: true, title: 'Demo', surfaceId: 'appshell-1', spec: { title: 'Demo' } });
    expect(meta).toMatchObject({ view: 'surface', surfaceId: 'appshell-1', title: 'Demo' });
    expect(tool.presentResult({}, { isError: false, meta, content: [] }).title).toContain('appshell-1');
    const call = tool.presentCall({ spec: { title: 'Demo' } });
    expect(call.card).toBe('generic');
    expect(call.title).toContain('Demo');
  });

  it('appshell_update narrows its own meta; alien shapes degrade', () => {
    const tool = appshellTools.get('appshell_update');
    const meta = tool.output.presentationMeta({}, { ok: true, surfaceId: 'appshell-2', spec: {} });
    expect(meta.surfaceId).toBe('appshell-2');
    expect(tool.presentResult({}, { isError: true, meta, content: [] })).toBeUndefined();
    expect(tool.presentResult({}, { isError: false, meta: { view: 'roster' }, content: [] })).toBeUndefined();
    expect(tool.presentCall({ surfaceId: 'appshell-2' }).title).toContain('appshell-2');
  });

  it('appshell_catalog declares a generic pending card', () => {
    expect(appshellTools.get('appshell_catalog').presentCall().card).toBe('generic');
  });
});

describe('plugin_manager: the roster out of the JSON line', () => {
  const tool = managerTools.get('plugin_manager');

  it('a list body projects ids; the completed card counts them', () => {
    const value = JSON.stringify({ ok: true, entries: [{ entryId: 'countdown10', moduleName: 'x', enabled: true }], total: 1 });
    const meta = tool.output.presentationMeta({ action: 'list_plugins' }, value);
    expect(meta).toMatchObject({ view: 'roster', ok: true, action: 'list_plugins', ids: ['countdown10'] });
    const view = tool.presentResult({}, { isError: false, meta, content: [] });
    expect(view.title).toContain('(1)');
    expect(view.content[0].text).toBe('countdown10');
  });

  it('a non-JSON body keeps the minimal shape — never undefined', () => {
    const meta = tool.output.presentationMeta({ action: 'set_plugin' }, 'not json');
    expect(meta).toEqual({ view: 'roster', ok: false, action: 'set_plugin' });
    expect(tool.presentResult({}, { isError: false, meta, content: [] }).card).toBe('generic');
  });

  it('presentCall names the action; malformed args never throw', () => {
    expect(tool.presentCall({ action: 'list_bundles', target: 'pkg' }).rawInput).toBe('pkg');
    expect(() => tool.presentCall(null)).not.toThrow();
  });
});

describe('plugin_create: the card fields the native bus eats, as meta', () => {
  const tool = createTools.get('plugin_create');

  it('meta carries {title,kind,durationMs} and the completed card names the title', () => {
    const meta = tool.output.presentationMeta(
      { name: 'pomodoro', title: '番茄钟', kind: 'timer', durationMs: 1500000 }, 'done');
    expect(meta).toEqual({ view: 'create', name: 'pomodoro', title: '番茄钟', kind: 'timer', durationMs: 1500000 });
    const view = tool.presentResult({}, { isError: false, meta, content: [] });
    expect(view.card).toBe('generic');
    expect(view.title).toContain('番茄钟');
  });

  it('presentCall names the package; alien meta degrades', () => {
    expect(tool.presentCall({ name: 'cal' }).title).toContain('cal');
    expect(tool.presentResult({}, { isError: false, meta: { view: 'edit' }, content: [] })).toBeUndefined();
  });
});

describe('open-design: pure presenters over the stringified outcome', () => {
  it('meta carries ok + the artifact locator; the completed card shows the locator', () => {
    const meta = openDesignMeta('open_design_artifact')(
      { verb: 'save', identifier: 'poster', title: 'Poster' },
      { ok: true, result: JSON.stringify({ ok: true, url: 'https://share.invalid/a1' }) });
    expect(meta).toMatchObject({ view: 'design', tool: 'open_design_artifact', verb: 'save', ok: true, url: 'https://share.invalid/a1' });
    const view = openDesignResultView('open_design_artifact')({}, { isError: false, meta, content: [] });
    expect(view.title).toBe('open_design_artifact save');
    expect(view.content[0].text).toBe('url: https://share.invalid/a1');
  });

  it('a garbage body keeps the minimal shape; findings count rides lint metas', () => {
    const meta = openDesignMeta('open_design_artifact')({ verb: 'lint' }, { ok: true, result: '{"ok":true,"findings":[1,2]}' });
    expect(meta).toEqual({ view: 'design', tool: 'open_design_artifact', verb: 'lint', ok: true, findings: 2 });
    const broken = openDesignMeta('open_design_generate')({}, { ok: false, result: 'not json' });
    expect(broken).toEqual({ view: 'design', tool: 'open_design_generate', ok: false });
  });

  it('presentCall titles: prompt snippet, artifact verb, projects verb+id', () => {
    expect(presentCallFor('open_design_generate')({ prompt: 'make   a poster' }).title).toBe('Design: make a poster');
    expect(presentCallFor('open_design_artifact')({ verb: 'save', identifier: 'p1' }).title).toBe('artifact save p1');
    expect(presentCallFor('open_design_projects')({ verb: 'get', id: 'p9' }).title).toBe('open_design get p9');
    const view = openDesignResultView('open_design_projects')({}, { isError: false, meta: { view: 'design', tool: 'open-design' }, content: [] });
    expect(view).toBeUndefined();
  });
});
