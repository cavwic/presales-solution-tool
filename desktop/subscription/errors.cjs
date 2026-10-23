'use strict';
function failure(message, code = 'MODEL_FAILED') { return Object.assign(new Error(message), {code}); }
function codexError(error, code = 'MODEL_FAILED') {
  // Provider messages may contain prompts or response bodies. Expose classifications only.
  const text = [error?.message, error?.additionalDetails].filter(value => typeof value === 'string').join(' ');
  const metadata = error?.codexErrorInfo ?? error?.data?.codexErrorInfo;
  const type = typeof metadata === 'string' ? metadata : metadata && typeof metadata === 'object' ? Object.keys(metadata)[0] : '';
  if (/failed to load workspace requirements/i.test(text)) return failure('Codex 无法加载工作区配置，请在 Codex 中检查登录和工作区状态后重试', 'CODEX_REQUIREMENTS_UNAVAILABLE');
  if (['usageLimitExceeded','rateLimitExceeded','sessionBudgetExceeded'].includes(type) || /usage limit|rate limit|quota exceeded/i.test(text)) return failure('Codex 套餐用量或速率受限，请在 Codex 中查看用量后重试', 'CODEX_USAGE_LIMIT');
  if (type === 'contextWindowExceeded') return failure('资料超过模型上下文限制，请减少资料后重试', 'MODEL_CONTEXT_LIMIT');
  if (type === 'unauthorized' || /unauthorized|authentication|not logged in|login required/i.test(text)) return failure('请先在 Codex 中登录 ChatGPT 套餐，然后重新读取模型', 'CODEX_LOGIN_REQUIRED');
  return failure('Codex 套餐请求未完成，请检查客户端连接后重试', code);
}
module.exports = {failure, codexError};
