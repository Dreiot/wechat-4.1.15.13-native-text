import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import deployment from '../apps/console-desktop/deployment.cjs';import {runConsoleCommand,windowsPowerShellExecutable} from './console-process.mjs';
import {createConsole} from './console-server.mjs';
import crypto from 'node:crypto';import net from 'node:net';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wca-storage-runtime-'));t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});return root;}
test('automatically selected console ports are browser-accessible and remain loopback-only',async t=>{
 const root=fixture(t);
 for(let i=0;i<6;i++){const app=createConsole({root,port:0});try{const address=await app.start();assert(address.port>=20000&&address.port<60000);assert.equal(address.address,'127.0.0.1');const response=await fetch(`http://127.0.0.1:${address.port}/api/info`);assert.equal(response.status,200);}finally{app.server.closeAllConnections();if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));}}
});
test('an occupied automatic console port retries and serves the browser on another port',async t=>{
 const root=fixture(t),occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 const original=crypto.randomInt;let calls=0;t.mock.method(crypto,'randomInt',(...args)=>calls++===0?occupied.address().port:original(...args));
 const app=createConsole({root,port:0});try{const address=await app.start();assert(calls>=2);assert.notEqual(address.port,occupied.address().port);assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/info`)).status,200);}finally{app.server.closeAllConnections();if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));await new Promise(resolve=>occupied.close(resolve));}
});
test('new and upgraded bundled runtimes keep the selected DSH home and preserve an independent executable',async t=>{
 const base=fixture(t),resources=path.join(base,'app/resources'),home=path.join(base,'data');
 const write=(relative,value)=>{const file=path.join(resources,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
 const config=JSON.parse(fs.readFileSync(path.join(source,'config/wechatagent.example.json'),'utf8'));
 write('project/config/wechatagent.example.json',config);write('project/deployment.json',{version:'test-1',files:['config/wechatagent.example.json']});
 for(const file of ['runtime/python/python.exe','runtime/node.exe','vendor/dsh/DeepSeek Harness.exe','vendor/wechat/Weixin.exe','vendor/hook/version.dll'])write(file,'fixture');write('vendor/hook/build.json',{});
 const first=await deployment.bootstrapDeployment(resources,home),file=path.join(first.root,'config/distribution.json');assert.equal(JSON.parse(fs.readFileSync(file)).dshHome,path.join(home,'dsh'));
 const configFile=path.join(first.root,'config/wechatagent.json'),saved=JSON.parse(fs.readFileSync(configFile));saved.runtime.dshDesktop=path.join(base,'independent/Harness.exe');saved.wechat.whitelist.private=['123'];fs.writeFileSync(configFile,JSON.stringify(saved));
 write('project/deployment.json',{version:'test-2',files:['config/wechatagent.example.json']});await deployment.bootstrapDeployment(resources,home);
 assert.equal(JSON.parse(fs.readFileSync(file)).dshHome,path.join(home,'dsh'));assert.equal(JSON.parse(fs.readFileSync(file)).externalDshHome,process.env.DSH_HOME||path.join(os.homedir(),'.dsh'));assert.equal(JSON.parse(fs.readFileSync(configFile)).runtime.dshDesktop,saved.runtime.dshDesktop);assert.deepEqual(JSON.parse(fs.readFileSync(configFile)).wechat.whitelist.private,['123']);
});
test('only bundled DSH receives a data/cache override, and launching restores the parent environment',{skip:process.platform!=='win32'},async t=>{
 const root=fixture(t);for(const name of ['config','scripts','bundled','external'])fs.mkdirSync(path.join(root,name));
 fs.copyFileSync(path.join(source,'scripts/launch-dsh.ps1'),path.join(root,'scripts/launch-dsh.ps1'));
 for(const name of ['bundled','external'])fs.writeFileSync(path.join(root,name,'Harness.exe'),'fixture');
 const file=path.join(root,'probe.ps1');fs.writeFileSync(file,'\uFEFF'+String.raw`
$ErrorActionPreference='Stop'
$env:DSH_HOME='unchanged-parent-home'
$global:WcaStorageTestLaunches=@()
function Start-Process {param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle)
 $global:WcaStorageTestLaunches+=@{home=$env:DSH_HOME;args=$ArgumentList;file=$FilePath}
}
$taskRoot=$PSScriptRoot;$bundled=Join-Path $taskRoot 'bundled\Harness.exe';$external=Join-Path $taskRoot 'external\Harness.exe';$selectedDshHome=Join-Path $taskRoot 'selected data\dsh'
@{dsh=$bundled;dshHome=$selectedDshHome}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRoot 'config\distribution.json') -Encoding UTF8
foreach($exe in @($bundled,$external)){
 @{runtime=@{dshDesktop=$exe}}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRoot 'config\wechatagent.json') -Encoding UTF8
 & (Join-Path $taskRoot 'scripts\launch-dsh.ps1')
 if($env:DSH_HOME -ne 'unchanged-parent-home'){throw 'parent environment changed'}
}
if($global:WcaStorageTestLaunches.Count -ne 2 -or $global:WcaStorageTestLaunches[0].home -ne $selectedDshHome -or $global:WcaStorageTestLaunches[0].args -notmatch 'user-data-dir' -or $global:WcaStorageTestLaunches[1].home -ne 'unchanged-parent-home' -or $global:WcaStorageTestLaunches[1].args){$global:WcaStorageTestLaunches|ConvertTo-Json -Depth 4;throw 'launch isolation failed'}
'DSH storage launch isolation verified'
`);
 let output='';const code=await runConsoleCommand({exe:windowsPowerShellExecutable(),args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file]},chunk=>output+=chunk,{timeoutMs:15000});assert.equal(code,0,output);assert.match(output,/storage launch isolation verified/);
});
test('migration stops stale managed records using the new trusted manager without executing old scripts',{skip:process.platform!=='win32'},async t=>{
 const root=fixture(t);for(const dir of ['trusted','legacy/config','legacy/state','legacy/scripts'])fs.mkdirSync(path.join(root,dir),{recursive:true});
 for(const name of ['stop-legacy-services.ps1','manage.ps1'])fs.copyFileSync(path.join(source,'scripts',name),path.join(root,'trusted',name));
 fs.writeFileSync(path.join(root,'legacy/scripts/manage.ps1'),"throw 'Old source code must not execute'");fs.writeFileSync(path.join(root,'legacy/config/wechatagent.json'),JSON.stringify({runtime:{weflowMode:'nt'}}));
 fs.writeFileSync(path.join(root,'legacy/state/runtime.json'),JSON.stringify({reader:{pid:999999,exe:'fixture.exe',marker:'scripts/reader-api.py'}}));
 const file=path.join(root,'verify.ps1');fs.writeFileSync(file,'\uFEFF'+String.raw`
$ErrorActionPreference='Stop'
function Get-CimInstance {param($ClassName,$Filter);return $null}
function Stop-Process {throw 'No live processes may be stopped by this fixture'}
& (Join-Path $PSScriptRoot 'trusted\stop-legacy-services.ps1') -LegacyRoot (Join-Path $PSScriptRoot 'legacy')
$record=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'legacy\state\runtime.json') -Raw|ConvertFrom-Json
if($record.PSObject.Properties.Name -contains 'reader'){throw 'stale record retained'}
'Trusted legacy shutdown verified'
`);let output='';const code=await runConsoleCommand({exe:windowsPowerShellExecutable(),args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file]},chunk=>output+=chunk,{timeoutMs:15000});assert.equal(code,0,output);assert.match(output,/Trusted legacy shutdown verified/);
});
