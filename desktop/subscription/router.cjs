'use strict';
const { createSubscriptionProvider } = require('./index.cjs');
const { selectedSubscriptionProvider, subscriptionTarget, chatSubscriptionHttp } = require('./http.cjs');
const fail = () => Object.assign(new Error('套餐连接已关闭 / Plan connection is closed'), { code: 'MODEL_SERVICE_CLOSED' });

function createSubscriptionRouter({ userData, codex, request } = {}) {
  let closed = false;
  const native = codex || createSubscriptionProvider({ userData });
  return {
    async chat(input = {}) {
      if (closed) throw fail();
      const provider = selectedSubscriptionProvider(input.settings);
      return provider === 'codex' ? native.chat(input) : chatSubscriptionHttp(input, { request });
    },
    async catalog(input = {}) {
      if (closed) throw fail();
      const provider = selectedSubscriptionProvider(input.settings);
      if (provider === 'codex') return native.catalog();
      const target = subscriptionTarget(input.settings, 'catalog');
      // No public account-entitlement catalog is assumed. A manual exact model is explicit.
      return { provider, protocol: target.protocol, models: [], defaultModel: '', manualRequired: true, catalogSource: 'manual' };
    },
    async status(input = {}) {
      if (closed) throw fail();
      const provider = selectedSubscriptionProvider(input.settings);
      if (provider === 'codex') { await native.start(); await native.account(); return { provider, configured: true, verified: true, authentication: 'existing-client' }; }
      const target = subscriptionTarget(input.settings, 'catalog');
      return { provider, protocol: target.protocol, configured: Boolean(input.settings?.subscriptionModel && input.subscriptionApiKey), verified: false, authentication: 'api-key' };
    },
    close() { closed = true; native.close(); },
  };
}
module.exports = { createSubscriptionRouter };
