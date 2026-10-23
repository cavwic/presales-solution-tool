'use strict';

const assert = require('node:assert/strict');

// This function is passed directly to page.evaluate and has no Node closures.
function collectWorkbenchLayout() {
  const header = document.querySelector('.lab-header');
  const brand = header?.querySelector('.lab-brand');
  const models = header?.querySelector('.model-provider-strip');
  const actions = document.querySelector('.workspace-toolbar');
  const heading = document.querySelector('.project-header h1');
  const windowControls = document.getElementById('global-window-controls');
  const undo = document.getElementById('global-history-undo');
  const redo = document.getElementById('global-history-redo');
  const skills = header?.querySelector('[data-testid="import-skills"]');
  const expandModels = header?.querySelector('.model-expand-toggle');
  const expected = { header, brand, models, actions, heading, windowControls, undo, redo, skills, expandModels };
  const missing = Object.entries(expected).filter(([, element]) => !element).map(([name]) => name);
  if (missing.length) return { missing };
  const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, centerY: r.y + r.height / 2 }; };
  const visible = element => element.getClientRects().length && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
  const control = element => {
    const r = rect(element), hit = document.elementFromPoint(r.left + r.width / 2, r.centerY);
    return { ...r, id: element.id, label: element.getAttribute('aria-label') || element.textContent.trim(), row: models.contains(element) ? 2 : 1, inside: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) };
  };
  const summary = models.querySelector('.model-current-summary');
  return {
    missing, width: innerWidth, height: innerHeight, rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
    clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    header: rect(header), brand: rect(brand), models: rect(models), heading: rect(heading), windowControls: rect(windowControls), undo: rect(undo), redo: rect(redo),
    historyCounts: { undo: document.querySelectorAll('#global-history-undo').length, redo: document.querySelectorAll('#global-history-redo').length },
    historyInHeader: header.contains(undo) && header.contains(redo),
    historyAfterBrand: Boolean(brand.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(undo.compareDocumentPosition(redo) & Node.DOCUMENT_POSITION_FOLLOWING),
    actionsInHeader: header.contains(actions), actionsInMain: Boolean(actions.closest('main')),
    actionCount: actions.querySelectorAll('button').length, actions: { ...rect(actions), buttons: [...actions.querySelectorAll('button')].filter(visible).map(control) },
    titleChildren: [...heading.parentElement.children].map(element => element.tagName.toLowerCase()), subtitleCount: heading.parentElement.querySelectorAll(':scope > span').length,
    windowIds: [...windowControls.querySelectorAll('button')].filter(visible).map(element => element.id),
    modes: models.querySelectorAll('[role="radio"]').length, summaryInModels: Boolean(summary), summaryVisible: Boolean(summary && visible(summary)),
    skillsCount: document.querySelectorAll('[data-testid="import-skills"]').length, skills: rect(skills), expandModels: rect(expandModels), skillsInModelRow: models.contains(skills),
    controls: [...header.querySelectorAll('button')].filter(visible).map(control),
  };
}

function assertWorkbenchLayout(layout, name = 'workbench') {
  assert.deepEqual(layout.missing, [], name + ': missing expected layout elements');
  assert.deepEqual(layout.historyCounts, { undo: 1, redo: 1 }, name + ': undo and redo must each exist exactly once');
  assert.equal(layout.historyInHeader, true, name + ': history controls left the native topbar');
  assert.equal(layout.historyAfterBrand, true, name + ': history DOM order should follow the brand');
  assert.ok(layout.undo.left >= layout.brand.right - 1, name + ': undo is not right of the brand');
  assert.ok(layout.undo.left - layout.brand.right <= layout.rootFont * 3, name + ': history controls are too far from the brand');
  assert.ok(layout.redo.left >= layout.undo.right - 1 && layout.redo.left - layout.undo.right <= layout.rootFont, name + ': redo must immediately follow undo');
  for (const history of [layout.undo, layout.redo]) assert.ok(Math.abs(history.centerY - layout.brand.centerY) <= Math.max(5, layout.brand.height * .3), name + ': history is not in the brand row');
  assert.deepEqual(layout.windowIds, ['global-locale-toggle', 'global-theme-toggle', 'window-minimize', 'window-maximize', 'window-close'], name + ': right window controls are not in the required order');
  assert.ok(layout.windowControls.left > layout.redo.right - 1, name + ': right window controls overlap the history group');
  assert.ok(layout.header.right - layout.windowControls.right <= layout.rootFont * 1.5, name + ': window controls are not right aligned');
  assert.ok(Math.abs(layout.windowControls.centerY - layout.brand.centerY) <= Math.max(5, layout.brand.height * .3), name + ': window controls left the first row');
  const expectedFirstRow = ['global-history-undo', 'global-history-redo', 'global-locale-toggle', 'global-theme-toggle', 'window-minimize', 'window-maximize', 'window-close'];
  assert.deepEqual(layout.controls.filter(control => control.row === 1).map(control => control.id).sort(), expectedFirstRow.sort(), name + ': first topbar row contains unexpected or duplicate controls');
  const firstRowBottom = Math.max(layout.brand.bottom, layout.undo.bottom, layout.redo.bottom, layout.windowControls.bottom);
  assert.ok(layout.models.top >= firstRowBottom - 1, name + ': model controls must occupy a separate second row');
  assert.ok(layout.models.bottom <= layout.header.bottom + 1, name + ': model row escapes the topbar');
  const secondRowControls = layout.controls.filter(control => control.row === 2);
  assert.ok(secondRowControls.every(control => control.top >= layout.models.top - 1 && control.bottom <= layout.models.bottom + 1), name + ': a model control wrapped into a third topbar row');
  assert.ok(secondRowControls.length >= 6, name + ': second row lost model modes, the settings toggle, or Skills');
  assert.equal(layout.skillsCount, 1, name + ': Skills button must exist exactly once');
  assert.equal(layout.skillsInModelRow, true, name + ': Skills button left the model row');
  assert.ok(layout.skills.left >= layout.expandModels.right - 1, name + ': Skills button must follow the model settings toggle');
  assert.equal(layout.modes, 4, name + ': all four model modes must remain available');
  assert.equal(layout.summaryInModels, true, name + ': model summary is missing');
  if (layout.width >= 900) assert.equal(layout.summaryVisible, true, name + ': model summary must be visible on a wide window');
  assert.equal(layout.actionsInHeader, false, name + ': project controls remain in the native topbar');
  assert.equal(layout.actionsInMain, true, name + ': project controls are not in the main page');
  assert.equal(layout.actionCount, 3, name + ': main project actions should contain three buttons');
  assert.deepEqual(layout.titleChildren, ['h1', 'nav'], name + ': removed project subtitle left text or an empty container');
  assert.equal(layout.subtitleCount, 0, name + ': project-name subtitle remains');
  assert.equal(layout.actions.buttons.length, 3, name + ': a project action is hidden');
  assert.ok(layout.actions.top >= layout.heading.bottom - 1, name + ': project controls are not below the page title');
  assert.ok(layout.actions.top - layout.heading.bottom <= layout.rootFont * 1.5, name + ': removed project subtitle still reserves vertical space');
  for (let index = 1; index < layout.actions.buttons.length; index++) {
    const before = layout.actions.buttons[index - 1], current = layout.actions.buttons[index];
    assert.ok(current.left >= before.right - 1 || current.top >= before.bottom - 1, name + ': project buttons overlap or changed order');
  }
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, name + ': horizontal page overflow');
  for (const button of layout.controls) { assert.equal(button.inside, true, name + ': topbar control outside viewport: ' + button.label); assert.equal(button.hit, true, name + ': topbar control covered: ' + button.label); }
}

module.exports = { collectWorkbenchLayout, assertWorkbenchLayout };
