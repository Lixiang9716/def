// dsh:logging-exempt (mount seam: logging happens through the mounted logger)
/**
 * llm-gateway-mount — the dsh-base row `llm`: the VENDORED LlmRuntime with
 * the gateway transport adapter registered for the caller's provider route,
 * DECLARED in the configurable-provider directory under the route's settings
 * namespace (upstream/preset — the models 设置页 renders a provider only when
 * the directory names it; the namespace itself is registered by the settings
 * legs, web-write-settings.js). Split from upstream/boot.js at the file-size
 * gate (2026-10-11, the llm-pi-ai leg) — unchanged behavior.
 */
import { LlmRuntime, attributionHeaders } from '@deepseek-ai/dsh-llm';
import { createGatewayLlmAdapter } from 'upstream/llm-transport.js';
import { registerRouteDisposer, registerDirectoryHandle } from 'upstream/llm-route.js';
import { providerSettingsNs } from 'upstream/web-write-settings.js';

/** Mount the llm service over the gateway adapter for ONE provider route. */
export const mountGatewayLlm = async (ctx, llm, onEvent) => {
  await ctx.plugin(LlmRuntime);
  const runtime = ctx.get('llm');
  if (runtime === undefined) throw new Error('boot: the LlmRuntime failed to mount under "llm"');
  const routeDisposer = runtime.registerAdapter([llm.provider], createGatewayLlmAdapter({
    baseURL: llm.baseURL,
    apiKey: llm.apiKey,
    provider: llm.provider,
    name: llm.adapterName ?? 'mock loopback chat-completions (dsh-llm-mock-server)',
    userEndpoint: llm.userEndpoint === true,
    onWire: llm.onWire,
    onSse: llm.onSse,
    onRequestBody: llm.onRequestBody, readIdleTimeoutMs: llm.readIdleTimeoutMs, // loop-u2's attempt-level stall guard; undefined = the 120s default
    contextWindow: llm.contextWindow, // the compaction capacity (resolveModel's context); undefined = the route stages none
  }));
  registerRouteDisposer(ctx, routeDisposer); // the BYOK rebind seam (upstream/llm-route.js)
  // The directory handle rides the same seam: a rebind/restore atomically replaces the
  // models 设置页 row. Both registries key on the boot CONTEXT — ctx.get('llm') hands
  // out a fresh wrapper per access, so the service object is not an identity.
  registerDirectoryHandle(ctx, runtime.registerConfigurableProviders([{
    provider: llm.provider,
    displayName: llm.displayName ?? 'OpenAI 兼容',
    settingsNs: providerSettingsNs(llm.provider),
    settingsPath: ['providers', 'default'],
  }]));
  onEvent('llm/runtime', {
    provider: llm.provider,
    model: llm.model,
    service: 'vendored @deepseek-ai/dsh-llm LlmRuntime (adapter registry)',
    transport: llm.transportLabel
      ?? 'gateway httpFetch → loopback chat-completions mock server',
    userAgent: attributionHeaders()['user-agent'],
  });
};
