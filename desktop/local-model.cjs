'use strict';
const { requestModel, requestCatalog, validateEndpoint, validateAuthorization } = require('./model.cjs');
const RUNTIMES = new Set(['ollama', 'lmstudio', 'openai']);
const failure = (code, message) => Object.assign(new Error(message), { code });

function localEndpoint(settings, purpose = 'chat') {
  const runtime = settings?.localRuntime ?? 'openai';
  if (!RUNTIMES.has(runtime)) throw failure('MODEL_SETTINGS_INVALID', '本地模型工具无效 / Select a supported local model server');
  const value = settings?.localEndpoint;
  if (typeof value !== 'string' || !value.trim()) throw failure('MODEL_CONFIG_REQUIRED', '请填写本地服务地址 / Enter a local server URL');
  const endpoint = validateEndpoint(value.trim());
  let path = endpoint.pathname.replace(/\/+$/, '');
  if (runtime === 'ollama') {
    if (/\/v1(?:\/(?:chat\/completions|models))?$/.test(path)) path = path.replace(/\/v1(?:\/(?:chat\/completions|models))?$/, '');
    else path = path.replace(/\/api\/(?:chat|tags)$/, '').replace(/\/api$/, '');
    endpoint.pathname = `${path}/api/${purpose === 'catalog' ? 'tags' : 'chat'}`;
  } else {
    if (/\/chat\/completions$/.test(path)) path = path.replace(/\/chat\/completions$/, '');
    else if (/\/models$/.test(path)) path = path.replace(/\/models$/, '');
    else if (!/\/v1$/.test(path)) path += '/v1';
    endpoint.pathname = `${path}/${purpose === 'catalog' ? 'models' : 'chat/completions'}`;
  }
  return { runtime, endpoint: endpoint.href };
}

function localAuthorization(localApiKey = '') {
  if (typeof localApiKey !== 'string' || localApiKey.length > 16384) throw failure('MODEL_INPUT_INVALID', '本地服务令牌无效 / Invalid local server token');
  const authorization = localApiKey.trim() ? `Bearer ${localApiKey.trim()}` : '';
  validateAuthorization(authorization);
  return authorization;
}

function responseJson(response) {
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw failure('MODEL_REQUEST_FAILED', `本地模型接口返回 ${response?.status ?? '错误'} / Local model endpoint returned ${response?.status ?? 'an error'}`);
  let payload;
  try { payload = JSON.parse(response.body); } catch { throw failure('MODEL_RESPONSE_INVALID', '本地模型接口未返回有效 JSON / Invalid local model response'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('MODEL_RESPONSE_INVALID', '本地模型接口返回格式无效 / Invalid local model response format');
  if (payload.error) throw failure('MODEL_REQUEST_FAILED', '本地模型服务报告错误 / The local model server reported an error');
  return payload;
}

async function chatLocal({ settings, localApiKey = '', messages, images = [], temperature = 0.2 }, { request = requestModel } = {}) {
  const target = localEndpoint(settings);
  const model = settings?.localModel;
  if (typeof model !== 'string' || !model.trim()) throw failure('MODEL_CONFIG_REQUIRED', '请选择或填写本地模型名称 / Select or enter a local model name');
  if (!Array.isArray(messages) || !messages.length || messages.some(message => !message || typeof message.content !== 'string')) throw failure('MODEL_INPUT_INVALID', '本地模型消息无效 / Invalid local model messages');
  if (!Array.isArray(images) || images.some(value => typeof value !== 'string' || !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value))) throw failure('MODEL_INPUT_INVALID', '图像内容无效 / Invalid image content');
  const outgoing = messages.map(message => ({ ...message }));
  const last = outgoing[outgoing.length - 1];
  let body;
  if (target.runtime === 'ollama') {
    if (images.length) last.images = images.map(value => value.slice(value.indexOf(',') + 1));
    body = { model: model.trim(), messages: outgoing, options: { temperature }, think: false, stream: false };
  } else {
    if (images.length) last.content = [{ type: 'text', text: last.content }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))];
    body = { model: model.trim(), messages: outgoing, temperature, stream: false };
  }
  const payload = responseJson(await request({ endpoint: target.endpoint, authorization: localAuthorization(localApiKey), body: JSON.stringify(body) }));
  if (target.runtime === 'ollama' && payload.done !== true) throw failure('MODEL_RESPONSE_INVALID', '本地模型未完成生成 / The local model did not complete generation');
  const content = target.runtime === 'ollama' ? payload.message?.content : payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw failure('MODEL_RESPONSE_EMPTY', '本地模型未返回有效正文 / The local model returned no content');
  const resolvedModel = typeof payload.model === 'string' && payload.model.trim() && payload.model.length <= 512 ? payload.model.trim() : model.trim();
  return { content: content.trim(), model: resolvedModel };
}

async function localCatalog({ settings, localApiKey = '' } = {}, { request = requestCatalog } = {}) {
  const target = localEndpoint(settings, 'catalog');
  const payload = responseJson(await request({ endpoint: target.endpoint, authorization: localAuthorization(localApiKey) }));
  const list = target.runtime === 'ollama' ? payload.models : payload.data;
  if (!Array.isArray(list)) throw failure('MODEL_RESPONSE_INVALID', '本地模型列表格式无效 / Invalid local model list');
  const seen = new Set();
  const models = [];
  for (const entry of list) {
    const model = target.runtime === 'ollama' ? entry?.model || entry?.name : entry?.id;
    if (typeof model !== 'string' || !model.trim() || model.length > 512 || seen.has(model.trim())) continue;
    seen.add(model.trim());
    models.push({ model: model.trim(), displayName: model.trim() });
  }
  return { models, ...target };
}

module.exports = { localEndpoint, chatLocal, localCatalog };
