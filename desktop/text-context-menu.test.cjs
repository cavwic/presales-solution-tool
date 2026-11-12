'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTextMenuTemplate } = require('./text-context-menu.cjs');

const context = locale => {
  const writes = [];
  return { writes, options: { locale, clipboard: { writeText: value => writes.push(value) } } };
};

test('visible button text and a distinct tooltip copy only after explicit menu selection', () => {
  const { writes, options } = context('zh');
  const menu = createTextMenuTemplate({ text: '新建项目', hint: '开始一个新项目' }, options);
  assert.deepEqual(menu.filter(item => item.label).map(item => item.label), ['复制文字', '复制提示文字']);
  assert.deepEqual(writes, []);
  menu[0].click();
  menu[2].click();
  assert.deepEqual(writes, ['新建项目', '开始一个新项目']);
});

test('editable text retains editing roles and can copy all visible text', () => {
  const { writes, options } = context('en');
  const menu = createTextMenuTemplate({ text: 'Project scope', editable: true, selected: true }, options);
  assert.deepEqual(menu.filter(item => item.role).map(item => [item.role, item.enabled]), [['cut', true], ['copy', true], ['paste', undefined], ['selectAll', undefined]]);
  assert.equal(menu.at(-1).label, 'Copy all text');
  assert.deepEqual(writes, []);
  menu.at(-1).click();
  assert.deepEqual(writes, ['Project scope']);
});

test('masked fields never expose supplied values or enable cut or copy', () => {
  const { writes, options } = context('zh');
  const menu = createTextMenuTemplate({ text: 'not-visible-secret', password: true, editable: true, selected: true, hint: 'API 密钥' }, options);
  assert.deepEqual(menu.filter(item => ['cut', 'copy'].includes(item.role)).map(item => item.enabled), [false, false]);
  assert.equal(menu.some(item => item.label === '复制全部文字'), false);
  menu.find(item => item.click).click();
  assert.deepEqual(writes, ['API 密钥']);
});

test('read-only fields omit mutation commands and retain copy', () => {
  const { options } = context('en');
  const menu = createTextMenuTemplate({ text: 'Generated file', editable: true, readOnly: true, selected: true }, options);
  assert.equal(menu.some(item => item.role === 'cut' || item.role === 'paste'), false);
  assert.equal(menu.find(item => item.role === 'copy').enabled, true);
});

test('copy preserves meaningful indentation and line breaks', () => {
  const { options, writes } = context('en');
  const text = '  first line\n    second line\n';
  createTextMenuTemplate({ text }, options)[0].click();
  assert.deepEqual(writes, [text]);
});

test('empty fields can copy their visible placeholder separately from a tooltip', () => {
  const { options, writes } = context('zh');
  const menu = createTextMenuTemplate({ text: '', editable: true, hint: '模型服务地址', placeholder: 'http://127.0.0.1:11434' }, options);
  assert.equal(menu.at(-1).label, '复制输入提示');
  menu.at(-1).click();
  assert.deepEqual(writes, ['http://127.0.0.1:11434']);
});

test('invalid and oversized payloads cannot create a clipboard write item', () => {
  const { options, writes } = context('en');
  for (const input of [null, [], 'text', { text: {} }, { text: 'a'.repeat(1024 * 1024 + 1) }]) assert.deepEqual(createTextMenuTemplate(input, options), []);
  assert.deepEqual(writes, []);
});

function captureTemporalMenu(value, visibleText) {
  let listener, payload;
  class Element {
    getAttribute() { return null; }
  }
  class HTMLInputElement extends Element {
    constructor() { super(); this.type = 'date'; this.value = value; this.placeholder = ''; this.selectionStart = null; this.selectionEnd = null; }
    closest(selector) {
      if (selector === 'input, textarea, select, [contenteditable="true"]') return this;
      if (selector === '.localized-temporal-input') return { querySelector: () => ({ innerText: visibleText }) };
      return null;
    }
  }
  const electron = {
    contextBridge: { exposeInMainWorld() {} },
    ipcRenderer: { invoke(channel, input) { assert.equal(channel, 'bid:text-menu'); payload = input; return Promise.resolve(); } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return electron; },
    document: { addEventListener(name, callback) { assert.equal(name, 'contextmenu'); listener = callback; } },
    window: { getSelection: () => '' },
    Element, HTMLInputElement, HTMLTextAreaElement: class extends Element {}, HTMLSelectElement: class extends Element {},
  });
  listener({ isTrusted: true, target: new HTMLInputElement(), preventDefault() {} });
  return payload;
}

test('localized temporal prompt is copied from its rendered span when the hidden input is empty', () => {
  const payload = captureTemporalMenu('', '年 / 月 / 日');
  assert.equal(payload.text, '');
  assert.equal(payload.placeholder, '年 / 月 / 日');
  assert.equal(payload.editable, true);
  assert.equal(payload.password, false);
});

test('localized temporal values copy their displayed format rather than the hidden ISO input', () => {
  const payload = captureTemporalMenu('2026-11-05', '2026 / 11 / 05');
  assert.equal(payload.text, '2026 / 11 / 05');
  assert.equal(payload.placeholder, '');
});
