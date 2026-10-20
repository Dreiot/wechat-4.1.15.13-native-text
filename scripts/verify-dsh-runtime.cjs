// Run with the selected DSH executable and ELECTRON_RUN_AS_NODE=1.
// Uses the real DSH runtime with an offline model adapter and isolated data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

(async () => {
  const project = path.resolve(process.env.WECHATAGENT_VERIFY_PROJECT || path.join(__dirname, '..'));
  const source = path.resolve(process.argv[2] || 'E:/DSH');
  const fixture = fs.mkdtempSync(path.join(project, 'state', 'dsh-020-compat-'));
  const home = path.join(fixture, 'home');
  process.env.DSH_HOME = home;
  process.env.DSH_TELEMETRY_DISABLED = '1';
  fs.mkdirSync(path.join(fixture, 'state'), { recursive: true });
  const base = path.join(source, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai');
  const mod = name => import(pathToFileURL(path.join(base, name, 'lib/index.js')).href);
  const boot = await mod('dsh-app-boot');
  const sdk = await mod('dsh-llm');
  const toolSdk = await mod('dsh-tools');
  const actualVersion = JSON.parse(fs.readFileSync(path.join(source, 'resources/app.asar/package.json'))).version;
  assert.match(actualVersion, /^0\.2\.\d+(?:-.*)?$/, 'verification requires the supported DSH 0.2 runtime');
  const plugin = path.join(project, 'packages/dsh-social-bridge-plugin');
  assert.equal(boot.evaluatePluginCompatibility(JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'))), {}, actualVersion), undefined);
  const persona = '你是用于兼容验收的测试助手，只回复 SILENT。';
  fs.writeFileSync(path.join(fixture, 'state/bridge-config.json'), JSON.stringify({role:persona, persona_name:'测试人格', roles:{}}));
  const token = crypto.randomBytes(24).toString('hex');
  const tokenFile = path.join(fixture, 'token.txt'); fs.writeFileSync(tokenFile, token);
  const portProbe = http.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
  const rows = ['dsh-llm','dsh-session','dsh-session-projection','dsh-system-prompt','dsh-tools','dsh-agent','dsh-agent-loop','dsh-session-title'].map((name, i) => ({id:'core-'+i, name:'@deepseek-ai/'+name, config:{}}));
  rows[3].config={personaPrefix:''};
  rows[7].config={fallbackMaxWords:5,fallbackMaxBytes:40,maxTitleBytes:80};
  rows.push({id:'tokens',name:'@deepseek-ai/dsh-token-meter'});
  rows.push({id:'image-offload',name:'@deepseek-ai/dsh-compaction-image-offload'});
  rows.push({id:'persist',name:'@deepseek-ai/dsh-session-persistence-jsonl',config:{root:path.join(home,'sessions')}});
  rows.push({id:'storage',name:'@deepseek-ai/dsh-storage'});
  rows.push({id:'storage-json',name:'@deepseek-ai/dsh-storage-json',config:{root:path.join(home,'storage')}});
  rows.push({id:'storage-domain',name:'@deepseek-ai/dsh-storage-domain',config:{backend:'json'}});
  rows.push({id:'workspaces',name:'@deepseek-ai/dsh-workspace'});
  rows.push({id:'attachments',name:'@deepseek-ai/dsh-attachment-local',config:{dshHome:home}});
  rows.push({id:'presets',name:'@deepseek-ai/dsh-agent-preset-registry',config:{default:'wechat-social'}});
  rows.push({id:'social-preset',name:'@deepseek-ai/dsh-agent-preset',config:{id:'wechat-social',name:'微信测试',plugins:[
    {id:'persona',name:pathToFileURL(path.join(base,'dsh-persona/lib/index.js')).href,config:{prefix:persona,suffix:'',includeRuntimeContext:false}},
    {id:'compaction',name:'cordis:group',group:true,isolate:{compaction:true},config:[{id:'basic',name:pathToFileURL(path.join(base,'dsh-compaction-basic/lib/index.js')).href,config:{auto:false}}]},
    {id:'restrict',name:pathToFileURL(path.join(plugin,'social-tool-restrict.mjs')).href}
  ]}});
  rows.push({id:'social',name:pathToFileURL(path.join(plugin,'index.js')).href,config:{projectRoot:fixture,tokenFile,statePath:path.join(fixture,'mappings.json'),provider:'offline-test',model:'test-image',port}});
  const configFile = path.join(fixture,'cordis.yml'); fs.writeFileSync(configFile, JSON.stringify(rows));
  let ctx, reader;
  const calls = [];
  try {
    ctx = await boot.boot('WeChatAgent compatibility',configFile,[],undefined,pathToFileURL(path.join(source,'resources/app.asar/dsh/package.json')).href);
    let failVision=false;
    class Adapter extends sdk.LlmAdapter {
      async resolveModel(provider,id) { return {provider,id,name:id,inputModalities:['text','image'],contextWindow:65536,maxOutputTokens:4096,toolUpdate:'in-history'}; }
      async *stream(options) {
        calls.push(options);
        if(failVision&&options.messages.some(message=>message.content?.some(block=>block.type==='image')))throw new sdk.LlmError('Offline fixture rejects this image','INVALID_REQUEST');
        if(options.tools?.length && options.tools.every(tool=>tool.deferLoading===true))throw new sdk.LlmError('tools: at least one tool must have defer_loading=false. All tools cannot be deferred.','INVALID_REQUEST');
        yield {type:'block-start',index:0,blockType:'text'};
        yield {type:'text-delta',index:0,text:'SILENT'};
        yield {type:'block-end',index:0,block:{type:'text',text:'SILENT'}};
        yield {type:'finish',reason:{kind:'stop'}};
      }
    }
    ctx.llm.registerAdapter(['offline-test'],new Adapter());
    const sharp = require(path.join(source,'resources/app.asar/dsh/node_modules/sharp'));
    const image = await sharp({create:{width:2,height:2,channels:3,background:{r:0,g:150,b:150}}}).png().toBuffer();
    const imageId = crypto.createHash('sha256').update(image).digest('hex');
    const key = 'wechat:private:offline-dsh-020';
    let readerConversationKey=key;
    reader = http.createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({imageId,conversationKey:readerConversationKey,b64:image.toString('base64'),mime:'image/png',sha256:imageId}));});
    await new Promise(resolve=>reader.listen(0,'127.0.0.1',resolve));
    fs.writeFileSync(path.join(fixture,'state/wechat-io-config.json'),JSON.stringify({reader_base_url:'http://127.0.0.1:'+reader.address().port,reader_token:token}));
    const identity = {conversationKey:key,conversationName:'离线兼容验收',personaName:'测试人格',persona};
    async function rpc(route, body, allowFailure=false) {
      const response=await fetch('http://127.0.0.1:'+port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
      const value=await response.json(); if(!allowFailure)assert(response.ok,JSON.stringify(value));return value;
    }
    const configured=await rpc('/configure',identity);
    await rpc('/followup',{...identity,message:'第一条测试消息'});
    await rpc('/followup',{...identity,message:'第二条测试消息'});
    let session=(await rpc('/sessions')).sessions[0]; assert.equal(session.initializations,1);
    assert(calls.every(call=>!call.tools?.length),'Social tools must remain empty');
    const socialAgent=ctx.agents.get(configured.sessionId);
    const lateTools=['schedule_create','schedule_delete','schedule_list','schedule_update'].map(name=>toolSdk.defineTool({
      name,description:'Late scoped fixture tool',parameters:{},
      output:{schema:{type:'object',properties:{},additionalProperties:false},render:()=>[{type:'text',text:'{}'}]},
      async execute(){throw new Error('Social fixture tools must never execute');},
    }));
    for(const tool of lateTools)socialAgent.ctx.tools.register(tool);
    // Reproduce the pre-fix presentation in this isolated offline fixture.
    const legacySchemas=lateTools.map(({name,description,parameters})=>({name,description,parameters}));
    const removeLegacyOverride=socialAgent.ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>({...await next(),tools:legacySchemas}),{prepend:true});
    const legacyFailure=await rpc('/followup',{...identity,message:'旧版定时工具污染复现'},true);
    assert.equal(legacyFailure.code,'INVALID_REQUEST','The fixture must reproduce the deferred-only failure');
    assert(calls.at(-1).tools.every(tool=>tool.deferLoading===true));
    removeLegacyOverride();
    const recovered=await rpc('/followup',{...identity,message:'修复后的历史工具隔离测试'});
    assert.equal(recovered.text,'SILENT');assert.equal(calls.at(-1).tools?.length ?? 0,0);
    assert(socialAgent.session.snapshotEvents().some(event=>event.type==='user/message'&&event.data.source?.socialToolMetadataRetired));
    assert(socialAgent.session.snapshotEvents().some(event=>event.type==='developer/message'&&event.data.message?.content.some(block=>block.type==='tool-addition')),'Original tool-change history must be retained for audit');
    const coding=await ctx.agents.create({sessionId:'coding-tool-isolation-fixture',meta:{cwd:fixture},agentOptions:{provider:'offline-test',model:'test-image'}});
    coding.agent.ctx.tools.register(lateTools[0]);
    const codingAssembly=await ctx.systemPrompt.assemble({scope:coding.agent});
    assert(codingAssembly.tools.some(tool=>tool.name==='schedule_create'),'Ordinary Agent tools must not be hidden');
    await coding.dispose();
    await rpc('/followup',{...identity,message:'测试原生图片',images:[{id:imageId}]});
    assert(calls.some(call=>call.messages.some(message=>message.content?.some(block=>block.type==='image'))),'Image must reach the real runtime adapter');
    await new Promise(resolve=>setTimeout(resolve,100));
    const agent=ctx.agents.get(configured.sessionId);
    assert(agent.session.snapshotEvents().some(event=>event.type==='image/offload'),'Completed images must be offloaded');
    failVision=true;
    const badVision=await rpc('/followup',{...identity,message:'离线验证失败的图片',images:[{id:imageId}]},true);
    assert.equal(badVision.code,'INVALID_REQUEST');failVision=false;
    const textAfterVision=await rpc('/followup',{...identity,message:'异常图片之后继续文字'});
    assert.equal(textAfterVision.sessionId,configured.sessionId);assert.equal(textAfterVision.text,'SILENT');
    assert((await rpc('/compact',{conversationKey:key})).compacted);
    await rpc('/followup',{...identity,message:'压缩后测试消息'});
    session=(await rpc('/sessions')).sessions[0]; assert.equal(session.initializations,2);assert.equal(session.sessionId,configured.sessionId);
    // A real first turn with enabled extension instructions used to append a
    // user slot before DSH's protected system head. The mock previously hid it.
    fs.mkdirSync(path.join(fixture,'config'),{recursive:true});
    fs.writeFileSync(path.join(fixture,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{private:['123'],groups:[]},search:{enabled:true}}}));
    const searchIdentity={...identity,conversationKey:'wechat:private:123',conversationName:'空会话系统消息头验收'};
    const searchConfigured=await rpc('/configure',searchIdentity);
    assert.equal(ctx.agents.get(searchConfigured.sessionId).session.surface.nodes.length,0);
    await rpc('/followup',{...searchIdentity,message:'离线验证扩展首次写入，不实际联网，只输出 SILENT。'});
    const firstSurface=ctx.agents.get(searchConfigured.sessionId).session;
    assert.equal(firstSurface.eventAt(firstSurface.surface.nodes[0]).type,'system/message');
    assert.equal(firstSurface.surface.nodes.map(seq=>firstSurface.eventAt(seq)).filter(e=>e.data.source?.socialInstructionSlot==='extensions').length,1);
    const damagedIdentity={...identity,conversationKey:'wechat:private:456',conversationName:'旧错误历史的隔离恢复验收'};
    const damagedConfigured=await rpc('/configure',damagedIdentity);
    // Recreate the OLD early slot write in isolated offline data only.
    ctx.agents.get(damagedConfigured.sessionId).session.append('user/message',sdk.createUserMessage({content:[{type:'text',text:'旧版在 system head 之前写入的扩展说明'}],source:{kind:'wechat-social-bridge',socialInstructionSlot:'extensions'}}),{surfaceOp:'append'});
    await rpc('/followup',{...damagedIdentity,message:'生成旧顺序的离线历史，只输出 SILENT。'},true);
    await ctx.fiber.dispose();ctx=undefined;
    const files=[];const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else files.push(file);}};visit(home);
    const damagedLog=files.find(file=>file.includes(damagedConfigured.sessionId+path.sep)&&file.endsWith('session.v4.jsonl.zstd'));
    assert(damagedLog,'damaged fixture must have a real compressed history');
    const damagedHash=crypto.createHash('sha256').update(fs.readFileSync(damagedLog)).digest('hex');
    ctx=await boot.boot('WeChatAgent compatibility resume',configFile,[],undefined,pathToFileURL(path.join(source,'resources/app.asar/dsh/package.json')).href);
    ctx.llm.registerAdapter(['offline-test'],new Adapter());
    await rpc('/followup',{...identity,message:'重载运行时后的续聊测试'});
    session=(await rpc('/sessions')).sessions[0];assert.equal(session.sessionId,configured.sessionId);assert.equal(session.initializations,2);
    await rpc('/followup',{...searchIdentity,message:'重载真实压缩日志后继续，只输出 SILENT。'});
    assert.equal((await rpc('/sessions')).sessions.find(item=>item.conversationKey===searchIdentity.conversationKey).sessionId,searchConfigured.sessionId);
    const recoveredSession=await rpc('/configure',damagedIdentity);
    assert.notEqual(recoveredSession.sessionId,damagedConfigured.sessionId);
    assert.equal(recoveredSession.recovery.reason,'SYSTEM_HEAD_MISSING');assert.equal(recoveredSession.recovery.historyRestored,false);
    assert(fs.existsSync(path.join(fixture,recoveredSession.recovery.backup)));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(damagedLog)).digest('hex'),damagedHash);
    await rpc('/followup',{...damagedIdentity,message:'替代会话正常续聊，只输出 SILENT。'});
    await ctx.fiber.dispose();ctx=undefined;
    ctx=await boot.boot('WeChatAgent recovered history resume',configFile,[],undefined,pathToFileURL(path.join(source,'resources/app.asar/dsh/package.json')).href);
    ctx.llm.registerAdapter(['offline-test'],new Adapter());
    const continued=await rpc('/followup',{...damagedIdentity,message:'替代会话再次重启后继续，只输出 SILENT。'});
    assert.equal(continued.sessionId,recoveredSession.sessionId);
    fs.mkdirSync(path.join(fixture,'config'),{recursive:true});
    fs.writeFileSync(path.join(fixture,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{private:['321'],groups:[]}}}));
    const workspaceIdentity={...identity,conversationKey:'wechat:private:321',conversationName:'工作区移动验收'};
    readerConversationKey=workspaceIdentity.conversationKey;
    const workspaceSource=await rpc('/followup',{...workspaceIdentity,message:'需要保留的聊天事实：标识为 workspace-42。',images:[{id:imageId}]});
    const sourceAgent=ctx.agents.get(workspaceSource.sessionId),sourceEvents=sourceAgent.session.snapshotEvents();
    assert(sourceEvents.some(event=>event.type==='image/offload'));
    const workspaceList=await rpc('/session-groups');assert.equal(workspaceList.available,true);
    const workspacePath=path.join(fixture,'目标 工作区');fs.mkdirSync(workspacePath);
    const workspaceCreated=await rpc('/session-groups/create',{title:'聊天分组',path:workspacePath,revision:workspaceList.revision});
    const targetGroup=workspaceCreated.groups.find(item=>item.path===workspacePath);assert(targetGroup);
    const callsBeforeMove=calls.length;
    const workspaceMoved=await rpc('/session-groups/move',{conversationKey:workspaceIdentity.conversationKey,expectedSessionId:workspaceSource.sessionId,groupId:targetGroup.id,confirmed:true});
    assert(workspaceMoved.historyCopied);assert.notEqual(workspaceMoved.sessionId,workspaceSource.sessionId);assert.equal(calls.length,callsBeforeMove);
    const movedSession=ctx.agents.get(workspaceMoved.sessionId).session;
    assert.equal(movedSession.header.cwd,workspacePath);assert.equal(movedSession.header.parentSession,workspaceSource.sessionId);
    assert.deepEqual(movedSession.snapshotEvents().slice(0,sourceEvents.length),sourceEvents);
    assert.equal(movedSession.eventAt(movedSession.surface.nodes[0]).type,'system/message');
    assert(ctx.workspaceRegistry.get(targetGroup.id).sessionIds.includes(workspaceMoved.sessionId));assert(ctx.workspaceRegistry.archivedSessionIds.includes(workspaceSource.sessionId));
    await rpc('/followup',{...workspaceIdentity,message:'请承接刚才保存的聊天事实，只回复 SILENT。'});
    assert(JSON.stringify(calls.at(-1).messages).includes('workspace-42'));
    await ctx.fiber.dispose();ctx=undefined;
    ctx=await boot.boot('WeChatAgent workspace resume',configFile,[],undefined,pathToFileURL(path.join(source,'resources/app.asar/dsh/package.json')).href);
    ctx.llm.registerAdapter(['offline-test'],new Adapter());
    const workspaceResumed=await rpc('/followup',{...workspaceIdentity,message:'移动后的会话重启恢复验收，只回复 SILENT。'});
    assert.equal(workspaceResumed.sessionId,workspaceMoved.sessionId);
    assert.equal((await rpc('/sessions')).sessions.find(item=>item.conversationKey===workspaceIdentity.conversationKey).groupId,targetGroup.id);
    assert(JSON.stringify(calls.at(-1).messages).includes('workspace-42'));
    const result={dshVersion:actualVersion,realRuntime:true,model:'offline fixture adapter',workspaceCreation:true,workspaceHistoryMove:true,workspaceMoveNoModelCall:true,workspaceMovePersistedResume:true,workspaceOriginalArchived:true,sessionCreation:true,followup:true,persistedResume:true,emptySessionExtensionAdmission:true,extensionSessionPersistedResume:true,missingHeadAutoRecovery:true,damagedHistoryPreserved:true,imageAttachment:true,imageOffload:true,nativeCompaction:true,emptyTools:true,lateScopedToolIsolation:true,deferredOnlyFailureReproduced:true,legacyToolHistoryRecovered:true,codingToolsUnaffected:true,peerCompatibility:true,wechatMessagesSent:0};
    fs.writeFileSync(path.join(project,'state/dsh-020-runtime-verification.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {
    if(ctx)await ctx.fiber.dispose();
    if(reader)await new Promise(resolve=>reader.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
