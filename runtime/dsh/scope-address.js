/**
 * scope-address.js — the ONE gateway-address derivation: how a path in the
 * pinned profile workspace becomes the gateway's (scope, path) pair inside
 * the `app` scope. Both roots are pinned globals the spine sets
 * (__dshProfileCwd / __dshProfileScopeRoot) — read, never guessed (the
 * dsh-shell-wasm convention every consumer kept).
 *
 * One derivation, three consumers (the P2 shell/subprocess seam audit's
 * dedupe): the dsh-shell-js applet layer's toGateway, the dsh-fs cordis
 * provider's address, and the dsh-office fs channel's scopePathFor. The
 * join algebra differs where the callers' contracts differ (the shell and
 * the provider share appScopeAddress; the office channel strips leading
 * slashes and never emits the '.' sentinel), but the roots read and the
 * prefix math below are THE copies — a fourth consumer imports, it does
 * not re-derive.
 */
import { createLogger } from 'logger.js';
import { GatewayError } from 'gateway.js';

const log = createLogger('dsh.scope-address');

/** The pinned profile roots, validated. `surface` names the refusing
 * consumer in the GatewayError's primitive slot (the shell says `shell`,
 * the office channel `office`, the fs provider `fs`) — the message is the
 * one shared refusal. The error rides the gateway `unavailable` family: a
 * missing grant is a capability gap, not a runtime error
 * (contract/primitives.md §4), and each consumer maps it into its own
 * refusal shape (the shell's executor → exit 2; the provider → the tool
 * error surface). */
export const scopeRoots = (surface) => {
  log.debug('scope roots', { surface });
  const workspace = globalThis.__dshProfileCwd;
  const scopeRoot = globalThis.__dshProfileScopeRoot;
  if (typeof workspace !== 'string' || typeof scopeRoot !== 'string'
      || !workspace.startsWith(scopeRoot)) {
    throw new GatewayError('unavailable', surface,
      'the host granted no scoped workspace (no __dshProfileScopeRoot)');
  }
  return { workspace, scopeRoot };
};

/** The workspace prefix inside the `app` scope: the pinned cwd spelled
 * relative to the scope root, leading slashes stripped ('' when the
 * workspace sits AT the scope root). */
export const workspacePrefix = ({ workspace, scopeRoot }) => {
  log.debug('workspace prefix', {});
  return workspace.slice(scopeRoot.length).replace(/^\/+/, '');
};

/** The app-scope address of a normalized workspace-relative path under a
 * prefix: '' joins to the prefix itself, and a wholly empty result names
 * '.' (the gateway's root spelling). The shell's toGateway and the dsh-fs
 * cordis provider share this algebra byte-for-byte. */
export const appScopeAddress = (clean, prefix) => {
  log.debug('app scope address', { clean, prefix });
  const path = prefix.length === 0 ? clean : (clean.length === 0 ? prefix : `${prefix}/${clean}`);
  return { scope: 'app', path: path === '' ? '.' : path };
};
