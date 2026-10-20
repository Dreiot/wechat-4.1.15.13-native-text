import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createProcessRecovery,startupConflictPorts} from './process-recovery.mjs';
import {dshConfigurationMatches} from './dsh-configuration.mjs';

const config={ports:{weflow:5031,onebot:11229,adapter:8766,dshPlugin:11230},hook:{baseUrl:'http://127.0.0.1:30001',wechatExecutable:'state/hook/Weixin.exe'},dsh:{provider:'fixture',model:'fixture-model'}};
const item={pid:333,name:'node.exe',path:'E:/fixture/node.exe',start:'100',commandHash:'fixture-command',ports:[5031],reason:'占用读取端口',canStop:true};
test('startup conflicts override stale healthy port caches only for configured ports',()=>{
 assert.deepEqual(startupConflictPorts('Adapter startup failed: ADAPTER_PORT_IN_USE stage=adapter-port-bind port=8766 system=EADDRINUSE\nSERVICE_PORT_OWNER_MISMATCH service=reader port=5031 owners=33\nSERVICE_PORT_IN_USE port=9999 owners=1',[5031,8766]),[8766,5031]);
 assert.deepEqual(startupConflictPorts('READER_CONNECTION_RESET port=5031\nchat contains port=8766',[5031,8766]),[]);
});
function fixture(){let items=[{...item}],time=1000;const stopped=[];const recovery=createProcessRecovery({root:process.cwd(),now:()=>time,probe:async()=>({items}),stop:async request=>{stopped.push(request);return {stopped:request.items.map(item=>item.pid)};}});return {recovery,stopped,setItems:next=>{items=next;},expire:()=>{time+=120001;}};}

test('inspection and first confirmation never stop a process; final confirmation is explicit and single-use',async()=>{
  const f=fixture(),scan=await f.recovery.scan(config,'revision');assert.equal(f.stopped.length,0);assert.equal(scan.items[0].commandHash,undefined);
  const prepared=await f.recovery.prepare(scan.scanId,[scan.items[0].id],'revision');assert.equal(f.stopped.length,0);
  await assert.rejects(f.recovery.stop(prepared.confirmation,false,'revision'),/确认/);assert.equal(f.stopped.length,0);
  assert.deepEqual((await f.recovery.stop(prepared.confirmation,true,'revision')).stopped,[333]);assert.equal(f.stopped.length,1);
  await assert.rejects(f.recovery.stop(prepared.confirmation,true,'revision'),/确认/);assert.equal(f.stopped.length,1);
});
test('reused PIDs, changed executables, commands, port owners and permissions are rejected before termination',async()=>{
  for(const update of [{start:'101'},{path:'E:/other.exe'},{commandHash:'different'},{ports:[8766]},{canStop:false}]){
    const f=fixture(),scan=await f.recovery.scan(config,'r'),prepared=await f.recovery.prepare(scan.scanId,[scan.items[0].id],'r');f.setItems([{...item,...update}]);
    await assert.rejects(f.recovery.stop(prepared.confirmation,true,'r'),/变化/);assert.equal(f.stopped.length,0);
  }
});
test('blocked, arbitrary and duplicate selections, expired inspections and changed settings cannot authorize termination',async()=>{
  const f=fixture();f.setItems([{...item,canStop:false}]);const scan=await f.recovery.scan(config,'r');
  for(const ids of [[scan.items[0].id],['333'],[],[scan.items[0].id,scan.items[0].id]])await assert.rejects(f.recovery.prepare(scan.scanId,ids,'r'));
  f.setItems([item]);const next=await f.recovery.scan(config,'r'),prepared=await f.recovery.prepare(next.scanId,[next.items[0].id],'r');
  await assert.rejects(f.recovery.stop(prepared.confirmation,true,'new-revision'),/配置/);f.expire();
  await assert.rejects(f.recovery.prepare(next.scanId,[next.items[0].id],'r'));await assert.rejects(f.recovery.stop(prepared.confirmation,true,'r'));assert.equal(f.stopped.length,0);
});
test('stopping selected conflicts never adds unselected processes',async()=>{
  const f=fixture();f.setItems([item,{...item,pid:444,start:'200',ports:[11230]}]);const scan=await f.recovery.scan(config,'r');
  const prepared=await f.recovery.prepare(scan.scanId,[scan.items[1].id],'r');await f.recovery.stop(prepared.confirmation,true,'r');assert.deepEqual(f.stopped[0].items.map(item=>item.pid),[444]);
});
test('DSH restart verification requires the actual project, model, plugin revision and selected account',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-dsh-revision-'));t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'packages/dsh-social-bridge-plugin'),{recursive:true});fs.mkdirSync(path.join(root,'state/weflow'),{recursive:true});
  fs.writeFileSync(path.join(root,'packages/dsh-social-bridge-plugin/cordis.patch.yml'),'name: file:///fixture/native-context.mjs?wechatagent=aaaaaaaaaaaaaaaa');
  fs.writeFileSync(path.join(root,'state/weflow/active-account.json'),JSON.stringify({id:'account-a'}));
  const health={ok:true,project:'WeChatAgent',projectRoot:root,provider:'fixture',model:'fixture-model',pluginRevision:'aaaaaaaaaaaaaaaa',accountScope:'account-a'};
  assert(dshConfigurationMatches(root,config,health));
  for(const change of [{ok:false},{projectRoot:root+'-other'},{provider:'other'},{model:'old-model'},{pluginRevision:'bbbbbbbbbbbbbbbb'},{accountScope:'account-b'}])assert.equal(dshConfigurationMatches(root,config,{...health,...change}),false);
});
