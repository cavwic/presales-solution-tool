'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function localConfig(root) {
  const filename = path.join(root, 'config', 'local-build.json');
  if (!fs.existsSync(filename)) return {};
  let config;
  try { config = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('config/local-build.json must contain valid JSON.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !['electronDist', 'buildModules'].includes(key))
    || Object.values(config).some(value => typeof value !== 'string' || !value.trim())) throw new Error('config/local-build.json supports electronDist and buildModules paths only.');
  return config;
}
function rootOf(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('root must be an absolute project path.');
  return path.resolve(root);
}
function selected(environment, names, configured) {
  for (const name of names) if (environment[name] !== undefined && environment[name] !== '') {
    if (typeof environment[name] !== 'string' || !environment[name].trim()) throw new Error(`${name} must be a directory path.`);
    return environment[name].trim();
  }
  return configured;
}
function resolveElectronDist({ root = path.resolve(__dirname, '..'), environment = process.env } = {}) {
  root = rootOf(root);
  const explicit = selected(environment, ['PRESALES_SOLUTION_TOOL_ELECTRON_DIST', 'SOLUTION_TOOL_ELECTRON_DIST', 'BID_ELECTRON_DIST'], localConfig(root).electronDist);
  let directory;
  if (explicit) directory = path.resolve(root, explicit);
  else {
    try { directory = path.join(path.dirname(createRequire(path.join(root, 'package.json')).resolve('electron/package.json')), 'dist'); }
    catch { throw new Error('Electron is unavailable. Install project development dependencies, or set electronDist in config/local-build.json.'); }
  }
  if (!fs.existsSync(path.join(directory, 'electron.exe'))) throw new Error('The configured Electron distribution is incomplete: electron.exe is missing.');
  return directory;
}
function resolveBuildPaths({ root = path.resolve(__dirname, '..'), environment = process.env } = {}) {
  root = rootOf(root);
  const explicit = selected(environment, ['PRESALES_SOLUTION_TOOL_BUILD_MODULES', 'SOLUTION_TOOL_BUILD_MODULES', 'BID_BUILD_MODULES'], localConfig(root).buildModules);
  const buildModules = path.resolve(root, explicit || 'node_modules');
  const requireTools = createRequire(path.join(buildModules, '__build.cjs'));
  try { requireTools.resolve('pe-library'); requireTools.resolve('resedit/cjs'); }
  catch { throw new Error('PE build dependencies are unavailable. Install project development dependencies, or set buildModules in config/local-build.json.'); }
  return { electronDist: resolveElectronDist({ root, environment }), buildModules };
}
module.exports = { resolveElectronDist, resolveBuildPaths };
