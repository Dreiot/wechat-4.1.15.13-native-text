import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HookOneBot} from './hook-onebot.mjs';import {taskFailureMessage} from './console-process.mjs';
function fixture(t,fetchNative){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hook-startup-'));for(const dir of ['config','state/hook'])fs.mkdirSync(path.join(directory,dir),{recursive:true});
 fs.writeFileSync(path.join(directory,'config/wechatagent.json'),JSON.stringify({runtime:{sender:'wechat-hook',weflowMode:'nt'},hook:{baseUrl:'http://127.0.0.1:30001',expectedVersion:'4.1.10.27',requestTimeoutMs:20},wechat:{whitelist:{private:[],groups:[]}}}));
 fs.writeFileSync(path.join(directory,'state/wechat-io-config.json'),JSON.stringify({reader_base_url:'http://127.0.0.1:5031',reader_token:'fixture'}));fs.writeFileSync(path.join(directory,'state/hook/native-token.txt'),'c'.repeat(64));
 t.after(()=>{assert(directory.startsWith(os.tmpdir()+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const healthy={integration:'WeChatAgent-1',backend:'wechat-hook',version:'4.1.10.27',databaseAccounts:['wxid_fixture']};
 const adapter=new HookOneBot({directory,fetchImpl:async(url,init)=>url.includes('/api/v1/reader/status')?new Response(JSON.stringify({backend:'weflow-cli-nt',ownWxid:'wxid_fixture',accountDirectory:'wxid_fixture'})):fetchNative(healthy,init)});
 return adapter;
}
const refused=()=>{throw new TypeError('fetch failed',{cause:{code:'ECONNREFUSED'}});};
test('startup waits for a delayed native listener and verifies version/account once ready',async t=>{
 let calls=0,notifications=0;const adapter=fixture(t,async healthy=>++calls<4?refused():new Response(JSON.stringify(healthy)));
 await adapter.waitForNative({timeoutMs:300,intervalMs:1,onWaiting:()=>notifications++});assert.equal(calls,4);assert.equal(notifications,1);assert.equal(adapter.status.hook_account_verified,true);
});
test('missing initialization has a bounded, actionable startup error',async t=>{
 const adapter=fixture(t,refused);await assert.rejects(adapter.waitForNative({timeoutMs:5,intervalMs:1}),/HOOK_INITIALIZATION_TIMEOUT/);
 assert.match(taskFailureMessage('HOOK_INITIALIZATION_TIMEOUT',1),/hook-init.log/);
});
test('authentication, invalid response, version and account failures are not hidden by retries',async t=>{
 for(const [payload,expected]of [[new Response('{}',{status:401}),/API_HTTP_401/],[new Response('not json'),/HOOK_HEALTH_INVALID_RESPONSE/],[{version:'4.1.9.0'},/HOOK_VERSION_MISMATCH/],[{databaseAccounts:['other']},/HOOK_ACCOUNT_MISMATCH/],[{databaseAccounts:['old','wxid_fixture']},/HOOK_MULTIPLE_ACCOUNT_DATABASES/]]){
  let calls=0;const adapter=fixture(t,async healthy=>{calls++;return payload instanceof Response?payload:new Response(JSON.stringify({...healthy,...payload}));});
  await assert.rejects(adapter.waitForNative({timeoutMs:100,intervalMs:1}),expected);assert.equal(calls,1);
 }
});

test('startup waits for login without accepting a wrong or ambiguous account',async t=>{
 let calls=0;const adapter=fixture(t,async healthy=>new Response(JSON.stringify({...healthy,databaseAccounts:++calls<3?[]:healthy.databaseAccounts})));
 await adapter.waitForNative({timeoutMs:200,intervalMs:1});assert.equal(calls,3);assert.equal(adapter.status.hook_account_verified,true);
 const pending=fixture(t,async healthy=>new Response(JSON.stringify({...healthy,databaseAccounts:[]})));await assert.rejects(pending.waitForNative({timeoutMs:5,intervalMs:1}),/HOOK_LOGIN_REQUIRED/);assert.equal(pending.status.hook_account_verified,false);
});
test('login and repair messages distinguish a healthy client without an account from a failed sender',()=>{
 assert.match(taskFailureMessage('HOOK_LOGIN_REQUIRED',1),/完成登录/);
 assert.match(taskFailureMessage('WeChat-Hook check failed: HOOK_LOGIN_REQUIRED\nWeChat-Hook is not ready',1),/发送组件已连接/);
 assert.match(taskFailureMessage('HOOK_CLIENT_UNHEALTHY',1),/修复微信连接/);
 assert.match(taskFailureMessage('HOOK_COMPONENT_UPDATE_PENDING',1),/再次确认/);
});
test('health response timeout is distinct and recoverable while invalid wait options fail fast',async t=>{
 let calls=0;const adapter=fixture(t,async healthy=>{if(++calls===1)throw new DOMException('timeout','TimeoutError');return new Response(JSON.stringify(healthy));});
 await adapter.waitForNative({timeoutMs:100,intervalMs:1});assert.equal(calls,2);
 await assert.rejects(adapter.waitForNative({timeoutMs:Infinity}),/INVALID_HOOK_WAIT/);
 assert.match(taskFailureMessage('HOOK_HEALTH_TIMEOUT',1),/响应超时/);assert.match(taskFailureMessage('HOOK_HEALTH_INVALID_RESPONSE',1),/无效响应/);
});
