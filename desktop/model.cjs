'use strict';
const { isIP } = require('node:net');

function validateEndpoint(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\\\u0000-\u0020\u007f]/.test(value)) throw new Error('接口地址无效 / Invalid model endpoint');
  const endpoint = new URL(value);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('接口地址无效 / Invalid model endpoint');
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = hostname === 'localhost' || hostname === '::1' || (isIP(hostname) === 4 && (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)));
  if (endpoint.protocol !== 'https:' && !local) throw new Error('公网模型接口请使用 HTTPS / Use HTTPS for a public endpoint');
  return endpoint;
}

function validateAuthorization(value) {
  if (typeof value !== 'string' || value.length > 16400 || /[\r\n]/.test(value)) throw new Error('接口密钥无效 / Invalid API key');
}

function validateRequest(input) {
  const endpoint = validateEndpoint(input?.endpoint);
  if (typeof input.body !== 'string' || Buffer.byteLength(input.body) > 100 * 1024 * 1024) throw new Error('请求内容过大 / Request too large');
  const payload = JSON.parse(input.body);
  if (!payload.model || !Array.isArray(payload.messages) || payload.stream) throw new Error('需要非流式 Chat Completions 请求 / A non-streaming Chat Completions request is required');
  validateAuthorization(input.authorization);
  return endpoint;
}

async function requestJson(endpoint, input, method, timeout) {
  const headers = { 'Content-Type': 'application/json' };
  if (input.authorization) headers.Authorization = input.authorization;
  const response = await fetch(endpoint, { method, headers, body: method === 'POST' ? input.body : undefined, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > 32 * 1024 * 1024) throw new Error('模型回复过大 / Model response too large');
    chunks.push(Buffer.from(chunk));
  }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
}

async function requestModel(input) {
  return requestJson(validateRequest(input), input, 'POST', 300000);
}

async function requestCatalog(input) {
  const endpoint = validateEndpoint(input?.endpoint);
  validateAuthorization(input.authorization);
  return requestJson(endpoint, input, 'GET', 15000);
}

module.exports = { requestModel, requestCatalog, validateRequest, validateEndpoint, validateAuthorization };
