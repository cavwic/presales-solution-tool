'use strict';

const MAX_TEXT_LENGTH = 1024 * 1024;
const textValue = value => typeof value === 'string' && value.length <= MAX_TEXT_LENGTH && value.trim() ? value : '';

// Text reaches the clipboard only after the user chooses a native menu item.
function createTextMenuTemplate(input, { clipboard, locale = 'zh' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const english = locale === 'en';
  const text = input.password === true ? '' : textValue(input.text);
  const hint = textValue(input.hint);
  const placeholder = textValue(input.placeholder);
  const selected = input.password !== true && input.selected === true;
  const editable = input.editable === true;
  const writable = editable && input.readOnly !== true;
  const menu = [];
  const copy = (label, value) => ({ label, click: () => clipboard.writeText(value) });

  if (editable) {
    if (writable) menu.push({ label: english ? 'Cut' : '剪切', role: 'cut', enabled: selected });
    menu.push({ label: english ? 'Copy' : '复制', role: 'copy', enabled: selected });
    if (writable) menu.push({ label: english ? 'Paste' : '粘贴', role: 'paste' });
    menu.push({ type: 'separator' }, { label: english ? 'Select all' : '全选', role: 'selectAll' });
    if (text) menu.push({ type: 'separator' }, copy(english ? 'Copy all text' : '复制全部文字', text));
  } else if (text) {
    menu.push(copy(english ? (selected ? 'Copy selected text' : 'Copy text') : (selected ? '复制选中文字' : '复制文字'), text));
  }
  if (hint && hint !== text) {
    if (menu.length) menu.push({ type: 'separator' });
    menu.push(copy(english ? 'Copy tooltip' : '复制提示文字', hint));
  }
  if (placeholder && placeholder !== hint && placeholder !== text) {
    if (menu.length) menu.push({ type: 'separator' });
    menu.push(copy(english ? 'Copy placeholder' : '复制输入提示', placeholder));
  }
  return menu;
}

module.exports = { createTextMenuTemplate };
