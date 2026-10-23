'use strict';
const {failure, codexError} = require('./errors.cjs');
class SubscriptionTurn {
  constructor({threadId, model, timeout = 600000, idleTimeout = 120000, done = () => {}, interrupt = () => {}}) {
    Object.assign(this, {threadId, model, timeout, done, interrupt});
    this.idleTimeout = idleTimeout;
    this.content = ''; this.final = '';
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.promise.catch(() => {});
    this.timer = setTimeout(() => this.stop(failure('套餐生成超时，请换模型或重试', 'MODEL_TIMEOUT')), timeout);
    this.activity();
  }
  activity() {
    if (this.finished) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(failure('套餐生成长时间没有进度，请检查连接后重试', 'MODEL_IDLE_TIMEOUT')), this.idleTimeout);
  }
  identify(turnId) {
    if (!turnId) return true;
    if (this.turnId && this.turnId !== turnId) return false;
    this.turnId = turnId;
    if (this.finished && this.cancelled) this.interrupt(this.threadId, this.turnId);
    return true;
  }
  started(turnId) {
    if (!turnId) return this.stop(failure('Codex 未返回生成任务标识', 'CODEX_PROTOCOL_INVALID'));
    if (!this.identify(turnId)) return this.stop(failure('Codex 返回的生成任务不匹配', 'CODEX_TURN_MISMATCH'));
    this.activity();
  }
  receive(method, params) {
    if (this.finished) return;
    const id = params.turnId || params.turn?.id;
    if (!this.identify(id)) return;
    if (method === 'turn/started') { this.started(params.turn?.id); return; }
    if (method === 'error') {
      if (params.willRetry === true) { this.activity(); return; }
      return this.stop(codexError(params.error));
    }
    if (method.startsWith('item/') || method === 'thread/tokenUsage/updated') {
      this.activity();
      if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') this.content += params.delta;
      if (method === 'item/completed' && params.item?.type === 'agentMessage' && typeof params.item.text === 'string') this.final = params.item.text;
    }
    if (method !== 'turn/completed') return;
    if (params.turn?.status === 'interrupted') return this.finish(failure('套餐生成已中断，请重试', 'MODEL_INTERRUPTED'));
    if (params.turn?.status !== 'completed') return this.finish(codexError(params.turn?.error));
    const content = this.final || this.content;
    if (!content.trim()) return this.finish(failure('套餐返回空内容，请重试', 'MODEL_EMPTY'));
    this.finish(null, {content, provider:'codex', model:this.model});
  }
  stop(error) {
    if (this.finished) return;
    this.cancelled = true; this.finish(error);
    if (this.turnId) this.interrupt(this.threadId, this.turnId);
  }
  finish(error, value) {
    if (this.finished) return;
    this.finished = true; clearTimeout(this.timer); clearTimeout(this.idleTimer); this.done();
    error ? this.reject(error) : this.resolve(value);
  }
}
module.exports = {SubscriptionTurn};
