'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough, Writable} = require('node:stream');
const {createSubscriptionProvider} = require('./subscription/index.cjs');
const {SubscriptionTurn} = require('./subscription/turn.cjs');
const {childEnvironment, resolveRuntime} = require('./subscription/runtime.cjs');

function fixture(t, {account = {type:'chatgpt'}, threadModel, onTurn, handler, writeFailure} = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'bid-subscription-')));
  const calls = [], children = [];
  const spawnImpl = (_command, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killed = false; child.kill = () => { child.killed = true; child.emit('exit', 0); };
    child.stdin = new Writable({write(bytes, _encoding, callback) {
      for (const line of bytes.toString().trim().split('\n')) {
        const request = JSON.parse(line); calls.push(request);
        const failureCode = writeFailure?.(request, children.length);
        if (failureCode) {
          queueMicrotask(() => callback(Object.assign(new Error('simulated closed pipe'), {code:failureCode})));
          return;
        }
        if (request.id === undefined) continue;
        queueMicrotask(() => {
          const reply = result => child.stdout.write(JSON.stringify({id:request.id,result})+'\n');
          const notify = (method, params) => child.stdout.write(JSON.stringify({method,params})+'\n');
          if (handler?.({request,reply,notify,child}) === true) return;
          if (request.method === 'initialize') return reply({});
          if (request.method === 'account/read') return reply({account});
          if (request.method === 'model/list') return reply({data:[{model:'exact-model',displayName:'Exact model',isDefault:true,inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'medium'}]}],nextCursor:null});
          if (request.method === 'config/read') return reply({config:{mcp_servers:{private_service:{enabled:true}},plugins:{private_plugin:{enabled:true}}}});
          if (request.method === 'thread/start') return reply({model:threadModel || request.params.model,thread:{id:'thread-1'}});
          if (request.method === 'turn/start') {
            reply({turn:{id:'turn-1'}});
            if (onTurn) return onTurn({notify,child,request});
            notify('item/agentMessage/delta',{threadId:'thread-1',turnId:'turn-1',delta:'草稿'});
            notify('item/completed',{threadId:'thread-1',turnId:'turn-1',item:{type:'agentMessage',text:'最终内容'}});
            return notify('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}});
          }
          if (request.method === 'turn/interrupt') return reply({});
        });
      }
      callback();
    }});
    children.push({child,args,options}); return child;
  };
  const provider = createSubscriptionProvider({userData:root,spawnImpl,runtimeResolver:async () => ({command:'test.exe',clientVersion:'codex-cli 0.163.0'}),rpcTimeout:1000,timeout:1000,idleTimeout:500});
  t.after(() => { provider.close(); fs.rmSync(root,{recursive:true,force:true}); });
  return {provider,calls,children,root};
}
const input = {model:'exact-model',messages:[{role:'user',content:'请生成正文'}]};

test('catalog uses account/list RPCs and never starts inference', async t => {
  const {provider,calls,children} = fixture(t);
  const value = await provider.catalog();
  assert.equal(value.defaultModel,'exact-model'); assert.equal(value.models[0].displayName,'Exact model');
  assert.deepEqual(value.models[0].inputModalities,['text','image']);
  assert.equal(value.clientVersion,'codex-cli 0.163.0');
  assert.deepEqual(calls.map(row => row.method),['initialize','initialized','account/read','model/list']);
  assert.deepEqual(children[0].args,['app-server','--listen','stdio://']);
  assert.deepEqual(calls[0].params.clientInfo,{name:'presales_solution_tool',title:'售前解决方案工具',version:'1.6.0'});
});
test('API-key account is classified as subscription login required', async t => {
  const {provider,calls} = fixture(t,{account:{type:'apiKey'}});
  await assert.rejects(provider.catalog(),{code:'CODEX_LOGIN_REQUIRED'});
  assert.ok(!calls.some(row => row.method === 'model/list'));
});
test('generation resolves final content only after completed status', async t => {
  const {provider,calls,root} = fixture(t);
  assert.deepEqual(await provider.chat(input),{content:'最终内容',model:'exact-model',provider:'codex'});
  const params = calls.find(row => row.method === 'thread/start').params;
  assert.equal(params.cwd,path.join(root,'model-sandbox'));
  assert.equal(params.model,'exact-model'); assert.equal(params.approvalPolicy,'never'); assert.equal(params.ephemeral,true);
  assert.equal(params.permissions,'bid_text'); assert.equal(params.config.default_permissions,'bid_text');
  assert.deepEqual(params.config.permissions.bid_text,{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}});
  assert.deepEqual(params.config.mcp_servers,{private_service:{enabled:false}});
  assert.deepEqual(params.config.plugins,{private_plugin:{enabled:false}});
  assert.equal(params.config.features.shell_tool,false); assert.equal(params.config.features.apps,false);
  assert.equal(params.config.project_doc_max_bytes,0); assert.equal(params.config.memories.use_memories,false);
  assert.equal(calls.find(row => row.method === 'turn/start').params.model,'exact-model');
});
test('manual exact model is preserved even when not advertised in the catalog', async t => {
  const {provider,calls} = fixture(t);
  const result = await provider.chat({...input,model:'unlisted-model'});
  assert.equal(result.model,'unlisted-model');
  const request = calls.find(row => row.method === 'turn/start');
  assert.equal(request.params.model,'unlisted-model'); assert.equal(request.params.effort,undefined);
});
test('server model substitution fails before turn/start', async t => {
  const {provider,calls} = fixture(t,{threadModel:'another-model'});
  await assert.rejects(provider.chat(input),{code:'CODEX_MODEL_MISMATCH'});
  assert.ok(!calls.some(row => row.method === 'turn/start'));
});
for (const [status,code] of [['interrupted','MODEL_INTERRUPTED'],['failed','MODEL_FAILED']]) {
  test(`partial output with ${status} terminal status is rejected`, async t => {
    const {provider} = fixture(t,{onTurn:({notify}) => {
      notify('item/agentMessage/delta',{threadId:'thread-1',turnId:'turn-1',delta:'partial'});
      notify('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status,error:{message:'private marker prompt'}}});
    }});
    await assert.rejects(provider.chat(input),error => error.code === code && !error.message.includes('private marker'));
  });
}
test('partial output without completion cannot become success on disconnect', async t => {
  const {provider} = fixture(t,{onTurn:({notify,child}) => {
    notify('item/agentMessage/delta',{threadId:'thread-1',turnId:'turn-1',delta:'partial'});
    queueMicrotask(() => child.emit('exit',1));
  }});
  await assert.rejects(provider.chat(input),{code:'CODEX_CLOSED'});
});
for (const code of ['EPIPE','ERR_STREAM_DESTROYED']) {
  test(`asynchronous stdin ${code} rejects the pending turn without an uncaught stream error`, async t => {
    const {provider,children} = fixture(t,{writeFailure:request => request.method === 'turn/start' ? code : null});
    await assert.rejects(provider.chat(input),{code:'CODEX_CLOSED'});
    assert.equal(provider.process,null); assert.equal(provider.pending.size,0); assert.equal(provider.turns.size,0);
    assert.equal(children[0].child.killed,true);
  });
}
test('stdin failure during initialize rejects handshake and permits a fresh connection', async t => {
  const {provider,children} = fixture(t,{writeFailure:(request,childCount) => childCount === 1 && request.method === 'initialize' ? 'EPIPE' : null});
  await assert.rejects(provider.catalog(),{code:'CODEX_CLOSED'});
  assert.equal(children[0].child.killed,true);
  const catalog = await provider.catalog(); assert.equal(catalog.defaultModel,'exact-model');
  assert.equal(children.length,2); assert.equal(provider.process,children[1].child);
});
test('delayed stdin failure from an old child cannot disconnect the replacement', async t => {
  const {provider,children} = fixture(t);
  await provider.catalog(); const oldChild = children[0].child; provider.stopChild(oldChild);
  await provider.catalog(); const currentChild = children[1].child;
  oldChild.stdin.destroy(Object.assign(new Error('late closed pipe'),{code:'EPIPE'}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(provider.process,currentChild); assert.equal(currentChild.killed,false);
  assert.equal((await provider.catalog()).defaultModel,'exact-model');
});
test('empty completed output is rejected', async t => {
  const {provider} = fixture(t,{onTurn:({notify}) => notify('turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}})});
  await assert.rejects(provider.chat(input),{code:'MODEL_EMPTY'});
});
test('wrong turn completion is ignored until the matching turn completes', async () => {
  const turn = new SubscriptionTurn({threadId:'thread',model:'exact-model',timeout:1000,idleTimeout:500});
  turn.started('expected'); turn.receive('item/agentMessage/delta',{turnId:'expected',delta:'correct'});
  turn.receive('turn/completed',{turn:{id:'other',status:'completed'}});
  assert.equal(turn.finished,undefined);
  turn.receive('turn/completed',{turn:{id:'expected',status:'completed'}});
  assert.equal((await turn.promise).content,'correct');
});
test('retry notification retains partial output but requires eventual completion', async () => {
  const turn = new SubscriptionTurn({threadId:'thread',model:'exact-model',timeout:1000,idleTimeout:500});
  turn.started('turn'); turn.receive('error',{turnId:'turn',willRetry:true,error:{message:'not logged in'}});
  assert.equal(turn.finished,undefined);
  turn.receive('item/agentMessage/delta',{turnId:'turn',delta:'recovered'});
  turn.receive('turn/completed',{turn:{id:'turn',status:'completed'}});
  assert.equal((await turn.promise).content,'recovered');
});
test('late start acknowledgment after timeout only interrupts its owned turn', async () => {
  const interrupted = [], turn = new SubscriptionTurn({threadId:'thread',model:'exact-model',timeout:15,idleTimeout:500,interrupt:(...args) => interrupted.push(args)});
  await assert.rejects(turn.promise,{code:'MODEL_TIMEOUT'});
  turn.started('late-turn'); assert.deepEqual(interrupted,[['thread','late-turn']]);
});
test('close during discovery prevents child creation', async t => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'bid-discovery-'))); t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  let release, spawned = false;
  const provider = createSubscriptionProvider({userData:root,runtimeResolver:() => new Promise(resolve => { release = resolve; }),spawnImpl:() => { spawned = true; }});
  const pending = provider.catalog(); provider.close(); release({command:'test.exe',clientVersion:'codex-cli 0.163.0'});
  await assert.rejects(pending,{code:'CODEX_CLOSED'}); assert.equal(spawned,false);
});
test('unexpected server requests cannot approve execution or invent authentication', async t => {
  const {provider,calls} = fixture(t); await provider.catalog();
  provider.receive({id:300,method:'item/commandExecution/requestApproval',params:{}});
  provider.receive({id:301,method:'account/chatgptAuthTokens/refresh',params:{}});
  assert.deepEqual(calls.find(row => row.id === 300).result,{decision:'decline'});
  assert.equal(calls.find(row => row.id === 301).error.code,-32601);
});
test('runtime discovery selects newest ordinary installed binary without credentials', async () => {
  const queried = [], local = 'C:\\Users\\test\\AppData\\Local';
  const runtime = await resolveRuntime({platform:'win32',environment:{LOCALAPPDATA:local},
    readDirectory:directory => { assert.equal(directory,path.join(local,'OpenAI','Codex','bin')); return ['old','new'].map(name => ({name,isDirectory:() => true})); },isExecutable:() => true,
    probe:async command => { queried.push(command); return command === 'codex' ? null : command.includes('new') ? 'codex-cli 0.163.0-alpha.11.2' : 'codex-cli 0.162.0'; }});
  assert.equal(runtime.source,'installed-desktop'); assert.equal(runtime.clientVersion,'codex-cli 0.163.0-alpha.11.2');
  assert.equal(queried.length,3); assert.ok(queried.every(value => !value.includes('auth.json') && !value.includes('WindowsApps')));
});
test('explicit runtime failure never silently selects another client', async () => {
  const queried = [];
  await assert.rejects(resolveRuntime({command:'missing.exe',environment:{PRESALES_SOLUTION_CODEX:'available-new.exe',SOLUTION_CODEX:'available-solution.exe',BID_CODEX:'available-bid.exe'},probe:async command => { queried.push(command); return command === 'missing.exe' ? null : 'codex-cli 0.163.0'; }}),{code:'CODEX_RUNTIME_UNAVAILABLE'});
  assert.deepEqual(queried,['missing.exe']);
});
test('renamed runtime variable takes priority while legacy overrides remain compatible', async () => {
  for (const {command,environment,expected} of [
    {environment:{PRESALES_SOLUTION_CODEX:'presales-client.exe',SOLUTION_CODEX:'solution-client.exe',BID_CODEX:'bid-client.exe'},expected:'presales-client.exe'},
    {environment:{SOLUTION_CODEX:'solution-client.exe',BID_CODEX:'bid-client.exe'},expected:'solution-client.exe'},
    {environment:{BID_CODEX:'bid-client.exe'},expected:'bid-client.exe'},
    {command:'direct-client.exe',environment:{PRESALES_SOLUTION_CODEX:'presales-client.exe',SOLUTION_CODEX:'solution-client.exe',BID_CODEX:'bid-client.exe'},expected:'direct-client.exe'},
  ]) {
    const queried = [];
    const runtime = await resolveRuntime({command,environment,probe:async candidate => { queried.push(candidate); return 'codex-cli 0.163.0'; },readDirectory:() => { throw new Error('Explicit runtime must not discover another installation'); }});
    assert.equal(runtime.command,expected); assert.equal(runtime.source,'explicit'); assert.deepEqual(queried,[expected]);
  }
});
test('an unusable renamed runtime override never falls back to the legacy client', async () => {
  for (const environment of [
    {PRESALES_SOLUTION_CODEX:'missing-new.exe',SOLUTION_CODEX:'available-solution.exe',BID_CODEX:'available-bid.exe'},
    {SOLUTION_CODEX:'missing-new.exe',BID_CODEX:'available-bid.exe'},
  ]) {
    const queried = [];
    await assert.rejects(resolveRuntime({environment,probe:async command => { queried.push(command); return command === 'missing-new.exe' ? null : 'codex-cli 0.163.0'; }}),{code:'CODEX_RUNTIME_UNAVAILABLE'});
    assert.deepEqual(queried,['missing-new.exe']);
  }
});
test('child environment removes host integration while preserving account/proxy choices', () => {
  const result = childEnvironment({PATH:'path',CODEX_HOME:'selected-home',HTTP_PROXY:'proxy',CODEX_INTERNAL_ORIGINATOR_OVERRIDE:'host',CODEX_APP_TOOLS_PIPE_PATH:'pipe',CODEX_SESSION_ID:'session',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--inspect'});
  assert.deepEqual(result,{PATH:'path',CODEX_HOME:'selected-home',HTTP_PROXY:'proxy'});
});
