'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSubscriptionRequest, subscriptionTarget, readSubscriptionResponse, chatSubscriptionHttp, requestSubscriptionHttp } = require('./subscription/http.cjs');
const { createSubscriptionRouter } = require('./subscription/router.cjs');
const settings = extra => ({ subscriptionProvider: 'compatible', subscriptionVendor: 'other', subscriptionProtocol: 'openai', subscriptionEndpoint: 'https://api.example.test/prefix/v1', subscriptionModel: 'chosen-model', ...extra });
const messages = [{ role: 'system', content: 'Only use supplied facts.' }, { role: 'user', content: 'Synthetic source text.' }];
const images = ['data:image/png;base64,aGVsbG8='];
const input = config => ({ settings: settings(config), subscriptionApiKey: 'synthetic-plan-secret', messages, images });
const response = payload => ({ status: 200, body: JSON.stringify(payload) });

test('explicit plan protocols convert text and images and use only their own key headers, without tools', () => {
  const openai = buildSubscriptionRequest(input());
  assert.equal(openai.endpoint, 'https://api.example.test/prefix/v1/chat/completions');
  assert.deepEqual(openai.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-plan-secret' });
  const first = JSON.parse(openai.body);
  assert.equal(first.model, 'chosen-model'); assert.equal(first.stream, false);
  assert.deepEqual(first.messages[1].content, [{ type: 'text', text: messages[1].content }, { type: 'image_url', image_url: { url: images[0] } }]);
  const anthropic = buildSubscriptionRequest(input({ subscriptionProtocol: 'anthropic', subscriptionVendor: 'claude', subscriptionEndpoint: 'https://api.anthropic.com/v1/messages' }));
  assert.equal(anthropic.endpoint, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropic.headers['x-api-key'], 'synthetic-plan-secret');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropic.headers.Authorization, undefined);
  const second = JSON.parse(anthropic.body);
  assert.equal(second.system, messages[0].content); assert.equal(second.messages.length, 1);
  assert.deepEqual(second.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } });
  const gemini = buildSubscriptionRequest(input({ subscriptionProtocol: 'gemini', subscriptionVendor: 'gemini', subscriptionEndpoint: 'https://generativelanguage.googleapis.com/v1beta' }));
  assert.equal(gemini.endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/chosen-model:generateContent');
  assert.deepEqual(gemini.headers, { 'Content-Type': 'application/json', 'x-goog-api-key': 'synthetic-plan-secret', 'x-goog-api-client': `cavwic-presales-solution-tool/${require('../package.json').version}` });
  const third = JSON.parse(gemini.body);
  assert.deepEqual(third.systemInstruction, { parts: [{ text: messages[0].content }] });
  assert.deepEqual(third.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } });
  for (const payload of [first, second, third]) { assert.equal(payload.tools, undefined); assert.equal(payload.mcp_servers, undefined); }
  assert.equal(buildSubscriptionRequest(input({ subscriptionVendor: 'openai' })).vendor, 'openai');
  assert.match(buildSubscriptionRequest(input({ subscriptionEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai' })).headers['x-goog-api-client'], /^cavwic-presales-solution-tool\//);
});

test('MiniMax uses an official domain and exact chosen model; no default or unsupported protocol is invented', () => {
  const config = { subscriptionProvider: 'minimax', subscriptionVendor: 'minimax', subscriptionEndpoint: 'https://api.minimax.cn/v1', subscriptionModel: 'MiniMax-M3.1-Flash' };
  const target = buildSubscriptionRequest(input(config));
  assert.equal(target.endpoint, 'https://api.minimax.cn/v1/chat/completions');
  assert.equal(JSON.parse(target.body).reasoning_split, true);
  assert.equal(JSON.parse(target.body).model, config.subscriptionModel);
  assert.throws(() => buildSubscriptionRequest(input({ ...config, subscriptionEndpoint: 'https://not-minimax.example/v1' })), { code: 'SUBSCRIPTION_ENDPOINT_INVALID' });
  assert.throws(() => buildSubscriptionRequest(input({ ...config, subscriptionProtocol: 'gemini' })), { code: 'SUBSCRIPTION_PROTOCOL_INVALID' });
  assert.throws(() => buildSubscriptionRequest(input({ ...config, subscriptionModel: '' })), { code: 'MODEL_NAME_INVALID' });
});

test('plan validation rejects membership endpoints with coding-only restrictions and malformed inputs before any HTTP', async () => {
  let called = false;
  for (const subscriptionEndpoint of ['https://coding-intl.dashscope.aliyuncs.com/v1', 'https://coding.dashscope.aliyuncs.com/v1', 'https://api.kimi.com/coding/v1', 'https://open.bigmodel.cn/api/coding/paas/v4']) {
    await assert.rejects(chatSubscriptionHttp(input({ subscriptionEndpoint }), { request: async () => { called = true; } }), { code: 'SUBSCRIPTION_ENDPOINT_UNSUPPORTED' });
  }
  for (const config of [{ subscriptionProvider: 'unknown' }, { subscriptionProtocol: 'unknown' }, { subscriptionEndpoint: 'https://api.example.test/v1?key=private' }, { subscriptionModel: 'model\n--execute' }, { subscriptionEndpoint: 'http://public.example.test/v1' }]) assert.throws(() => buildSubscriptionRequest(input(config)));
  assert.throws(() => buildSubscriptionRequest({ ...input(), subscriptionApiKey: '' }), { code: 'SUBSCRIPTION_KEY_REQUIRED' });
  assert.throws(() => buildSubscriptionRequest({ ...input(), subscriptionApiKey: 'private\r\nInjected: secret' }), { code: 'SUBSCRIPTION_KEY_REQUIRED' });
  assert.throws(() => buildSubscriptionRequest({ ...input(), images: ['file:///C:/private.png'] }), { code: 'MODEL_INPUT_INVALID' });
  assert.equal(called, false);
});

test('protocol responses extract only completed text and exclude thinking from output', () => {
  const openai = subscriptionTarget(settings());
  assert.deepEqual(readSubscriptionResponse(response({ model: 'chosen-model', choices: [{ finish_reason: 'stop', message: { content: '<think>private reasoning</think>Final text' } }] }), openai), { content: 'Final text', model: 'chosen-model' });
  const anthropic = subscriptionTarget(settings({ subscriptionProtocol: 'anthropic' }));
  assert.equal(readSubscriptionResponse(response({ model: 'chosen-model', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Final text' }] }), anthropic).content, 'Final text');
  const gemini = subscriptionTarget(settings({ subscriptionProtocol: 'gemini' }));
  assert.equal(readSubscriptionResponse(response({ modelVersion: 'chosen-model', candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private' }, { text: 'Final text' }] } }] }), gemini).content, 'Final text');
});

test('incomplete, tool-only, blocked and provider-error responses cannot become generation success', () => {
  const openai = subscriptionTarget(settings());
  for (const payload of [
    { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'partial', tool_calls: [{}] } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '<think>private</think>' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '<think>incomplete' } }] },
    { error: { message: 'secret provider detail' } },
  ]) assert.throws(() => readSubscriptionResponse(response(payload), openai));
  assert.throws(() => readSubscriptionResponse(response({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }), subscriptionTarget(settings({ subscriptionProtocol: 'anthropic' }))));
  assert.throws(() => readSubscriptionResponse(response({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'partial' }] } }] }), subscriptionTarget(settings({ subscriptionProtocol: 'gemini' }))));
  assert.throws(() => readSubscriptionResponse({ status: 401, body: 'private secret detail' }, openai), error => error.code === 'SUBSCRIPTION_REQUEST_FAILED' && !error.message.includes('private'));
});

test('HTTP aliases record the returned actual model, while missing IDs use the request and malformed IDs fail', () => {
  const openai = subscriptionTarget(settings({ subscriptionModel: 'model-latest' }));
  assert.equal(readSubscriptionResponse(response({ model: 'model-2026-10-23', choices: [{ finish_reason: 'stop', message: { content: 'Text' } }] }), openai).model, 'model-2026-10-23');
  assert.equal(readSubscriptionResponse(response({ choices: [{ finish_reason: 'stop', message: { content: 'Text' } }] }), openai).model, 'model-latest');
  const anthropic = subscriptionTarget(settings({ subscriptionProtocol: 'anthropic', subscriptionModel: 'claude-sonnet-latest' }));
  assert.equal(readSubscriptionResponse(response({ model: 'claude-sonnet-4-6-20261023', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Text' }] }), anthropic).model, 'claude-sonnet-4-6-20261023');
  const gemini = subscriptionTarget(settings({ subscriptionProtocol: 'gemini', subscriptionModel: 'gemini-pro' }));
  assert.equal(readSubscriptionResponse(response({ modelVersion: 'gemini-pro-2026-10-23', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Text' }] } }] }), gemini).model, 'gemini-pro-2026-10-23');
  for (const model of ['', 42, 'bad\nmodel', 'contains space', '-invalid-prefix', 'a'.repeat(201)]) {
    assert.throws(() => readSubscriptionResponse(response({ model, choices: [{ finish_reason: 'stop', message: { content: 'Text' } }] }), openai), { code: 'MODEL_RESPONSE_INVALID' });
  }
});

test('subscription router preserves legacy Codex, separates explicit HTTP plans and returns an honest manual catalog', async t => {
  const calls = [];
  const codex = { async chat(value) { calls.push(['codex', value]); return { content: 'Codex text', model: 'codex-exact' }; }, async catalog() { calls.push(['catalog']); return { models: [{ model: 'codex-exact' }], defaultModel: 'codex-exact' }; }, close() { calls.push(['close']); } };
  const router = createSubscriptionRouter({ codex, request: async value => { calls.push(['http', value]); return response({ model: 'chosen-model', choices: [{ finish_reason: 'stop', message: { content: 'HTTP text' } }] }); } });
  t.after(() => router.close());
  assert.equal((await router.chat({ messages, model: 'codex-exact' })).content, 'Codex text');
  assert.equal((await router.catalog()).defaultModel, 'codex-exact');
  const before = calls.length;
  assert.deepEqual(await router.catalog({ settings: settings() }), { provider: 'compatible', protocol: 'openai', models: [], defaultModel: '', manualRequired: true, catalogSource: 'manual' });
  assert.equal(calls.length, before);
  assert.equal((await router.chat(input())).content, 'HTTP text');
  assert.equal(calls.filter(row => row[0] === 'codex').length, 1);
  assert.equal(calls.filter(row => row[0] === 'http').length, 1);
  router.close(); await assert.rejects(router.chat(input()), { code: 'MODEL_SERVICE_CLOSED' });
});

test('subscription transport disallows redirects and hides connection diagnostics without falling back', async () => {
  let recorded;
  const request = buildSubscriptionRequest(input());
  const result = await requestSubscriptionHttp(request, { fetchImpl: async (url, options) => { recorded = { url: String(url), options }; return new Response(JSON.stringify({ choices: [] }), { status: 200 }); } });
  assert.equal(result.status, 200); assert.equal(recorded.options.redirect, 'error'); assert.equal(recorded.options.method, 'POST');
  assert.equal(recorded.options.headers.Authorization, 'Bearer synthetic-plan-secret');
  await assert.rejects(chatSubscriptionHttp(input(), { request: async () => { throw new Error('private credential and prompt'); } }), error => error.code === 'SUBSCRIPTION_CONNECTION_FAILED' && !error.message.includes('private'));
});
