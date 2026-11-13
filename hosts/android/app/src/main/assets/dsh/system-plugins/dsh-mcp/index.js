// dsh:logging-exempt (plugin entry; logging happens through the mounted logger)
/**
 * dsh-mcp — the MCP client plugin (plan §4.2): connects configured MCP
 * servers over the streamable-HTTP transport bridge (#632) and registers
 * each server's tools into the session toolset as `mcp_<server>_<tool>`.
 *
 * The transport is the VENDORED StreamableHTTPClientTransport composed over
 * gateway httpFetch (upstream/mcp-http-transport.js — D6 composition, zero
 * new primitives); the Client class is the vendored
 * `@modelcontextprotocol/client`, loaded by dynamic import through the
 * npm-bridges row (the bridges row exists only after a module body runs —
 * the same discipline boot.js keeps for every bridged package). The plugin
 * composes; it never re-types protocol code.
 *
 * Configuration (the dsh-open-design two-tier shape; a host that resolves
 * no server offers no tools):
 *   __dshMcpServers        the host's declaration — an array of
 *                          {name, url, credentialRef?, headerName?}, or
 *   DSH_MCP_SERVERS        the launch environment — EITHER the same array
 *                          as JSON (the carriers' spelling) OR the
 *                          quote-free pipe grammar the CLI's --env demands
 *                          (its injection guard refuses quotes,
 *                          example/main_cli.c:1865): rows separated by `;`,
 *                          fields by `|` — `name|url[|credentialRef[|headerName]]`.
 * `credentialRef` names a keychain ref (keychainGet); the resolved secret
 * rides the `headerName` header (default `Authorization`, Bearer-prefixed
 * unless already scheme'd). A configured credential the keychain cannot
 * answer is a NAMED warn and the connect proceeds without it — the server,
 * not this plugin, is the authority on whether that was required.
 *
 * Authorization (v1, per plan §4.2's suggestion): per-server, one-time, and
 * CONFIG-SIGNED — listing a server in the config IS the grant, recorded as
 * one `mcp/server.authorized` record before the first connect. The step-up
 * (face.approval@1 on first connect, with a remember policy) is the named
 * v2; the reasoning lives in the plugin's agent note.
 *
 * Failure isolation is per server: one server failing to connect or list
 * refuses only its own tools (a named warn) — the other servers' tools and
 * the session stay live. Tool runs forward `callTool` and surface the
 * server's own isError as a structured {ok:false, error} (D8: the await is
 * the event boundary; no polling, no blocking whole-result fabrications).
 */
import { createLogger } from 'logger.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { keychainGet } from 'gateway.js';
import { loadMcpSdk, createMcpHttpTransport } from '../../upstream/mcp-http-transport.js';
import { mcpMeta, presentCallFor, mcpResultView } from './present.js';

const log = createLogger('dsh.mcp');

export const manifest = {
  schemaVersion: 1,
  id: 'dsh-mcp',
  version: '0.1.0',
  type: 'service',
  entry: 'index.js',
  capabilities: { required: ['httpFetch', 'keychainGet'], optional: [] },
  hooks: { activate: 'activate' },
};

/** A tool or server name reduced to the identifier alphabet the
 * `mcp_<server>_<tool>` grammar allows. Two different names that sanitize
 * identically are a config defect the registration names (the second
 * registration would collide — refused loud, rule 5, never silently
 * shadowed). */
const sanitize = (raw) => String(raw).replace(/[^a-zA-Z0-9_]/g, '_');

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** The config rows: keep the well-formed {name, url} pairs, name every
 * rejected row (a typo'd entry must not silently shrink the roster). */
const normalizeServers = (raw, source) => {
  if (!Array.isArray(raw)) {
    log.warn('mcp/config.refused', { source, reason: 'the config is not an array' });
    return [];
  }
  const servers = [];
  for (const row of raw) {
    const name = isPlainObject(row) && typeof row.name === 'string' ? row.name.trim() : '';
    const url = isPlainObject(row) && typeof row.url === 'string' ? row.url.trim() : '';
    if (name === '' || !/^https?:\/\//.test(url)) {
      log.warn('mcp/config.row-refused', { source, row: isPlainObject(row) ? row.name ?? JSON.stringify(row).slice(0, 60) : String(row).slice(0, 60) });
      continue;
    }
    servers.push({
      name,
      url,
      credentialRef: typeof row.credentialRef === 'string' && row.credentialRef !== '' ? row.credentialRef : undefined,
      headerName: typeof row.headerName === 'string' && row.headerName !== '' ? row.headerName : 'Authorization',
    });
  }
  return servers;
};

/** The two-tier config face: the host's global declaration wins, the
 * launch environment is the fallback; neither present (or unparseable)
 * means no tools — the honest empty posture, never a fabricated roster. */
const resolveServers = () => {
  const declared = globalThis.__dshMcpServers;
  if (Array.isArray(declared)) {
    return normalizeServers(declared, '__dshMcpServers');
  }
  const raw = typeof process !== 'undefined' && typeof process.env?.DSH_MCP_SERVERS === 'string'
    ? process.env.DSH_MCP_SERVERS : '';
  if (raw.trim() === '') return undefined;
  if (raw.trimStart().startsWith('[')) {
    try {
      return normalizeServers(JSON.parse(raw), 'DSH_MCP_SERVERS');
    } catch (error) {
      log.warn('mcp/config.refused', { source: 'DSH_MCP_SERVERS', reason: String(error?.message ?? error).slice(0, 120) });
      return [];
    }
  }
  // The quote-free pipe grammar: rows on `;`, fields on `|`. A malformed
  // row is named and skipped (the same per-row honesty as the JSON tier).
  const rows = raw.split(';').map((line) => line.split('|').map((field) => field.trim()))
    .filter((fields) => fields.some((field) => field !== ''))
    .map((fields) => ({
      name: fields[0] ?? '',
      url: fields[1] ?? '',
      ...(fields[2] ? { credentialRef: fields[2] } : {}),
      ...(fields[3] ? { headerName: fields[3] } : {}),
    }));
  return normalizeServers(rows, 'DSH_MCP_SERVERS');
};

/** The credential face: keychainGet by ref; the secret rides one header,
 * Bearer-prefixed unless the stored value already carries a scheme. */
const resolveCredential = async (spec) => {
  if (spec.credentialRef === undefined) return undefined;
  try {
    const found = await keychainGet(spec.credentialRef);
    const bytes = found?.secret;
    if (!Array.isArray(bytes) || bytes.length === 0) {
      log.warn('mcp/credential.absent', { server: spec.name, ref: spec.credentialRef });
      return undefined;
    }
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    const value = /^(basic|bearer|token|apikey)\s/i.test(text) ? text : `Bearer ${text}`;
    return { [spec.headerName]: value };
  } catch (error) {
    log.warn('mcp/credential.refused', { server: spec.name, ref: spec.credentialRef, reason: String(error?.message ?? error).slice(0, 120) });
    return undefined;
  }
};

/** One server's connect + list. Every wire request rides the gateway
 * through the vendored transport; the handshake and tools/list are the
 * library's own shapes (D6). */
const connectServer = async (spec) => {
  log.info('mcp/server.authorized', { server: spec.name, url: spec.url, basis: 'config' });
  const headers = await resolveCredential(spec);
  const transport = await createMcpHttpTransport({
    url: spec.url,
    requestInit: headers !== undefined ? { headers } : undefined,
    onWire: (wire) => log.debug('mcp/wire', { server: spec.name, ...wire }),
  });
  const sdk = await loadMcpSdk();
  const client = new sdk.Client({ name: 'dsh-mcp', version: '0.1.0' });
  await client.connect(transport);
  const server = client.getServerVersion();
  const listed = await client.listTools();
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  log.info('mcp/server.connected', { server: spec.name, serverName: server?.name, tools: tools.length });
  return { client, tools };
};

/** The MCP inputSchema → the toolset's parameters spec: the object
 * properties pass through (type/description verbatim; `required` from the
 * schema's required list). A schema this mapper cannot read degrades to an
 * empty parameter spec — the tool still works for argument-less calls, and
 * the server's own validation remains the authority on bad arguments. */
const parametersFromSchema = (schema) => {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const parameters = {};
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (!isPlainObject(prop)) continue;
    parameters[name] = {
      type: typeof prop.type === 'string' ? prop.type : 'string',
      required: required.includes(name),
      ...(typeof prop.description === 'string' && prop.description !== '' ? { description: prop.description } : {}),
    };
  }
  return parameters;
};

/** The callTool answer → the plugin outcome: the first text content block
 * is the result; the server's isError arrives as a structured refusal. */
const mcpOutcome = (result) => {
  const block = Array.isArray(result?.content)
    ? result.content.find((entry) => isPlainObject(entry) && entry.type === 'text' && typeof entry.text === 'string')
    : undefined;
  if (result?.isError === true) {
    return { ok: false, error: typeof block?.text === 'string' ? block.text : 'the MCP tool reported an error without content' };
  }
  return { ok: true, result: typeof block?.text === 'string' ? block.text : JSON.stringify(result ?? {}) };
};

const wrap = async (run) => {
  const outcome = await run();
  return { ok: outcome.ok === true, result: JSON.stringify(outcome) };
};

const mcpOutput = (toolName, server) => ({
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      result: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{ type: 'text', text: value.result }],
  presentationMeta: mcpMeta(server),
});

/** Register one remote tool under the mcp_<server>_<tool> grammar; the
 * execute forwards callTool on the SAME client (D8 — the await is the
 * boundary). A collision (two remotes sanitizing identically) fails loud. */
const registerRemoteTool = (ctx, spec, client, remote, seen) => {
  const toolName = `mcp_${sanitize(spec.name)}_${sanitize(remote.name)}`;
  if (seen.has(toolName)) {
    throw new Error(`dsh-mcp: tool name collision on ${toolName} — rename the server or the remote tool`);
  }
  seen.add(toolName);
  ctx.tools.register(defineTool({
    name: toolName,
    description: `[MCP ${spec.name}] ${typeof remote.description === 'string' && remote.description !== '' ? remote.description : remote.name}`,
    parameters: parametersFromSchema(remote.inputSchema),
    output: mcpOutput(toolName, spec.name),
    presentCall: presentCallFor(toolName),
    presentResult: mcpResultView(toolName, spec.name),
    async execute(args) {
      log.debug('tool invoked', { tool: toolName, server: spec.name });
      return wrap(async () => mcpOutcome(await client.callTool({ name: remote.name, arguments: args ?? {} })));
    },
  }));
};

/** The spine's mount shape (boot.js): the registration is asynchronous —
 * the tool roster exists only after the handshake and tools/list return —
 * and per-server isolated: one refused server names itself and moves on. */
export const name = 'dsh-mcp';
export const inject = ['tools'];

export const apply = async (ctx) => {
  const servers = resolveServers();
  if (servers === undefined) {
    log.info('no MCP server configured; no mcp_* tools are offered');
    return;
  }
  if (servers.length === 0) {
    log.warn('no usable MCP server row in the config; no mcp_* tools are offered');
    return;
  }
  const seen = new Set();
  const registered = [];
  for (const spec of servers) {
    try {
      const { client, tools } = await connectServer(spec);
      const names = [];
      for (const remote of tools) {
        if (!isPlainObject(remote) || typeof remote.name !== 'string' || remote.name === '') {
          log.warn('mcp/tool.refused', { server: spec.name, reason: 'a listed tool carries no name' });
          continue;
        }
        registerRemoteTool(ctx, spec, client, remote, seen);
        names.push(`mcp_${sanitize(spec.name)}_${sanitize(remote.name)}`);
      }
      registered.push(...names);
      log.info('mcp/tools.registered', { server: spec.name, count: names.length, names });
    } catch (error) {
      log.warn('mcp/server.failed', { server: spec.name, url: spec.url, reason: String(error?.message ?? error).slice(0, 200) });
    }
  }
  log.info('mcp/plugin.ready', { servers: servers.length, tools: registered.length });
};
