import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createConsole} from './console-server.mjs';
test('repair API scopes process termination to the configured client and requires a single-use second confirmation',async t=>{
 const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'hook-repair-api-'));
 fs.mkdirSync(path.join(root,'config'));const config=JSON.parse(fs.readFileSync(path.join(source,'config/wechatagent.example.json'),'utf8'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify(config));
 const probes=[],stops=[];
 const app=createConsole({root,port:0,runner:async()=>{throw Error('No real commands allowed');},fetchImpl:async()=>{throw Error('No production API requests allowed');},processProbe:async input=>{probes.push(input);return{items:[{pid:777,name:'Weixin.exe',path:input.wechatExecutable,start:'123',commandHash:'fixture',ports:[],canStop:true},{pid:778,name:'Weixin.exe',path:'C:/unrelated/Weixin.exe',start:'124',commandHash:'fixture',ports:[],canStop:true}]};},processStop:async input=>{stops.push(input);return{stopped:input.items.map(i=>i.pid)};}});
 t.after(async()=>{app.server.closeAllConnections();if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const address=await app.start(),base=`http://127.0.0.1:${address.port}`,info=await(await fetch(base+'/api/info')).json();
 const api=async(route,body)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'X-Console-Token':info.token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json()};};
 const scan=await api('/api/process-recovery?purpose=hook-repair');assert.equal(scan.status,200);assert.equal(scan.body.purpose,'hook-repair');assert.equal(scan.body.items.length,1);assert.deepEqual(probes[0].ports,[]);assert.equal(probes[0].matchingWeChatOnly,true);assert.equal(probes[0].includeMatchingWeChat,true);assert.equal(stops.length,0);
 const prepared=await api('/api/process-recovery/prepare',{scanId:scan.body.scanId,ids:[scan.body.items[0].id]});assert.equal(prepared.status,200);assert.equal(stops.length,0);
 const request={confirmation:prepared.body.confirmation};assert.equal((await api('/api/process-recovery/stop',request)).status,409);assert.equal(stops.length,0);
 assert.equal((await api('/api/process-recovery/stop',{...request,confirmed:true})).status,200);assert.equal(stops.length,1);assert.deepEqual(stops[0].items.map(i=>i.pid),[777]);
 assert.equal((await api('/api/process-recovery/stop',{...request,confirmed:true})).status,409);assert.equal(stops.length,1);
});
