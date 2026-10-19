import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {runConsoleCommand,windowsPowerShellExecutable} from './console-process.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('launcher health waits through a process handoff, accepts pre-login health and rejects dead or foreign senders',{skip:process.platform!=='win32'},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hook-client-health-'));
 t.after(()=>{assert(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'probe.ps1'),token=path.join(dir,'token.txt');fs.writeFileSync(token,'a'.repeat(64));
 fs.writeFileSync(file,'\uFEFF'+String.raw`
param([string]$Helper,[string]$TokenFile)
$ErrorActionPreference='Stop'
. $Helper
$script:probes=0;$script:mode='handoff'
function Get-CimInstance {
 param($ClassName,$Filter)
 $script:probes++
 if($script:mode -eq 'handoff' -and $script:probes -le 2){return}
 [pscustomobject]@{ExecutablePath='C:\fixture\Weixin.exe';ProcessId=5678;CommandLine='Weixin.exe'}
}
function Invoke-RestMethod {
 param($Uri,$Headers,$TimeoutSec)
 if($Headers.Authorization -ne ('Bearer '+('a'*64))){throw 'token not supplied'}
 if($script:mode -eq 'dead'){throw 'connection refused'}
 if($script:mode -eq 'handoff' -and $script:probes -le 2){throw 'connection refused'}
 [pscustomobject]@{integration='WeChatAgent-1';backend='wechat-hook';version='4.1.10.27';startupState='ready';pid=$(if($script:mode -eq 'foreign'){9999}else{5678});databaseAccounts=@()}
}
Wait-HookClient 'C:\fixture\Weixin.exe' 'http://127.0.0.1:30001' '4.1.10.27' $TokenFile 3
if($script:probes -lt 3){throw 'handoff not observed'}
$script:mode='dead';$failed=$false
try{Wait-HookClient 'C:\fixture\Weixin.exe' 'http://127.0.0.1:30001' '4.1.10.27' $TokenFile 1}catch{if($_.Exception.Message -notmatch 'HOOK_CLIENT_UNHEALTHY'){throw};$failed=$true}
if(-not $failed){throw 'existing but dead sender was accepted'}
$script:mode='foreign';$failed=$false
try{Wait-HookClient 'C:\fixture\Weixin.exe' 'http://127.0.0.1:30001' '4.1.10.27' $TokenFile 1}catch{if($_.Exception.Message -notmatch 'HOOK_PORT_OWNER_MISMATCH'){throw};$failed=$true}
if(-not $failed){throw 'foreign sender was accepted'}
'Hook client health regression passed'
`);
 let output='';const code=await runConsoleCommand({exe:windowsPowerShellExecutable(),args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,'-Helper',path.join(root,'scripts/hook-client-health.ps1'),'-TokenFile',token]},chunk=>output+=chunk,{timeoutMs:15000});
 assert.equal(code,0,output);assert.match(output,/health regression passed/);
});
