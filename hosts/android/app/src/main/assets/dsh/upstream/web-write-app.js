// dsh:logging-exempt (adapter over vendored code paths)
/**
 * web-write-app.js — the app bridge's call arm (split from web-write.js at
 * the file-size gate): the page reaches a mounted plugin's exported
 * service through app/service-call — the generated app's frontend reaches
 * its own backend (plugin-mount's mountedServices registry owns the
 * routing table; unmount drops the row, so stale calls refuse).
 */
import { remoteError } from 'upstream/web-write.js';
import { mountedServiceOf } from 'plugin-mount.js';

export const makeAppServiceCall = () => async (args) => {
  const pluginId = args?.pluginId;
  const method = args?.method;
  if (typeof pluginId !== 'string' || pluginId.length === 0
    || typeof method !== 'string' || method.length === 0) {
    throw remoteError('gateway/bad-request',
      'app/service-call needs pluginId and method', {});
  }
  const service = mountedServiceOf(pluginId);
  const fn = service ? service[method] : undefined;
  if (typeof fn !== 'function') {
    throw remoteError('app/service-not-found',
      `no service method "${method}" on mounted plugin "${pluginId ?? ''}"`,
      { pluginId, method });
  }
  const value = await fn(args?.args ?? {});
  return { value: value === undefined ? null : value };
};
