#!/usr/bin/env node
// dsh:logging-exempt (node-side driver: stdout IS the runner channel)
/**
 * ci/anthropic-forwarder.mjs — the user-endpoint leg's egress companion
 * (the mock-llm-server.mjs pattern): one LOOPBACK TCP server that proxies
 * to the real endpoint, so the CLI host's userEndpoint dial (the fetch
 * bridge → gateway httpFetch → loopback socket) reaches the public internet
 * on a host whose httpFetch serves loopback only. The forwarder re-prints
 * its resolved URL as MOCK_BASE_URL (the runner's polling convention) and
 * names its upstream target for the receipt. Node-side only; the scenario
 * and the runtime never see this process.
 *
 * usage: node ci/anthropic-forwarder.mjs [targetOrigin]   (default
 *        https://api.anthropic.com; prints MOCK_BASE_URL=... then tails)
 */
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';

const TARGET = process.argv[2] ?? 'https://api.anthropic.com';
const target = new URL(TARGET);
// The upstream module follows the target scheme (the https origin is the
// point: the forwarder is the egress half the CLI host deliberately lacks).
const transport = target.protocol === 'https:' ? https : http;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];
    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      method: req.method,
      path: req.url,
      headers: { ...headers, ...(body.length > 0 ? { 'content-length': String(body.length) } : {}) },
    }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'forwarder_error', message: String(error?.message ?? error) } }));
    });
    if (body.length > 0) upstream.write(body);
    upstream.end();
  });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  // The runner polls/parses this line (the mock-llm-server convention).
  console.log(`MOCK_BASE_URL=http://localhost:${port}`);
  console.log(`FORWARD_TARGET=${TARGET}`);
});
