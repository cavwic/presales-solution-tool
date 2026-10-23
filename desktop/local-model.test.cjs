'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { localEndpoint, chatLocal, localCatalog } = require('./local-model.cjs');
const { createModelService } = require('./model-service.cjs');

const config = overrides => ({ provider: 'local', localRuntime: 'ollama', localEndpoint: 'http://127.0.0.1:11434', localModel: 'qwen3:4b', ...overrides });
const messages = [{ role: 'system', content: 'Use supplied evidence only.' }, { role: 'user', content: '测试资料' }];
const json = payload => ({ status: 200, body: JSON.stringify(payload) });
const subscription = () => ({ close() {}, catalog: async () => ({ models: [] }), chat: async () => { throw new Error('Unexpected subscription call'); } });

async function fixtureServer(t, handler) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const call = { method: request.method, url: request.url, authorization: request.headers.authorization, body: body ? JSON.parse(body) : undefined };
    calls.push(call);
    await handler(call, response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  return { calls, endpoint: `http://127.0.0.1:${server.address().port}` };
}

test('local endpoint normalization preserves base prefixes, complete endpoints and query parameters', () => {
  for (const [runtime, value, expectedChat, expectedCatalog] of [
    ['ollama', '', '/api/chat', '/api/tags'],
    ['ollama', '/api/', '/api/chat', '/api/tags'],
    ['ollama', '/proxy/api/chat/', '/proxy/api/chat', '/proxy/api/tags'],
    ['ollama', '/proxy/api/tags', '/proxy/api/chat', '/proxy/api/tags'],
    ['ollama', '/proxy', '/proxy/api/chat', '/proxy/api/tags'],
    ['ollama', '/v1', '/api/chat', '/api/tags'],
    ['ollama', '/proxy/v1/chat/completions/', '/proxy/api/chat', '/proxy/api/tags'],
    ['ollama', '/proxy/v1/models', '/proxy/api/chat', '/proxy/api/tags'],
    ['lmstudio', '', '/v1/chat/completions', '/v1/models'],
    ['lmstudio', '/v1/', '/v1/chat/completions', '/v1/models'],
    ['lmstudio', '/proxy/v1/chat/completions/', '/proxy/v1/chat/completions', '/proxy/v1/models'],
    ['openai', '/proxy', '/proxy/v1/chat/completions', '/proxy/v1/models'],
    ['openai', '/proxy/v1/models', '/proxy/v1/chat/completions', '/proxy/v1/models'],
    ['openai', '/proxy/chat/completions', '/proxy/chat/completions', '/proxy/models'],
  ]) {
    const settings = config({ localRuntime: runtime, localEndpoint: `http://127.0.0.1:1234${value}?tenant=blue%20team&version=2` });
    assert.equal(localEndpoint(settings).endpoint, `http://127.0.0.1:1234${expectedChat}?tenant=blue%20team&version=2`);
    assert.equal(localEndpoint(settings, 'catalog').endpoint, `http://127.0.0.1:1234${expectedCatalog}?tenant=blue%20team&version=2`);
  }
});

test('legacy settings without localRuntime stay on OpenAI compatibility and do not guess from port', () => {
  const settings = config({ localRuntime: undefined, localEndpoint: 'http://127.0.0.1:11434/v1/chat/completions' });
  assert.deepEqual(localEndpoint(settings), { runtime: 'openai', endpoint: settings.localEndpoint });
});

test('local endpoints reject unsafe URLs and unsupported protocols before any transport', async () => {
  let calls = 0;
  const request = async () => { calls++; return json({ data: [] }); };
  for (const endpoint of ['file:///C:/secret', 'https://user:secret@example.test/v1', 'https://example.test/v1#token', 'http://example.test/v1', 'http://127.attacker.test/v1', 'http://8.8.8.8/v1', 'http://127.0.0.1:1234/a\nb', 'http:\\127.0.0.1\\v1']) {
    await assert.rejects(localCatalog({ settings: config({ localEndpoint: endpoint }) }, { request }), undefined, endpoint);
  }
  await assert.rejects(localCatalog({ settings: config({ localRuntime: 'guess' }) }, { request }), { code: 'MODEL_SETTINGS_INVALID' });
  assert.equal(calls, 0);
});

test('Ollama uses native non-streaming chat with raw base64 images and local token only', async t => {
  const fixture = await fixtureServer(t, (call, response) => {
    assert.equal(call.method, 'POST');
    assert.equal(call.url, '/engine/api/chat?tenant=local');
    assert.equal(call.authorization, 'Bearer local-fixture-token');
    assert.deepEqual(call.body, { model: 'qwen3:4b', messages: [messages[0], { ...messages[1], images: ['aGVsbG8='] }], options: { temperature: 0 }, think: false, stream: false });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ model: 'qwen3:4b', message: { role: 'assistant', content: ' 本地模型正文 ✓ ' }, done: true }));
  });
  const result = await chatLocal({ settings: config({ localEndpoint: `${fixture.endpoint}/engine/api/chat?tenant=local` }), localApiKey: 'local-fixture-token', messages, temperature: 0, images: ['data:image/png;base64,aGVsbG8='] });
  assert.deepEqual(result, { content: '本地模型正文 ✓', model: 'qwen3:4b' });
  assert.equal(fixture.calls.length, 1);
  assert.equal(messages[1].images, undefined, 'Source messages must not be mutated');
});

test('LM Studio and OpenAI-compatible local servers use exact selected model and multimodal Chat Completions', async t => {
  for (const runtime of ['lmstudio', 'openai']) {
    const fixture = await fixtureServer(t, (call, response) => {
      assert.equal(call.method, 'POST');
      assert.equal(call.url, '/proxy/v1/chat/completions?tenant=blue');
      assert.equal(call.authorization, undefined);
      assert.deepEqual(call.body, { model: 'custom-loaded-model', messages: [messages[0], { role: 'user', content: [{ type: 'text', text: messages[1].content }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' } }] }], temperature: 0.2, stream: false });
      response.end(JSON.stringify({ choices: [{ message: { content: '兼容模型正文' } }] }));
    });
    const result = await chatLocal({ settings: config({ localRuntime: runtime, localEndpoint: `${fixture.endpoint}/proxy/v1?tenant=blue`, localModel: 'custom-loaded-model' }), messages, images: ['data:image/jpeg;base64,aGVsbG8='] });
    assert.equal(result.content, '兼容模型正文');
    assert.equal(result.model, 'custom-loaded-model');
    assert.equal(fixture.calls.length, 1);
  }
});

test('catalog reads only model directory without POST, model selection, loading or generation', async t => {
  for (const runtime of ['ollama', 'lmstudio', 'openai']) {
    const fixture = await fixtureServer(t, (call, response) => {
      assert.equal(call.method, 'GET');
      assert.equal(call.url, runtime === 'ollama' ? '/prefix/api/tags?q=1' : '/prefix/v1/models?q=1');
      assert.equal(call.authorization, 'Bearer local-catalog-token');
      assert.equal(call.body, undefined);
      response.end(JSON.stringify(runtime === 'ollama' ? { models: [{ name: 'a:4b', model: 'a:4b' }, { name: 'b:7b' }, { model: 'a:4b' }, { name: '' }] } : { data: [{ id: 'a:4b' }, { id: 'b:7b' }, { id: 'a:4b' }, { id: '' }] }));
    });
    const settings = config({ localRuntime: runtime, localEndpoint: `${fixture.endpoint}/prefix${runtime === 'ollama' ? '/api/chat' : '/v1/chat/completions'}?q=1`, localModel: '' });
    const result = await localCatalog({ settings, localApiKey: 'local-catalog-token' });
    assert.deepEqual(result.models, [{ model: 'a:4b', displayName: 'a:4b' }, { model: 'b:7b', displayName: 'b:7b' }]);
    assert.equal(result.runtime, runtime);
    assert.equal(settings.localModel, '');
    assert.equal(fixture.calls.length, 1);
  }
});

test('empty catalog succeeds without inventing a default model; malformed catalogs reject', async () => {
  assert.deepEqual((await localCatalog({ settings: config() }, { request: async () => json({ models: [] }) })).models, []);
  for (const payload of [{}, { models: {} }, { error: 'not authenticated' }, null, []]) await assert.rejects(localCatalog({ settings: config() }, { request: async () => json(payload) }));
  await assert.rejects(localCatalog({ settings: config() }, { request: async () => ({ status: 401, body: '{"error":"Forbidden"}' }) }), { code: 'MODEL_REQUEST_FAILED' });
  await assert.rejects(localCatalog({ settings: config() }, { request: async () => ({ status: 200, body: '<html>Not JSON</html>' }) }), { code: 'MODEL_RESPONSE_INVALID' });
});

test('Ollama incomplete, thinking-only, error and empty replies cannot be reported as successful generation', async () => {
  for (const payload of [
    { message: { content: 'unfinished' }, done: false },
    { message: { content: 'unfinished' } },
    { message: { content: '', thinking: 'hidden reasoning only' }, done: true },
    { message: { content: '  ' }, done: true },
    { error: 'model missing', done: true, message: { content: 'invalid' } },
    { response: 'wrong generate API', done: true },
  ]) await assert.rejects(chatLocal({ settings: config(), messages }, { request: async () => json(payload) }));
});

test('local generation records returned model identity while sending the exact selected alias only once', async () => {
  const calls = [];
  const result = await chatLocal({ settings: config({ localModel: 'chosen-alias' }), messages }, { request: async input => {
    calls.push(input);
    return json({ model: 'resolved-model:quantized', done: true, message: { content: '完成' } });
  } });
  assert.equal(result.model, 'resolved-model:quantized');
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].body).model, 'chosen-alias');
});

test('local generation rejects missing models, invalid tokens and bad images before transport', async () => {
  let calls = 0;
  const request = async () => { calls++; return json({ message: { content: 'unexpected' }, done: true }); };
  for (const input of [
    { settings: config({ localModel: '' }), messages },
    { settings: config(), messages, localApiKey: 'token\r\nInjected: bad' },
    { settings: config(), messages, localApiKey: {} },
    { settings: config(), messages, images: ['file:///C:/secret.png'] },
    { settings: config(), messages: [] },
  ]) await assert.rejects(chatLocal(input, { request }));
  assert.equal(calls, 0);
});

test('service local chat, catalog and test isolate local token from cloud API token', async t => {
  const requests = [], catalogs = [];
  const service = createModelService({ subscription: subscription(), request: async input => { requests.push(input); return json({ message: { content: 'BID_READY' }, done: true }); }, requestCatalog: async input => { catalogs.push(input); return json({ models: [{ name: 'qwen3:4b' }] }); } });
  t.after(() => service.close());
  const settings = config();
  const input = { settings, localApiKey: 'local-only-token', apiKey: 'cloud-secret-never-forward', prompt: '测试资料' };
  assert.equal((await service.chat(input)).provider, 'local');
  assert.deepEqual(await service.test({ ...input, provider: 'local' }), { provider: 'local', model: 'qwen3:4b', verified: true });
  assert.equal((await service.localCatalog(input)).models[0].model, 'qwen3:4b');
  assert.equal(requests.length, 2); assert.equal(catalogs.length, 1);
  for (const request of [...requests, ...catalogs]) { assert.equal(request.authorization, 'Bearer local-only-token'); assert.doesNotMatch(JSON.stringify(request), /cloud-secret/); }
});

test('service does not forward cloud key when local token is absent, and catalog fails after close', async () => {
  const calls = [];
  const service = createModelService({ subscription: subscription(), request: async input => { calls.push(input); return json({ choices: [{ message: { content: 'BID_READY' } }] }); } });
  const settings = config({ localRuntime: 'openai', localEndpoint: 'http://127.0.0.1:1234' });
  await service.chat({ settings, apiKey: 'cloud-secret-never-forward', prompt: '测试资料' });
  assert.equal(calls[0].authorization, '');
  assert.equal(calls[0].endpoint, 'http://127.0.0.1:1234/v1/chat/completions');
  service.close();
  assert.throws(() => service.localCatalog({ settings }), { code: 'MODEL_SERVICE_CLOSED' });
});

test('cloud requests never receive the local server token when both secrets are supplied', async t => {
  const calls = [];
  const service = createModelService({ subscription: subscription(), request: async input => { calls.push(input); return json({ choices: [{ message: { content: 'BID_READY' } }] }); } });
  t.after(() => service.close());
  const settings = config({ provider: 'cloud', cloudEndpoint: 'https://api.example.test/v1/chat/completions', cloudModel: 'exact-api-model' });
  const result = await service.chat({ settings, apiKey: 'cloud-only-token', localApiKey: 'local-secret-never-forward', prompt: '测试资料' });
  assert.equal(result.provider, 'cloud');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization, 'Bearer cloud-only-token');
  assert.doesNotMatch(JSON.stringify(calls), /local-secret/);
});

test('local catalog redirects never forward local token to a different server', async t => {
  const destination = await fixtureServer(t, (_call, response) => response.end('{"models":[]}'));
  const source = await fixtureServer(t, (_call, response) => { response.writeHead(307, { Location: `${destination.endpoint}/api/tags` }); response.end(); });
  await assert.rejects(localCatalog({ settings: config({ localEndpoint: source.endpoint }), localApiKey: 'local-secret' }));
  assert.equal(destination.calls.length, 0);
});
