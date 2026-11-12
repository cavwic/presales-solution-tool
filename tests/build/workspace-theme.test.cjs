'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('the desktop layout loads the shared visual theme after its base styles', () => {
  const layout = read('src/layouts/BaseLayout.astro');
  assert.ok(layout.indexOf('../styles/workspace-linear.css') > layout.indexOf('../styles/global.css'));
  assert.match(layout, /data-workspace-design="linear"/);
  assert.ok(fs.existsSync(path.join(root, 'src/styles/workspace-refresh.css')), 'the preserved original visual theme remains available');
  const controls = ['global-locale-toggle', 'global-theme-toggle', 'window-minimize', 'window-maximize', 'window-close'];
  const positions = controls.map(id => layout.indexOf(`id="${id}"`));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
});

test('both themes keep text and primary actions legible with solid fills', () => {
  const css = read('src/styles/workspace-linear.css');
  const blocks = [...css.matchAll(/:root\[data-workspace-design="linear"\](?:\[data-theme="dark"\])?\s*\{([^}]+)\}/g)].slice(0, 2).map(match => Object.fromEntries([...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(entry => [entry[1], entry[2].trim()])));
  const palettes = blocks.map(palette => ({ ...blocks[0], ...palette }));
  const luminance = hex => {
    assert.match(hex, /^#(?:[\da-f]{3}|[\da-f]{6})$/i);
    if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(channel => channel + channel).join('');
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  assert.equal(palettes.length, 2);
  for (const palette of palettes) {
    for (const [foreground, background] of [['--ink', '--surface'], ['--ink-2', '--surface'], ['--soft', '--surface'], ['--soft', '--paper'], ['--ink', '--field-surface'], ['--on-primary', '--primary']]) {
      const values = [luminance(palette[foreground]), luminance(palette[background])].sort((a, b) => a - b);
      assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `${foreground} on ${background} must meet normal-text contrast`);
    }
  }
  assert.doesNotMatch(css, /linear-gradient\(/);
  assert.match(css, /background:\s*var\(--field-surface\)/);
  assert.match(css, /background:\s*var\(--primary\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(read('src/styles/global.css') + css, /\.window-control/);
});

test('the selected composition connects existing project fields and workflow panes', () => {
  const source = read('src/components/SolutionWorkbench.tsx');
  for (const className of ['linear-sidebar', 'linear-sidebar-heading', 'linear-sidebar-scroll', 'linear-main-shell', 'linear-content-scroll', 'linear-inspector', 'linear-stage-nav', 'linear-sidebar-footer', 'linear-document-title']) assert.ok(source.includes(className), `missing production ${className}`);
  assert.match(source, /className="workspace-content linear-document"/);
  assert.match(source, /<ModelControls locale=\{locale\} busy=\{busy\} toolbarTarget=\{headerSettingsTarget\}/);
  assert.doesNotMatch(source, /from ["']\.\/design-preview\//);
});

test('workspace chrome cannot become an invisible scroll container and communication has one add action', () => {
  const css = read('src/styles/workspace-linear.css');
  for (const selector of ['.solution-app', '.linear-workspace', '.linear-main-shell', '.linear-sidebar']) {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].includes(selector));
    assert.ok(blocks.some(match => /overflow:\s*clip/.test(match[2])), `${selector} must prohibit programmatic hidden scrolling`);
  }
  const source = read('src/components/SolutionWorkbench.tsx');
  assert.match(source, /<textarea[\s\S]{0,300}className="linear-document-title"/);
  const toolbar = source.slice(source.indexOf('<div className="linear-view-actions">'), source.indexOf('<main className="workspace-content linear-document">'));
  assert.doesNotMatch(toolbar, /addPresalesRound\(/, 'the top toolbar must not duplicate the communication add action');
  assert.match(source, /aria-label=\{locale === "zh" \? "新增沟通节点" : "Add communication node"\}[^>]*>[\s\S]{0,50}<Plus/, 'the communication section keeps its localized + action');
});

test('the shared font is bundled locally and has a desktop MIME type and license', () => {
  assert.ok(fs.statSync(path.join(root, 'src/assets/Manrope-Variable.ttf')).size > 100000);
  assert.match(read('public/fonts/Manrope-OFL.txt'), /SIL OPEN FONT LICENSE/);
  const main = read('desktop/main.cjs');
  assert.ok(main.includes("'.ttf': 'font/ttf'"));
  assert.ok(main.includes("font-src 'self' data:"));
  assert.ok(main.includes("'CavwicBidWorkbench'"));
  assert.ok(main.includes("'bid://app/cavwic-solutions-lab/'"));
});

test('icon-only Skills keeps its localized accessible name', () => {
  assert.match(read('src/components/ModelControls.tsx'), /data-testid="import-skills" aria-label=\{t\.importSkills\}/);
});
