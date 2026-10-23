'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { requestModel, validateRequest } = require('./model.cjs');

function input(endpoint, overrides = {}) {
  return {
    endpoint,
    authorization: '',
    body: JSON.stringify({ model: 'local-test-model', messages: [{ role: 'user', content: '测试投标文件' }], stream: false }),
    ...overrides,
  };
}

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { server, endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions` };
}

async function readRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('real local HTTP request forwards JSON and authorization, and returns a complete Unicode response', async t => {
  const reply = JSON.stringify({ choices: [{ message: { content: '技术响应：已生成 ✓' } }] });
  let received;
  const { endpoint } = await localServer(t, async (request, response) => {
    received = { method: request.method, url: request.url, headers: request.headers, body: await readRequest(request) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    // Split in the middle of a multibyte character, as a network response can do.
    const bytes = Buffer.from(reply);
    const split = bytes.indexOf(Buffer.from('技')) + 1;
    response.write(bytes.subarray(0, split));
    response.end(bytes.subarray(split));
  });
  const request = input(endpoint, { authorization: 'Bearer sk-local-http-test-only' });
  assert.deepEqual(await requestModel(request), { status: 200, body: reply });
  assert.equal(received.method, 'POST');
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.headers['content-type'], 'application/json');
  assert.equal(received.headers.authorization, request.authorization);
  assert.equal(received.body, request.body);
});

test('a local model without a key receives no Authorization header', async t => {
  let authorization;
  const { endpoint } = await localServer(t, async (request, response) => {
    authorization = request.headers.authorization;
    await readRequest(request);
    response.end('{"choices":[]}');
  });
  assert.equal((await requestModel(input(endpoint))).status, 200);
  assert.equal(authorization, undefined);
});

test('HTTP API errors preserve the status and error body for the caller', async t => {
  const reply = JSON.stringify({ error: { message: 'Invalid API key', code: 'invalid_api_key' } });
  const { endpoint } = await localServer(t, async (request, response) => {
    await readRequest(request);
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(reply);
  });
  assert.deepEqual(await requestModel(input(endpoint)), { status: 401, body: reply });
});

test('network failure rejects the request instead of returning a successful empty response', async t => {
  const { endpoint } = await localServer(t, request => request.socket.destroy());
  await assert.rejects(requestModel(input(endpoint)), /fetch failed|socket|network/i);
});

test('redirects are rejected and never forward credentials to another endpoint', async t => {
  let destinationCalls = 0;
  const destination = await localServer(t, (_request, response) => {
    destinationCalls++;
    response.end('{"unexpected":true}');
  });
  const source = await localServer(t, async (request, response) => {
    await readRequest(request);
    response.writeHead(307, { Location: destination.endpoint });
    response.end();
  });
  await assert.rejects(requestModel(input(source.endpoint, { authorization: 'Bearer sk-redirect-test-only' })));
  assert.equal(destinationCalls, 0);
});

test('oversized model responses are rejected after the response limit', async t => {
  const { endpoint } = await localServer(t, async (request, response) => {
    await readRequest(request);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(Buffer.alloc(32 * 1024 * 1024 + 1, 0x61));
  });
  await assert.rejects(requestModel(input(endpoint)), /Model response too large|模型回复过大/);
});

test('model transport does not write credentials or payloads to disk or logs on success and HTTP failure', async t => {
  let calls = 0;
  const secret = 'sk-memory-only-model-test-secret';
  const { endpoint } = await localServer(t, async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    await readRequest(request);
    response.writeHead(++calls === 1 ? 200 : 403, { 'Content-Type': 'application/json' });
    response.end(calls === 1 ? '{"choices":[]}' : '{"error":"Forbidden"}');
  });
  // Block actual disk mutations, rather than inspecting the implementation's source.
  // This test covers the main-process transport; renderer storage is verified separately.
  const writes = [];
  for (const [target, names] of [
    [fs, ['write', 'writeSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']],
    [fsp, ['writeFile', 'appendFile']],
  ]) for (const name of names) t.mock.method(target, name, (...args) => {
    writes.push({ name, args });
    throw new Error('Model transport attempted a filesystem write');
  });
  const logs = [];
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, name, (...args) => logs.push(args));
  const request = input(endpoint, { authorization: `Bearer ${secret}` });
  assert.equal((await requestModel(request)).status, 200);
  assert.equal((await requestModel(request)).status, 403);
  assert.deepEqual(writes, []);
  assert.deepEqual(logs, []);
});

test('validation allows HTTPS and literal loopback/private IPv4 HTTP endpoints without contacting them', () => {
  for (const endpoint of [
    'https://api.example.test/v1/chat/completions',
    'http://localhost:11434/v1/chat/completions',
    'http://127.0.0.1:11434/v1/chat/completions',
    'http://127.255.0.3:11434/v1/chat/completions',
    'http://[::1]:11434/v1/chat/completions',
    'http://10.20.30.40/v1/chat/completions',
    'http://172.16.0.1/v1/chat/completions',
    'http://172.31.255.254/v1/chat/completions',
    'http://192.168.50.118/v1/chat/completions',
  ]) assert.equal(validateRequest(input(endpoint)).href, new URL(endpoint).href);
});

test('validation rejects unsafe schemes, embedded credentials, fragments and public HTTP', () => {
  for (const endpoint of [
    'file:///C:/secret.txt',
    'ftp://127.0.0.1/file',
    'data:application/json,{}',
    'javascript:alert(1)',
    'https://username:password@api.example.test/v1/chat/completions',
    'https://api.example.test/v1/chat/completions#fragment',
    'http://api.example.test/v1/chat/completions',
    'http://8.8.8.8/v1/chat/completions',
    'http://172.15.255.255/v1/chat/completions',
    'http://172.32.0.1/v1/chat/completions',
    'http://192.169.0.1/v1/chat/completions',
    'http://[2606:4700:4700::1111]/v1/chat/completions',
  ]) assert.throws(() => validateRequest(input(endpoint)), undefined, endpoint);
});

test('public DNS names resembling local IP ranges cannot bypass the HTTPS requirement', () => {
  for (const endpoint of [
    'http://127.attacker.example/v1/chat/completions',
    'http://10.attacker.example/v1/chat/completions',
    'http://192.168.attacker.example/v1/chat/completions',
    'http://172.16.attacker.example/v1/chat/completions',
    'http://localhost.attacker.example/v1/chat/completions',
  ]) assert.throws(() => validateRequest(input(endpoint)), /HTTPS/, endpoint);
});

test('malformed JSON, streaming payloads and header injection fail before any network request', async () => {
  const endpoint = 'http://127.0.0.1:1/v1/chat/completions';
  const invalid = [
    { body: undefined },
    { body: '{' },
    { body: '{}' },
    { body: JSON.stringify({ model: 'test', messages: 'not-an-array' }) },
    { body: JSON.stringify({ model: 'test', messages: [], stream: true }) },
    { authorization: undefined },
    { authorization: 'Bearer key\r\nX-Injected: yes' },
  ];
  for (const overrides of invalid) await assert.rejects(requestModel(input(endpoint, overrides)), error => {
    assert.notEqual(error.message, 'fetch failed', 'Invalid input must be rejected before the transport runs');
    return true;
  });
});
