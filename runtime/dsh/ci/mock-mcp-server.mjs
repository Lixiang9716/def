// dsh:logging-exempt (node-side mock: its stdout IS the product — the runner
// reads the endpoint announce + per-request telemetry from it)
/**
 * mock-mcp-server.mjs — a ZERO-dependency node:http MCP server speaking the
 * minimal faithful subset of the Streamable HTTP transport the VENDORED
 * @modelcontextprotocol/client@2.0.0 StreamableHTTPClientTransport dials
 * (external/npm/@modelcontextprotocol/client@2.0.0/dist/index.mjs, the
 * `_send` / `_startOrAuthSse` paths). It is the E2E vehicle for scenario
 * mcp.streamable-http: the client runs inside quickjs, its fetch is the
 * gateway httpFetch primitive, and this process is the real loopback TCP
 * peer on the other side — node-side, outside quickjs, started/killed by
 * runtime/dsh/ci/run-mcp-streamable-http-e2e.sh exactly like
 * mock-llm-server.mjs.
 *
 * The wire, request by request (all on POST /mcp, JSON-RPC 2.0 bodies):
 *   initialize                 → 200 application/json; result.protocolVersion
 *                                echoes the client's requested value (the
 *                                legacy handshake accepts any version it
 *                                offered), capabilities.tools, serverInfo
 *                                {name:'dsh-mock-mcp', version:'0.0.1'};
 *                                response header mcp-session-id: sess-mock-0001
 *   notifications/* (no id)    → 202, empty body (the client then opens its
 *                                standalone GET SSE stream — see GET below)
 *   tools/list                 → 200 text/event-stream: ONE `event: message`
 *                                frame carrying the JSON-RPC result, then the
 *                                stream closes (the SSE response mode)
 *   tools/call echo | add      → 200 application/json (the JSON response mode)
 *   ping                       → 200 application/json, empty result
 *   any other method           → 200 application/json, JSON-RPC -32601
 * Every request after initialize MUST carry mcp-session-id: a missing header
 * is 400, a foreign value is 404 (the spec's session-not-found answer).
 *   GET /mcp                   → 405 + JSON body: no standalone server→client
 *                                stream here (the client tolerates exactly
 *                                this status and carries on)
 *   DELETE /mcp                → 405 + JSON body (session termination refused)
 *   any other path             → 404
 *
 * Stdout carries exactly two kinds of lines: the MOCK_BASE_URL=... announce
 * once the port is bound, and ONE deterministic JSON line per request
 * {http, mcp, sessionId, status, responseMode} — http is the verb, mcp the
 * JSON-RPC method (null when the body carried none), sessionId whether the
 * request presented the session header, responseMode how the body went back:
 * 'json' | 'sse' | 'none' (none = the 202 empty body). Diagnostics only: the
 * E2E checker reads the CLI's log, never this stream.
 *
 * Listens on 127.0.0.1 port 0 (OS-assigned; announced — no fixed-port races).
 *
 * usage: node mock-mcp-server.mjs
 */
import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PATH = '/mcp';
const SESSION_ID = 'sess-mock-0001';
const SERVER_INFO = { name: 'dsh-mock-mcp', version: '0.0.1' };

const TOOLS = [
  {
    name: 'echo',
    description: 'Returns the given text unchanged.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Returns the sum of a and b as a decimal string.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
];

// JSON-RPC error codes: the two standard ones this mock answers plus the
// server-defined code the reference server uses for transport-level refusals.
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const SERVER_ERROR = -32000;

/** The session the one initialize handshake opened (undefined before it). */
let session = undefined;

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** One response description: the handler returns it, the sender writes it. */
const json = (status, payload, headers = {}) => ({ status, mode: 'json', payload, headers });
const sse = (payload) => ({ status: 200, mode: 'sse', payload, headers: {} });
const accepted = () => ({ status: 202, mode: 'none', payload: undefined, headers: {} });

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

/** tools/call: the two scripted tools, arguments validated against the
 * advertised schemas (a violation is a loud -32602, never a guessed result). */
const callTool = (id, params) => {
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (name === 'echo') {
    if (typeof args.text !== 'string') return json(200, rpcError(id, INVALID_PARAMS, 'echo: arguments.text must be a string'));
    return json(200, rpcResult(id, { content: [{ type: 'text', text: args.text }] }));
  }
  if (name === 'add') {
    if (typeof args.a !== 'number' || typeof args.b !== 'number') {
      return json(200, rpcError(id, INVALID_PARAMS, 'add: arguments.a and arguments.b must be numbers'));
    }
    return json(200, rpcResult(id, { content: [{ type: 'text', text: String(args.a + args.b) }] }));
  }
  return json(200, rpcError(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`));
};

/** initialize: open the session, echo the offered protocol version. */
const initialize = (id, params) => {
  const protocolVersion = params?.protocolVersion;
  if (typeof protocolVersion !== 'string') {
    return json(400, rpcError(id, INVALID_PARAMS, 'initialize: params.protocolVersion must be a string'));
  }
  session = SESSION_ID;
  return json(200, rpcResult(id, {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
  }), { 'mcp-session-id': SESSION_ID });
};

/** The session gate for every non-initialize message: missing header 400,
 * foreign header 404, no session yet 400. */
const sessionGate = (id, presented) => {
  if (presented === undefined) return json(400, rpcError(id, SERVER_ERROR, 'Bad Request: Mcp-Session-Id header required'));
  if (session === undefined || presented !== session) return json(404, rpcError(id, SERVER_ERROR, 'Session not found'));
  return undefined;
};

/** Dispatch one parsed JSON-RPC message to its response description. */
const dispatch = (message, presentedSession) => {
  if (Array.isArray(message)) return json(400, rpcError(null, INVALID_REQUEST, 'JSON-RPC batches are not supported'));
  if (typeof message !== 'object' || message === null || message.jsonrpc !== '2.0') {
    return json(400, rpcError(null, INVALID_REQUEST, 'Invalid Request: not a JSON-RPC 2.0 message'));
  }
  const { id, method, params } = message;
  if (method === 'initialize') return initialize(id, params);
  const refused = sessionGate(id, presentedSession);
  if (refused !== undefined) return refused;
  // notifications (no id) and client→server responses (no method): accepted, no body
  if (id === undefined || method === undefined) return accepted();
  if (method === 'ping') return json(200, rpcResult(id, {}));
  if (method === 'tools/list') return sse(rpcResult(id, { tools: TOOLS }));
  if (method === 'tools/call') return callTool(id, params);
  return json(200, rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`));
};

/** Write one response description to the socket. */
const send = (res, reply) => {
  if (reply.mode === 'sse') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(`event: message\ndata: ${JSON.stringify(reply.payload)}\n\n`);
    res.end();
    return;
  }
  if (reply.mode === 'none') {
    res.writeHead(reply.status, { 'content-length': '0' });
    res.end();
    return;
  }
  const body = JSON.stringify(reply.payload);
  res.writeHead(reply.status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...reply.headers,
  });
  res.end(body);
};

/** The telemetry line: one deterministic JSON record per request. */
const record = (req, mcp, reply) => {
  console.log(JSON.stringify({
    http: req.method,
    mcp,
    sessionId: req.headers['mcp-session-id'] !== undefined,
    status: reply.status,
    responseMode: reply.mode,
  }));
};

/** POST /mcp: parse, dispatch, answer; a non-JSON body is a loud -32700. */
const handlePost = async (req, res) => {
  const text = await readBody(req);
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    const reply = json(400, rpcError(null, PARSE_ERROR, 'Parse error: body is not JSON'));
    record(req, null, reply);
    send(res, reply);
    return;
  }
  const reply = dispatch(message, req.headers['mcp-session-id']);
  const mcp = typeof message?.method === 'string' ? message.method : null;
  record(req, mcp, reply);
  send(res, reply);
};

/** The verbs other than POST on /mcp: both 405 with a JSON body naming why. */
const methodNotAllowed = (req, res, why) => {
  const reply = json(405, rpcError(null, SERVER_ERROR, why), { allow: 'POST' });
  record(req, null, reply);
  send(res, reply);
};

const handle = async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${HOST}`);
  if (pathname !== PATH) {
    const reply = json(404, rpcError(null, SERVER_ERROR, `Not found: ${pathname}`));
    record(req, null, reply);
    send(res, reply);
    return;
  }
  if (req.method === 'POST') { await handlePost(req, res); return; }
  if (req.method === 'GET') {
    methodNotAllowed(req, res, 'Method Not Allowed: this server opens no standalone SSE stream (GET /mcp); every message rides a POST');
    return;
  }
  if (req.method === 'DELETE') {
    methodNotAllowed(req, res, 'Method Not Allowed: session termination is not offered (DELETE /mcp)');
    return;
  }
  methodNotAllowed(req, res, `Method Not Allowed: ${req.method}`);
};

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    // An unexpected throw inside the handler is a mock defect: answer loud
    // (500 + the message) so the client-side failure names it, never hang.
    const reply = json(500, rpcError(null, SERVER_ERROR, `mock failure: ${error instanceof Error ? error.message : String(error)}`));
    record(req, null, reply);
    if (!res.headersSent) send(res, reply); else res.end();
  });
});

server.listen(0, HOST, () => {
  const { port } = server.address();
  console.log(`MOCK_BASE_URL=http://${HOST}:${port}${PATH}`);
});

const close = () => {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
