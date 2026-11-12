'use strict';

const assert = require('node:assert/strict');

// This function is passed directly to page.evaluate and has no Node closures.
function collectWorkbenchLayout() {
  const header = document.querySelector('.lab-header');
  const brand = header?.querySelector('.lab-brand');
  const models = header?.querySelector('.model-provider-strip');
  const actions = document.querySelector('.workspace-toolbar');
  const heading = document.querySelector('.linear-document-title');
  const app = document.querySelector('.linear-app');
  const workspace = document.querySelector('.linear-workspace');
  const sidebar = document.querySelector('.linear-sidebar');
  const sidebarHeading = document.querySelector('.linear-sidebar-heading');
  const sidebarScroll = document.querySelector('.linear-sidebar-scroll');
  const mainShell = document.querySelector('.linear-main-shell');
  const contentScroll = document.querySelector('.linear-content-scroll');
  const documentPane = document.querySelector('.linear-document');
  const inspector = document.querySelector('.linear-inspector');
  const windowControls = document.getElementById('global-window-controls');
  const undo = document.getElementById('global-history-undo');
  const redo = document.getElementById('global-history-redo');
  const skills = header?.querySelector('[data-testid="import-skills"]');
  const expandModels = header?.querySelector('.model-expand-toggle');
  const expected = { header, brand, models, actions, heading, app, workspace, sidebar, sidebarHeading, sidebarScroll, mainShell, contentScroll, documentPane, inspector, windowControls, undo, redo, skills, expandModels };
  const missing = Object.entries(expected).filter(([, element]) => !element).map(([name]) => name);
  if (missing.length) return { missing };
  const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, centerY: r.y + r.height / 2 }; };
  const visible = element => element.getClientRects().length && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden';
  const control = element => {
    const r = rect(element), hit = document.elementFromPoint(r.left + r.width / 2, r.centerY);
    return { ...r, id: element.id, label: element.getAttribute('aria-label') || element.textContent.trim(), row: models.contains(element) ? 2 : 1, inside: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) };
  };
  const summary = models.querySelector('.model-current-summary');
  const modelPanel = document.querySelector('.model-controls');
  const frames = [document.documentElement, document.body, document.querySelector('body > main'), app, workspace, mainShell, sidebar].map(element => {
    const style = getComputedStyle(element);
    return { name: element.className || element.tagName, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft, overflowX: style.overflowX, overflowY: style.overflowY, ...rect(element) };
  });
  const projectSwitcher = sidebar.querySelector('.linear-project-switcher');
  const avatar = sidebar.querySelector('.linear-workspace-avatar');
  const search = sidebar.querySelector('.linear-material-search');
  return {
    missing, width: innerWidth, height: innerHeight, rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
    clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    header: rect(header), brand: rect(brand), models: rect(models), heading: rect(heading), app: rect(app), workspace: rect(workspace), sidebar: rect(sidebar), sidebarHeading: rect(sidebarHeading), sidebarScroll: rect(sidebarScroll), mainShell: rect(mainShell), contentScroll: rect(contentScroll), documentPane: rect(documentPane), inspector: rect(inspector), windowControls: rect(windowControls), undo: rect(undo), redo: rect(redo), frames,
    paneScrolls: { document: documentPane.scrollTop, content: contentScroll.scrollTop, sidebar: sidebarScroll.scrollTop },
    paneOverflows: { content: getComputedStyle(contentScroll).overflowY, document: getComputedStyle(documentPane).overflowY },
    focusMode: Boolean(innerHeight <= 760 && modelPanel && !modelPanel.hidden), workspaceVisible: Boolean(visible(workspace)),
    modelPanel: modelPanel && !modelPanel.hidden ? { ...rect(modelPanel), overflow: getComputedStyle(modelPanel).overflowY } : null,
    sidebarIdentity: { project: control(projectSwitcher), avatar: rect(avatar), search: search && visible(search) ? rect(search) : null },
    historyCounts: { undo: document.querySelectorAll('#global-history-undo').length, redo: document.querySelectorAll('#global-history-redo').length },
    historyInHeader: header.contains(undo) && header.contains(redo),
    historyAfterBrand: Boolean(brand.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(undo.compareDocumentPosition(redo) & Node.DOCUMENT_POSITION_FOLLOWING),
    design: document.documentElement.dataset.workspaceDesign,
    actionsInHeader: header.contains(actions), actionsInSidebar: sidebar.contains(actions),
    actionCount: actions.querySelectorAll('button').length, actions: { ...rect(actions), buttons: [...actions.querySelectorAll('button')].filter(visible).map(control) },
    headingInDocument: Boolean(heading.closest('.workspace-content')), headingValue: heading.value,
    headingTag: heading.tagName, headingClientHeight: heading.clientHeight, headingScrollHeight: heading.scrollHeight, headingClientWidth: heading.clientWidth, headingScrollWidth: heading.scrollWidth,
    duplicateCommunicationButtons: [...document.querySelectorAll('.linear-view-actions > button')].filter(button => /^(?:新增沟通节点|Add communication)$/.test(button.textContent.trim())).length,
    legacyHeroCount: document.querySelectorAll('.project-header h1').length,
    stageCount: sidebar.querySelectorAll('.linear-stage-nav > button').length,
    activeStageCount: sidebar.querySelectorAll('.linear-stage-nav > button[aria-current="page"]').length,
    propertyCount: inspector.querySelectorAll('.linear-inspector-properties > .field').length,
    metricsInInspector: Boolean(inspector.querySelector('.header-metrics')),
    windowIds: [...windowControls.querySelectorAll('button')].filter(visible).map(element => element.id),
    modes: models.querySelectorAll('[role="radio"]').length, summaryInModels: Boolean(summary), summaryVisible: Boolean(summary && visible(summary)),
    skillsCount: document.querySelectorAll('[data-testid="import-skills"]').length, skills: rect(skills), expandModels: rect(expandModels), skillsInModelRow: models.contains(skills), skillsAfterToggle: Boolean(expandModels.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING),
    controls: [...header.querySelectorAll('button')].filter(visible).map(control),
  };
}

function assertWorkbenchLayout(layout, name = 'workbench') {
  assert.deepEqual(layout.missing, [], name + ': missing expected layout elements');
  assert.equal(layout.design, 'linear', name + ': the selected production design is not active');
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
  assert.ok(secondRowControls.every(control => control.top >= layout.models.top - 1 && control.bottom <= layout.models.bottom + 1), name + ': a model control escapes its responsive model strip');
  assert.ok(secondRowControls.length >= 6, name + ': second row lost model modes, the settings toggle, or Skills');
  assert.equal(layout.skillsCount, 1, name + ': Skills button must exist exactly once');
  assert.equal(layout.skillsInModelRow, true, name + ': Skills button left the model row');
  assert.equal(layout.skillsAfterToggle, true, name + ': Skills must follow the model settings toggle in reading order');
  assert.ok(layout.skills.left >= layout.expandModels.right - 1 || layout.skills.top >= layout.expandModels.bottom - 1, name + ': Skills must follow the settings toggle on the same row or the next responsive row');
  assert.equal(layout.modes, 4, name + ': all four model modes must remain available');
  assert.equal(layout.summaryInModels, true, name + ': model summary is missing');
  if (layout.width >= 900) assert.equal(layout.summaryVisible, true, name + ': model summary must be visible on a wide window');
  for (const frame of layout.frames) {
    assert.equal(frame.scrollTop, 0, name + ': fixed frame scrolled vertically: ' + frame.name);
    assert.equal(frame.scrollLeft, 0, name + ': fixed frame scrolled horizontally: ' + frame.name);
    assert.equal(frame.overflowX, 'clip', name + ': fixed frame allows hidden horizontal scrolling: ' + frame.name);
    assert.equal(frame.overflowY, 'clip', name + ': fixed frame allows hidden vertical scrolling: ' + frame.name);
  }
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, name + ': horizontal page overflow');
  for (const button of layout.controls) { assert.equal(button.inside, true, name + ': topbar control outside viewport: ' + button.label); assert.equal(button.hit, true, name + ': topbar control covered: ' + button.label); }
  if (layout.focusMode) {
    assert.equal(layout.workspaceVisible, false, name + ': short-window model focus mode must hide the workspace instead of cropping it');
    assert.ok(layout.modelPanel && layout.modelPanel.height > 0, name + ': model focus mode lost its settings pane');
    assert.ok(layout.modelPanel.top >= layout.header.bottom - 1 && layout.modelPanel.bottom <= layout.height + 1, name + ': focused model pane escapes its available window area');
    assert.ok(['auto', 'scroll'].includes(layout.modelPanel.overflow), name + ': focused model settings must remain scrollable');
    return;
  }
  assert.equal(layout.workspaceVisible, true, name + ': workbench did not recover after model focus mode closed');
  assert.equal(layout.actionsInHeader, false, name + ': project controls remain in the native topbar');
  assert.equal(layout.actionsInSidebar, true, name + ': project controls left the project sidebar');
  assert.equal(layout.actionCount, 4, name + ': project actions should contain new, settings, history and cleanup buttons');
  assert.equal(layout.headingInDocument, true, name + ': editable project title left the document');
  assert.equal(layout.headingTag, 'TEXTAREA', name + ': the project title must wrap instead of silently truncating long names');
  assert.ok(layout.headingScrollHeight <= layout.headingClientHeight + 1, name + ': project title text is vertically clipped');
  assert.ok(layout.headingScrollWidth <= layout.headingClientWidth + 1, name + ': project title text is horizontally clipped');
  assert.equal(layout.duplicateCommunicationButtons, 0, name + ': duplicate add-communication action remains above the document');
  assert.equal(layout.legacyHeroCount, 0, name + ': the removed large tool-name hero remains');
  assert.equal(layout.stageCount, 5, name + ': one or more lifecycle stages are missing');
  assert.equal(layout.activeStageCount, 1, name + ': the current lifecycle stage is ambiguous');
  assert.equal(layout.propertyCount, 5, name + ': project properties were lost from the inspector');
  assert.equal(layout.metricsInInspector, true, name + ': requirement coverage left the inspector');
  assert.equal(layout.actions.buttons.length, 4, name + ': a project action is hidden');
  if (layout.width > 1000) {
    assert.ok(layout.sidebar.right <= layout.mainShell.left + 1, name + ': sidebar overlaps the document');
    assert.ok(layout.documentPane.right <= layout.inspector.left + 1, name + ': inspector overlaps the document');
    assert.ok(Math.abs(layout.sidebar.top - layout.mainShell.top) <= 1 && Math.abs(layout.inspector.top - layout.documentPane.top) <= 1, name + ': the wide workspace is not a genuine three-column composition');
    assert.equal(layout.paneOverflows.content, 'clip', name + ': wide content frame must not become an invisible scroll container');
    assert.equal(layout.paneScrolls.content, 0, name + ': wide content frame was scrolled');
  } else {
    assert.ok(layout.inspector.top >= layout.documentPane.bottom - 1, name + ': the compact inspector must flow after the document');
    assert.ok(['auto', 'scroll'].includes(layout.paneOverflows.content), name + ': compact content must provide a real scroll pane');
  }
  assert.ok(layout.workspace.top >= layout.header.bottom - 1, name + ': workspace begins underneath the native model strip');
  const identity = layout.sidebarIdentity;
  if (layout.width <= 760) {
    assert.equal(layout.sidebarHeading.height, 0, name + ': the compact stage bar should omit the duplicate sidebar identity');
  } else {
    assert.ok(layout.sidebarHeading.top >= layout.workspace.top - 1 && layout.sidebarHeading.bottom <= layout.sidebar.bottom + 1, name + ': fixed sidebar heading is cropped');
    assert.equal(identity.project.inside, true, name + ': project identity is outside the viewport');
    assert.equal(identity.project.hit, true, name + ': project identity is covered');
    assert.ok(identity.avatar.top >= layout.sidebarHeading.top - 1 && identity.avatar.bottom <= layout.sidebarHeading.bottom + 1, name + ': project icon is cut by its fixed heading');
    if (identity.search) assert.ok(identity.search.top >= layout.sidebarHeading.top - 1 && identity.search.bottom <= layout.sidebarHeading.bottom + 1, name + ': visible project search is cropped');
  }
  for (let index = 1; index < layout.actions.buttons.length; index++) {
    const before = layout.actions.buttons[index - 1], current = layout.actions.buttons[index];
    assert.ok(current.left >= before.right - 1 || current.top >= before.bottom - 1, name + ': project buttons overlap or changed order');
  }
}

async function assertProjectActionsReachable(page, name = 'workbench') {
  const focusMode = await page.evaluate(() => innerHeight <= 760 && !document.querySelector('.model-controls')?.hidden && getComputedStyle(document.querySelector('.linear-workspace')).display === 'none');
  if (focusMode) return;
  for (const button of await page.locator('.linear-sidebar-footer > button').all()) {
    await button.scrollIntoViewIfNeeded();
    const state = await button.evaluate(element => {
      const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { label: element.getAttribute('aria-label'), inside: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) };
    });
    assert.equal(state.inside, true, name + ': project action cannot be scrolled into view: ' + state.label);
    assert.equal(state.hit, true, name + ': project action is covered: ' + state.label);
  }
}

// Only real content panes scroll; native and workspace frames must never move.
function scrollWorkbench(position) {
  for (const selector of ['.linear-document', '.linear-content-scroll', '.linear-sidebar-scroll']) {
    const element = document.querySelector(selector);
    if (element) element.scrollTo({ top: position === 'end' ? element.scrollHeight : 0, behavior: 'instant' });
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

module.exports = { collectWorkbenchLayout, assertWorkbenchLayout, assertProjectActionsReachable, scrollWorkbench };
