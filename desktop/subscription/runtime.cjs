'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const HOST_KEYS = new Set(['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','NODE_PATH','VSCODE_INSPECTOR_OPTIONS',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE','CODEX_APP_TOOLS_PIPE_PATH','CODEX_SESSION_ID','CODEX_THREAD_ID']);
function childEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !HOST_KEYS.has(key.toUpperCase())));
}
function parseVersion(value) {
  const match = /^codex-cli\s+(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(String(value || '').trim());
  return match ? {numbers: match.slice(1, 4).map(Number), prerelease: match[4] || '', text: match[0]} : null;
}
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
  if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
  return a.prerelease.localeCompare(b.prerelease, undefined, {numeric:true});
}
function probeVersion(command, {cwd, environment = process.env, platform = process.platform, timeout = 6000} = {}) {
  return new Promise(resolve => {
    let finished = false, output = '', timer;
    const finish = value => { if (finished) return; finished = true; clearTimeout(timer); resolve(value); };
    let child;
    try {
      child = spawn(command, ['--version'], {cwd, env:childEnvironment(environment),
        stdio:['ignore','pipe','ignore'], windowsHide:true, shell:platform === 'win32' && !/\.exe$/i.test(command)});
    } catch { return finish(null); }
    timer = setTimeout(() => { child.kill(); finish(null); }, timeout);
    child.stdout.on('data', bytes => { if (output.length < 300) output += bytes.toString(); });
    child.on('error', () => finish(null));
    child.on('exit', code => finish(code === 0 ? parseVersion(output)?.text || null : null));
  });
}

// Only ordinarily accessible installed locations. No credential files, installation,
// managed-app state, protected WindowsApps directories, or global configuration writes.
async function resolveRuntime({command, cwd, environment = process.env, platform = process.platform,
  readDirectory = fs.readdirSync, isExecutable = file => fs.statSync(file).isFile(), probe = probeVersion} = {}) {
  const explicit = command || environment.PRESALES_SOLUTION_CODEX || environment.SOLUTION_CODEX || environment.BID_CODEX;
  if (explicit) {
    // Non-exe launchers use the Windows shell; prevent a command override becoming shell code.
    if (typeof explicit !== 'string' || /[\r\n&|<>`]/.test(explicit)) throw Object.assign(new Error('Codex 客户端路径无效'), {code:'CODEX_RUNTIME_INVALID'});
    const clientVersion = await probe(explicit, {cwd, environment, platform});
    if (!parseVersion(clientVersion)) throw Object.assign(new Error('指定的 Codex 客户端无法启动，请检查 PRESALES_SOLUTION_CODEX 路径'), {code:'CODEX_RUNTIME_UNAVAILABLE'});
    return {command:explicit, clientVersion, source:'explicit'};
  }
  const candidates = [{command:'codex', source:'path'}];
  if (platform === 'win32' && environment.LOCALAPPDATA) {
    const directory = path.join(environment.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    let entries = []; try { entries = readDirectory(directory, {withFileTypes:true}); } catch {}
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\w[\w.-]*$/.test(entry.name)) continue;
      const file = path.join(directory, entry.name, 'codex.exe');
      try { if (isExecutable(file)) candidates.push({command:file, source:'installed-desktop'}); } catch {}
    }
  }
  const seen = new Set();
  const unique = candidates.filter(row => { const key = row.command.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  const checked = await Promise.all(unique.map(async row => ({...row, clientVersion:await probe(row.command, {cwd, environment, platform})})));
  const usable = checked.filter(row => parseVersion(row.clientVersion));
  usable.sort((a, b) => compareVersions(parseVersion(b.clientVersion), parseVersion(a.clientVersion)) ||
    Number(b.source === 'installed-desktop') - Number(a.source === 'installed-desktop'));
  if (!usable.length) throw Object.assign(new Error('未找到可用的 Codex 客户端，请先安装并在 Codex 中登录 ChatGPT 套餐'), {code:'CODEX_RUNTIME_UNAVAILABLE'});
  return usable[0];
}
module.exports = {childEnvironment, parseVersion, compareVersions, probeVersion, resolveRuntime};
