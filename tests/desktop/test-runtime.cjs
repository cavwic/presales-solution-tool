'use strict';

const path = require('node:path');
const { resolveElectronDist } = require('../../scripts/build-paths.cjs');

function sourceElectronExecutable() {
  const runtime = resolveElectronDist({ root: path.resolve(__dirname, '../..') });
  return path.join(runtime, 'electron.exe');
}

module.exports = { sourceElectronExecutable };
