'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelService, selectedProvider } = require('./model-service.cjs');

const settings = overrides => ({
  schemaVersion: '3.0.0', provider: 'hybrid',
  localEndpoint: 'http://127.0.0.1:11434/v1/chat/completions', localModel: 'local-selected',
  cloudEndpoint: 'https://api.example.test/v1/chat/completions', cloudModel: 'api-selected', codexModel: 'plan-selected',
  enabledProviders: ['local', 'codex', 'cloud'], hybridRoutes: { analysis: 'local', draft: 'codex', ocr: 'cloud' },
  ...overrides,
});

function serviceFixture(t, { requestFailure, planFailure, planModel } = {}) {
  const requests = [], plans = [];
  const subscription = {
    async chat(input) {
      plans.push(input);
      if (planFailure) throw planFailure;
      return { content: '套餐虚构输出', provider: 'codex', model: planModel || input.model || 'resolved-plan-default' };
    },
    async catalog() { return { models: [{ id: 'plan-selected' }] }; },
    close() {},
  };
  const request = async input => {
    requests.push(input);
    if (requestFailure) throw requestFailure;
    const payload = JSON.parse(input.body);
    return { status: 200, body: JSON.stringify({ model: payload.model, choices: [{ message: { content: 'HTTP 虚构输出' } }] }) };
  };
  const service = createModelService({ subscription, request });
  t.after(() => service.close());
  return { service, requests, plans };
}

test('native hybrid tasks dispatch exactly once to the selected local, plan, and API channels', async t => {
  const { service, requests, plans } = serviceFixture(t);
  const config = settings();
  const local = await service.chat({ settings: config, apiKey: 'synthetic-api-secret', prompt: '虚构资料分析', task: 'analysis' });
  const plan = await service.chat({ settings: config, apiKey: 'synthetic-api-secret', prompt: '虚构文件生成', task: 'draft' });
  const api = await service.chat({ settings: config, apiKey: 'synthetic-api-secret', prompt: '虚构文字识别', task: 'ocr', images: ['data:image/png;base64,aGVsbG8='] });
  assert.deepEqual(local, { content: 'HTTP 虚构输出', provider: 'local', model: 'local-selected' });
  assert.deepEqual(plan, { content: '套餐虚构输出', provider: 'codex', model: 'plan-selected' });
  assert.deepEqual(api, { content: 'HTTP 虚构输出', provider: 'cloud', model: 'api-selected' });
  assert.equal(requests.length, 2); assert.equal(plans.length, 1);
  assert.equal(requests[0].endpoint, config.localEndpoint); assert.equal(requests[0].authorization, '');
  assert.equal(requests[1].endpoint, config.cloudEndpoint); assert.equal(requests[1].authorization, 'Bearer synthetic-api-secret');
  const body = JSON.parse(requests[1].body);
  assert.equal(body.model, 'api-selected'); assert.equal(body.temperature, 0); assert.equal(body.stream, false);
  assert.deepEqual(body.messages[1].content, [{ type: 'text', text: '虚构文字识别' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }]);
  assert.equal(plans[0].model, 'plan-selected');
});

test('native local failure is surfaced without falling back to configured API or subscription', async t => {
  const failure = new Error('Synthetic local connection failure');
  const { service, requests, plans } = serviceFixture(t, { requestFailure: failure });
  await assert.rejects(service.chat({ settings: settings({ provider: 'local' }), apiKey: 'synthetic-api-secret', prompt: '虚构内容', task: 'draft' }), failure);
  assert.equal(requests.length, 1); assert.equal(requests[0].authorization, '');
  assert.equal(requests[0].endpoint, settings().localEndpoint); assert.equal(plans.length, 0);
});

test('native hybrid stale routes use an enabled channel, and disabled test requests do not call any backend', async t => {
  const { service, requests, plans } = serviceFixture(t);
  const config = settings({ enabledProviders: ['local'], hybridRoutes: { analysis: 'cloud', draft: 'codex', ocr: 'cloud' } });
  for (const task of ['analysis', 'draft', 'ocr']) assert.equal(selectedProvider(config, task), 'local');
  const result = await service.chat({ settings: config, prompt: '虚构内容', task: 'draft' });
  assert.equal(result.provider, 'local'); assert.equal(plans.length, 0); assert.equal(requests.length, 1);
  await assert.rejects(service.test({ settings: config, provider: 'cloud' }), { code: 'MODEL_CHANNEL_DISABLED' });
  assert.equal(requests.length, 1); assert.equal(plans.length, 0);
});

test('subscription generation must complete the selected model and cannot silently substitute another model', async t => {
  const { service, requests, plans } = serviceFixture(t, { planModel: 'different-plan-model' });
  await assert.rejects(service.chat({ settings: settings({ provider: 'codex' }), prompt: '虚构内容' }), { code: 'MODEL_RESPONSE_INVALID' });
  assert.equal(plans.length, 1); assert.equal(requests.length, 0);
});

test('subscription default records the model actually resolved by the provider', async t => {
  const { service, requests } = serviceFixture(t);
  const result = await service.chat({ settings: settings({ provider: 'codex', codexModel: '' }), prompt: '虚构内容' });
  assert.equal(result.model, 'resolved-plan-default'); assert.equal(result.provider, 'codex'); assert.equal(requests.length, 0);
});

test('HTTP subscription aliases retain the returned actual model without changing the requested model or retrying', async t => {
  const { service, plans, requests } = serviceFixture(t, { planModel: 'actual-model-2026-10-23' });
  const result = await service.chat({ settings: settings({ provider: 'codex', subscriptionProvider: 'compatible', subscriptionModel: 'model-latest' }), prompt: 'Synthetic content' });
  assert.equal(result.model, 'actual-model-2026-10-23');
  assert.equal(plans[0].model, 'model-latest');
  assert.equal(plans.length, 1); assert.equal(requests.length, 0);
});

test('native service rejects invalid tasks, disabled empty channels and invalid images before dispatch', async t => {
  const { service, requests, plans } = serviceFixture(t);
  for (const input of [
    { settings: settings(), prompt: '虚构内容', task: 'unsupported' },
    { settings: settings({ enabledProviders: [] }), prompt: '虚构内容' },
    { settings: settings(), prompt: '虚构内容', images: ['file:///C:/not-readable'] },
    { settings: settings(), prompt: '  ' },
  ]) await assert.rejects(service.chat(input));
  assert.equal(requests.length, 0); assert.equal(plans.length, 0);
});

test('generation tests report the channel and exact configured model', async t => {
  const { service, requests } = serviceFixture(t);
  const result = await service.test({ settings: settings(), apiKey: 'synthetic-api-secret', provider: 'cloud' });
  assert.deepEqual(result, { provider: 'cloud', model: 'api-selected', verified: true });
  assert.equal(requests.length, 1);
  assert.match(JSON.parse(requests[0].body).messages[1].content, /BID_READY/);
});

test('all native model routes receive the same skill context and plan keys never leak to other channels', async t => {
  let skillReads = 0;
  const requests = [], plans = [];
  const plan = { async chat(value) { plans.push(value); return { content: 'Generated', model: value.model }; }, catalog: async value => value, close() {} };
  const service = createModelService({ subscription: plan, buildSkillContext: async () => { skillReads++; return 'Trusted skill context.'; }, request: async value => { requests.push(value); const data = JSON.parse(value.body); return responseForModel(data.model); } });
  t.after(() => service.close());
  for (const [provider, subscriptionProvider] of [['local', 'codex'], ['cloud', 'codex'], ['codex', 'codex'], ['codex', 'compatible']]) {
    await service.chat({ settings: settings({ provider, subscriptionProvider, subscriptionModel: 'explicit-plan-model' }), prompt: 'Synthetic source.', apiKey: 'cloud-secret', localApiKey: 'local-secret', subscriptionApiKey: 'plan-secret' });
  }
  assert.equal(skillReads, 4);
  for (const request of requests) assert.match(JSON.parse(request.body).messages[1].content, /Trusted skill context\.[\s\S]*Synthetic source\./);
  for (const value of plans) { assert.match(value.messages[1].content, /Trusted skill context\.[\s\S]*Synthetic source\./); assert.equal(value.subscriptionApiKey, 'plan-secret'); }
  assert.equal(requests.some(value => value.authorization.includes('plan-secret')), false);
  assert.equal(plans[1].model, 'explicit-plan-model');
  const catalogInput = { settings: settings({ subscriptionProvider: 'compatible' }), subscriptionApiKey: 'plan-secret' };
  assert.deepEqual(await service.catalog(catalogInput), catalogInput);
});

function responseForModel(model) { return { status: 200, body: JSON.stringify({ model, choices: [{ message: { content: 'Generated' } }] }) }; }

test('connectivity tests skip skill loading, and oversized raw or enhanced prompts stop before dispatch', async t => {
  let context = 'Skills.', reads = 0, calls = 0;
  const service = createModelService({ subscription: { async chat(value) { calls++; return { content: 'BID_READY', model: value.model }; }, close() {} }, buildSkillContext: async () => { reads++; return context; } });
  t.after(() => service.close());
  await service.test({ settings: settings({ provider: 'codex' }), provider: 'codex' });
  assert.equal(reads, 0); assert.equal(calls, 1);
  await assert.rejects(service.chat({ settings: settings({ provider: 'codex' }), prompt: 'a'.repeat(2 * 1024 * 1024 + 1) }), { code: 'MODEL_INPUT_INVALID' });
  assert.equal(reads, 0); assert.equal(calls, 1);
  context = 'a'.repeat(2 * 1024 * 1024);
  await assert.rejects(service.chat({ settings: settings({ provider: 'codex' }), prompt: 'Source.' }), { code: 'MODEL_INPUT_INVALID' });
  assert.equal(reads, 1); assert.equal(calls, 1);
});
