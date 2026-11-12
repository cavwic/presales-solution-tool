'use strict';

const path = require('node:path');
const { resolveElectronDist } = require('../../scripts/build-paths.cjs');

function sourceElectronExecutable() {
  const runtime = resolveElectronDist({ root: path.resolve(__dirname, '../..') });
  return path.join(runtime, 'electron.exe');
}

// Passed to page.evaluate without Node closures. Transparent document editors,
// filled settings fields and confirmed text deliberately use different surfaces.
// Wait for their real CSS transitions and resolved text palette, not one fill.
function fieldThemeSettled() {
  const field = document.querySelector('.confirmable-textarea:not(.confirmed) textarea');
  if (!field) return true;
  if ([field, document.body].some(element => element.getAnimations().some(animation => animation.playState === 'running' || animation.pending))) return false;
  const palette = ['--ink', '--ink-2', '--soft'].map(token => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    field.parentElement.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  return getComputedStyle(document.body).color === palette[0] && palette.includes(getComputedStyle(field).color);
}

module.exports = { sourceElectronExecutable, fieldThemeSettled };
