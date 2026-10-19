import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createUpdateChecker,compareVersions} from './update-check.mjs';
const prefix='https://github.com/sourcepro5/WeChatAgent/releases/download/';
const release=(version,extra=[])=>({tag_name:'v'+version,assets:[{name:'WeChatAgent-Setup-'+version+'-x64.exe',state:'uploaded',browser_download_url:prefix+'v'+version+'/WeChatAgent-Setup-'+version+'-x64.exe'},...extra]});
function fixture(t,local={version:'0.3.2'},responses=[]){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-update-'));fs.writeFileSync(path.join(root,'deployment.json'),JSON.stringify(local));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0,clock=1000000;const checker=createUpdateChecker({root,now:()=>clock,fetchImpl:async()=>{calls++;const next=responses.shift();if(next instanceof Error)throw next;return new Response(JSON.stringify(next??release('0.3.2')),{status:200});}});return {checker,get calls(){return calls;},advance:ms=>{clock+=ms;}};}
test('startup update metadata detects a newer version with only official download links and caches checks',async t=>{
 const f=fixture(t,undefined,[release('0.3.3')]);const result=await f.checker.check();assert.equal(result.status,'available');assert.equal(result.latestVersion,'0.3.3');assert(result.downloadUrl.startsWith(prefix));
 await f.checker.check();await f.checker.check({force:true});assert.equal(f.calls,1);assert(compareVersions('0.3.10','0.3.2')>0);
});
test('equal and older releases, incomplete assets and external URLs do not offer a download',async t=>{
 for(const data of [release('0.3.2'),release('0.3.1'),{...release('0.3.3'),assets:[]},{...release('0.3.3'),assets:[{name:'WeChatAgent-Setup-0.3.3-x64.exe',state:'uploaded',browser_download_url:'https://evil.example/setup.exe'}]}]){
 const f=fixture(t,undefined,[data]),result=await f.checker.check();assert.equal(result.status,'up_to_date');assert.equal(result.downloadUrl,undefined);
 }
});
test('same-version rebuilt release is offered only for a different newer build',async t=>{
 const local={version:'0.3.2',buildId:'1111111111111111',builtAt:'2026-10-12T10:00:00Z'},verification={name:'VERIFICATION.json',state:'uploaded',browser_download_url:prefix+'v0.3.2/VERIFICATION.json'};
 for(const [builtAt,id,available]of [['2026-10-12T11:00:00Z','2222222222222222',true],['2026-10-12T09:00:00Z','2222222222222222',false],['2026-10-12T11:00:00Z',local.buildId,false]]) {
 const f=fixture(t,local,[release('0.3.2',[verification]),{version:'0.3.2',buildId:id,builtAt}]),result=await f.checker.check();assert.equal(result.status,available?'available':'up_to_date');assert.equal(result.sameVersionBuild,available);
 }
});
test('network and malformed release failures stay isolated from startup',async t=>{
 for(const response of [Error('offline'),{tag_name:'v0.3.3-rc.1',assets:[]},{...release('0.3.3'),draft:true}]) {const f=fixture(t,undefined,[response]);assert.equal((await f.checker.check()).status,'unavailable');}
});

test('fix release is newer than its base and keeps its suffix in official download URLs',async t=>{
 assert(compareVersions('0.3.7-fix','0.3.7')>0);assert(compareVersions('v0.3.7-fix','0.3.7-fix')===0);assert(compareVersions('0.3.8','0.3.7-fix')>0);
 const f=fixture(t,{version:'0.3.7'},[release('0.3.7-fix')]),result=await f.checker.check();
 assert.equal(result.status,'available');assert.equal(result.latestVersion,'0.3.7-fix');assert.equal(result.downloadUrl,prefix+'v0.3.7-fix/WeChatAgent-Setup-0.3.7-fix-x64.exe');
});

test('installed fix version remains identifiable and never offers a downgrade to the base',async t=>{
 for(const latest of ['0.3.7','0.3.7-fix','0.3.8']){
  const f=fixture(t,{version:'0.3.7-fix'},[release(latest)]),result=await f.checker.check();
  assert.equal(result.currentVersion,'0.3.7-fix');assert.equal(result.status,latest==='0.3.8'?'available':'up_to_date');
 }
});

test('same fix version can detect a later corrected build but still rejects draft and prerelease releases',async t=>{
 const local={version:'0.3.7-fix',buildId:'1111111111111111',builtAt:'2026-10-18T10:00:00Z'},verification={name:'VERIFICATION.json',state:'uploaded',browser_download_url:prefix+'v0.3.7-fix/VERIFICATION.json'};
 const f=fixture(t,local,[release('0.3.7-fix',[verification]),{...local,buildId:'2222222222222222',builtAt:'2026-10-19T10:00:00Z'}]);
 assert.equal((await f.checker.check()).status,'available');
 for(const flags of [{draft:true},{prerelease:true}]){const rejected=fixture(t,{version:'0.3.7'},[{...release('0.3.7-fix'),...flags}]);assert.equal((await rejected.checker.check()).status,'unavailable');}
});
