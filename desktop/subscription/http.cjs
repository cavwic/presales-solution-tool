'use strict';
const { validateEndpoint, validateAuthorization } = require('../model.cjs');
const fail = (code, message) => Object.assign(new Error(message), { code });
const PROVIDERS = new Set(['codex', 'minimax', 'compatible']);
const PROTOCOLS = new Set(['openai', 'anthropic', 'gemini']);
const VENDORS = new Set(['openai', 'claude', 'gemini', 'grok', 'deepseek', 'qwen', 'kimi', 'glm', 'minimax', 'other']);
const MAX_BODY = 64 * 1024 * 1024;
const CLIENT_ID = `cavwic-presales-solution-tool/${require('../../package.json').version}`;

function selectedSubscriptionProvider(settings) {
  const value = settings?.subscriptionProvider ?? 'codex';
  if (!PROVIDERS.has(value)) throw fail('SUBSCRIPTION_PROVIDER_INVALID', '套餐接入方式无效 / Select a supported plan connection');
  return value;
}
function subscriptionTarget(settings = {}, purpose = 'chat') {
  const provider = selectedSubscriptionProvider(settings);
  if (provider === 'codex') return { provider };
  const protocol = settings.subscriptionProtocol || 'openai';
  const vendor = settings.subscriptionVendor || (provider === 'minimax' ? 'minimax' : 'other');
  if (!PROTOCOLS.has(protocol) || !VENDORS.has(vendor)) throw fail('SUBSCRIPTION_PROTOCOL_INVALID', '套餐接口协议或厂商无效 / Select a supported protocol and vendor');
  if (provider === 'minimax' && protocol === 'gemini') throw fail('SUBSCRIPTION_PROTOCOL_INVALID', 'MiniMax 套餐支持 OpenAI 或 Anthropic 协议 / MiniMax plans support OpenAI or Anthropic format');
  const raw = settings.subscriptionEndpoint;
  if (typeof raw !== 'string' || !raw.trim()) throw fail('MODEL_CONFIG_REQUIRED', '请填写套餐接口地址 / Enter the plan API endpoint');
  const endpoint = validateEndpoint(raw.trim());
  const hostname = endpoint.hostname.toLowerCase();
  if ([...endpoint.searchParams.keys()].some(key => /^(?:key|api[_-]?key|access[_-]?token|token|authorization)$/i.test(key))) throw fail('SUBSCRIPTION_ENDPOINT_INVALID', '请在密钥框填写密钥，不要放在网址中 / Enter the key in the key field, not in the URL');
  // A plan adapter must never disguise this app as a supported coding agent or scrape a web membership.
  if ((/(?:^|\.)dashscope\.aliyuncs\.com$/.test(hostname) && /coding/.test(hostname))
    || (/^(?:api\.kimi\.(?:com|ai))$/.test(hostname) && /^\/coding(?:\/|$)/.test(endpoint.pathname))
    || (hostname === 'open.bigmodel.cn' && /^\/api\/coding(?:\/|$)/.test(endpoint.pathname))) {
    throw fail('SUBSCRIPTION_ENDPOINT_UNSUPPORTED', '该编程套餐限制自建工具接入，请使用厂商标准 API / This coding plan restricts custom apps. Use the provider’s standard API');
  }
  if (provider === 'minimax' && !['api.minimax.cn', 'api.minimax.io', 'api.minimaxi.com'].includes(hostname)) throw fail('SUBSCRIPTION_ENDPOINT_INVALID', 'MiniMax 套餐请使用官方接口域名 / Use an official MiniMax API domain');
  const model = typeof settings.subscriptionModel === 'string' ? settings.subscriptionModel.trim() : '';
  if (purpose === 'chat' && (!model || model.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model))) throw fail('MODEL_NAME_INVALID', '请填写完整套餐模型 ID / Enter the exact plan model ID');
  let pathname = endpoint.pathname.replace(/\/+$/, '');
  if (protocol === 'openai') {
    if (!/\/chat\/completions$/.test(pathname)) pathname += pathname ? '/chat/completions' : '/v1/chat/completions';
  } else if (protocol === 'anthropic') {
    if (!/\/messages$/.test(pathname)) pathname += /\/v\d+(?:beta\d*)?$/.test(pathname) ? '/messages' : '/v1/messages';
  } else {
    const safeModel = model.replace(/^models\//, '');
    if (/\/models\/[^/]+:generateContent$/.test(pathname)) pathname = pathname.replace(/\/models\/[^/]+:generateContent$/, `/models/${encodeURIComponent(safeModel)}:generateContent`);
    else pathname = `${pathname || '/v1beta'}${/\/models$/.test(pathname) ? '' : '/models'}/${encodeURIComponent(safeModel)}:generateContent`;
  }
  endpoint.pathname = pathname;
  return { provider, protocol, vendor, model, endpoint: endpoint.href };
}
function subscriptionKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 16384 || /[\r\n]/.test(value)) throw fail('SUBSCRIPTION_KEY_REQUIRED', '请填写厂商提供的套餐接口密钥 / Enter the plan API key supplied by the provider');
  validateAuthorization(value);
  return value.trim();
}
function imageParts(images) {
  if (!Array.isArray(images) || images.length > 10) throw fail('MODEL_INPUT_INVALID', '图像内容无效 / Invalid image content');
  return images.map(value => {
    const match = typeof value === 'string' && /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(value);
    if (!match || Buffer.byteLength(match[2], 'base64') > 10 * 1024 * 1024) throw fail('MODEL_INPUT_INVALID', '单张图片必须不超过 10 MB / Each image must be at most 10 MB');
    return { url: value, mimeType: match[1].replace('image/jpg', 'image/jpeg'), data: match[2] };
  });
}
function buildSubscriptionRequest({ settings, subscriptionApiKey = '', messages, images = [] } = {}) {
  const target = subscriptionTarget(settings);
  if (target.provider === 'codex') throw fail('SUBSCRIPTION_PROTOCOL_INVALID', 'Codex 使用现有客户端连接 / Codex uses its existing client connection');
  const key = subscriptionKey(subscriptionApiKey);
  if (!Array.isArray(messages) || !messages.length || messages.some(row => !row || !['system', 'user', 'assistant'].includes(row.role) || typeof row.content !== 'string')) throw fail('MODEL_INPUT_INVALID', '套餐消息格式无效 / Invalid plan messages');
  const pictures = imageParts(images);
  const system = messages.filter(row => row.role === 'system').map(row => row.content).join('\n\n');
  const ordinary = messages.filter(row => row.role !== 'system').map(row => ({ role: row.role, content: row.content }));
  if (!ordinary.length || ordinary.at(-1).role !== 'user') throw fail('MODEL_INPUT_INVALID', '套餐请求需要用户内容 / A user message is required');
  const headers = { 'Content-Type': 'application/json' };
  if (target.protocol === 'gemini' || new URL(target.endpoint).hostname === 'generativelanguage.googleapis.com') headers['x-goog-api-client'] = CLIENT_ID;
  let payload;
  if (target.protocol === 'openai') {
    const outgoing = messages.map(row => ({ ...row }));
    if (pictures.length) outgoing.at(-1).content = [{ type: 'text', text: outgoing.at(-1).content }, ...pictures.map(image => ({ type: 'image_url', image_url: { url: image.url } }))];
    headers.Authorization = `Bearer ${key}`;
    payload = { model: target.model, messages: outgoing, stream: false, ...(target.provider === 'minimax' ? { reasoning_split: true } : {}) };
  } else if (target.protocol === 'anthropic') {
    if (pictures.length) ordinary.at(-1).content = [{ type: 'text', text: ordinary.at(-1).content }, ...pictures.map(image => ({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } }))];
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    payload = { model: target.model, system, messages: ordinary, max_tokens: 8192, stream: false };
  } else {
    headers['x-goog-api-key'] = key;
    const contents = ordinary.map(row => ({ role: row.role === 'assistant' ? 'model' : 'user', parts: [{ text: row.content }] }));
    contents.at(-1).parts.push(...pictures.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } })));
    payload = { systemInstruction: { parts: [{ text: system }] }, contents };
  }
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX_BODY) throw fail('MODEL_INPUT_INVALID', '套餐请求内容过大 / The plan request is too large');
  return { ...target, headers, body };
}
async function requestSubscriptionHttp(input, { fetchImpl = fetch } = {}) {
  const endpoint = validateEndpoint(input.endpoint);
  const response = await fetchImpl(endpoint, { method: 'POST', headers: input.headers, body: input.body, redirect: 'error', signal: AbortSignal.timeout(300000) });
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > 32 * 1024 * 1024) throw fail('MODEL_RESPONSE_INVALID', '套餐回复过大 / The plan response is too large');
    chunks.push(Buffer.from(chunk));
  }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
}
function readSubscriptionResponse(response, target) {
  if (!response || response.status < 200 || response.status >= 300) throw fail('SUBSCRIPTION_REQUEST_FAILED', `套餐接口返回 ${response?.status || '错误'} / Plan endpoint returned ${response?.status || 'an error'}`);
  let payload;
  try { payload = JSON.parse(response.body); } catch { throw fail('MODEL_RESPONSE_INVALID', '套餐接口未返回有效 JSON / Invalid plan response'); }
  if (!payload || typeof payload !== 'object' || payload.error || (payload.base_resp?.status_code && payload.base_resp.status_code !== 0)) throw fail('SUBSCRIPTION_REQUEST_FAILED', '套餐服务报告错误 / The plan service reported an error');
  let content, actual;
  if (target.protocol === 'openai') {
    const choice = payload.choices?.[0];
    if (!choice || (choice.finish_reason != null && choice.finish_reason !== 'stop') || choice.message?.tool_calls?.length || choice.message?.function_call) throw fail('MODEL_RESPONSE_INVALID', '套餐生成未完成或请求了工具 / The plan did not complete a text response');
    content = choice.message?.content;
    if (typeof content === 'string') content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (typeof content === 'string' && /<\/?think>/.test(content)) throw fail('MODEL_RESPONSE_INVALID', '套餐正文未完整返回 / The plan returned incomplete text');
    actual = payload.model;
  } else if (target.protocol === 'anthropic') {
    if (!['end_turn', 'stop_sequence'].includes(payload.stop_reason) || !Array.isArray(payload.content) || payload.content.some(part => part?.type === 'tool_use')) throw fail('MODEL_RESPONSE_INVALID', '套餐生成未完成或请求了工具 / The plan did not complete a text response');
    content = payload.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
    actual = payload.model;
  } else {
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts) || candidate.content.parts.some(part => part.functionCall || part.executableCode)) throw fail('MODEL_RESPONSE_INVALID', '套餐生成未完成或内容被拦截 / The plan did not complete a text response');
    content = candidate.content.parts.filter(part => part.thought !== true && typeof part.text === 'string').map(part => part.text).join('\n');
    actual = payload.modelVersion;
  }
  if (typeof content !== 'string' || !content.trim()) throw fail('MODEL_RESPONSE_EMPTY', '套餐未返回有效正文 / The plan returned no text');
  // Standard API aliases can resolve to a dated model ID. Keep that returned identity visible.
  if (actual != null && (typeof actual !== 'string' || !actual.trim() || actual.trim().length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(actual.trim()))) throw fail('MODEL_RESPONSE_INVALID', '套餐接口返回的模型标识无效 / The endpoint returned an invalid model ID');
  return { content: content.trim(), model: actual == null ? target.model : actual.trim() };
}
async function chatSubscriptionHttp(input, { request = requestSubscriptionHttp } = {}) {
  const target = buildSubscriptionRequest(input);
  let response;
  try { response = await request(target); }
  catch (error) { if (error?.code === 'MODEL_RESPONSE_INVALID') throw error; throw fail('SUBSCRIPTION_CONNECTION_FAILED', '套餐接口连接失败，请检查地址和网络 / Could not connect to the plan endpoint. Check its URL and network'); }
  return readSubscriptionResponse(response, target);
}

module.exports = { selectedSubscriptionProvider, subscriptionTarget, buildSubscriptionRequest, requestSubscriptionHttp, readSubscriptionResponse, chatSubscriptionHttp };
