import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DshPluginClient } from '../components/qq-bridge/src/dsh/plugin-client.js';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('search readiness rejects the legacy none-injecting plugin and accepts per-turn model defaults',async t=>{
  let health={ok:true,searchBudget:'bounded-summary-v1'};
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/health');assert.equal(req.headers.authorization,'Bearer fixture-token');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(health));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const client=new DshPluginClient({url:`http://127.0.0.1:${server.address().port}`,token:'fixture-token'});
  assert.equal(await client.searchReady(),false);health={ok:true,searchBudget:'per-turn-count-v1',searchReasoning:'model-default-v1'};client.searchHealthAt=0;
  assert.equal(await client.searchReady(),true);
  health={...health,searchTool:'model-search-v1',searchRoute:'dsh-native-first-v1'};client.searchHealthAt=0;assert.equal(await client.modelSearchReady(),false);
  health.searchRoute='dsh-native-only-v1';client.searchHealthAt=0;assert.equal(await client.modelSearchReady(),true);
  health.ok=false;client.searchHealthAt=0;assert.equal(await client.modelSearchReady(),false);
});

async function fixture(t, results) {
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer fixture-token');
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks)));
    const result=results[Math.min(requests.length-1,results.length-1)];
    res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const logs=[];
  return {requests,logs,client:new DshPluginClient({url:`http://127.0.0.1:${server.address().port}`,token:'fixture-token',timeoutMs:1000},line=>logs.push(line))};
}

test('reader preparation failure falls back once with explicit unavailable-image notice and preserves the safe cause',async t=>{
  const f=await fixture(t,[{status:503,body:{error:'agent_unavailable',detail:'IMAGE_READER_NOT_READY',imageError:'IMAGE_DEPENDENCY_MISSING'}},{status:200,body:{text:'RESPOND: fixture'}}]);
  const meta={images:[{id:'a'.repeat(64)}],batchId:'b'.repeat(64),persona:'fixture'};
  assert.equal(await f.client.followup('wechat:private:123','fixture text',meta),'RESPOND: fixture');
  assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1].images,[]);
  assert.notEqual(f.requests[1].batchId,meta.batchId);assert.match(f.requests[1].batchId,/^[a-f0-9]{64}$/);assert.equal(meta.images.length,1);
  assert.match(f.requests[1].message,/不得猜测/);assert.match(f.requests[1].message,/fixture text/);
  assert.equal(f.logs.length,1);
  assert.match(f.logs[0], /reason=IMAGE_DEPENDENCY_MISSING/);
});

test('missing image fallback cannot learn labels or reuse the image-bearing decision cache',async t=>{
  const f=await fixture(t,[{status:503,body:{error:'agent_unavailable',detail:'IMAGE_READER_NOT_READY'}},{status:200,body:{text:'RESPOND: 没能看到\nSTICKER_LABELS: [{"ref":"I1","description":"伪造描述","tags":[]}]'}}]);
  const meta={images:[{id:'a'.repeat(64)}],batchId:'b'.repeat(64)};
  assert.equal(await f.client.followup('wechat:private:123','fixture\n<sticker_label_request>learn labels</sticker_label_request>',meta),'RESPOND: 没能看到');
  assert(!f.requests[1].message.includes('<sticker_label_request>'));assert.notEqual(f.requests[1].batchId,meta.batchId);
});

test('binding, integrity and model-turn errors are never retried without images',async t=>{
  for(const failure of [{error:'agent_unavailable',detail:'IMAGE_CONVERSATION_MISMATCH'},{error:'agent_unavailable',detail:'IMAGE_INTEGRITY_FAILED'},{error:'turn_failed',detail:'IMAGE_READER_NOT_READY'}]){
    const f=await fixture(t,[{status:503,body:failure}]);
    await assert.rejects(f.client.followup('wechat:private:123','fixture',{images:[{id:'a'.repeat(64)}]}));
    assert.equal(f.requests.length,1);
  }
});

test('a failed text fallback is not retried in a loop',async t=>{
  const f=await fixture(t,[{status:503,body:{error:'agent_unavailable',detail:'IMAGE_READER_NOT_READY'}}]);
  await assert.rejects(f.client.followup('wechat:private:123','fixture',{images:[{id:'a'.repeat(64)}]}));
  assert.equal(f.requests.length,2);
});

test('safe lowercase lifecycle error codes are preserved for diagnosis',async t=>{
  for(const detail of ['session_busy','agent_timeout']){
    const f=await fixture(t,[{status:503,body:{error:'agent_unavailable',detail}}]);
    await assert.rejects(f.client.followup('wechat:private:123','fixture'),error=>error.message.includes(`(${detail})`));
  }
});

test('a rejected vision turn falls back once without repeating search tools and later chat text advances',async t=>{
  const f=await fixture(t,[{status:502,body:{error:'turn_failed',code:'INVALID_REQUEST'}},{status:200,body:{text:'RESPOND: 仍可文字聊天'}}]);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-vision-recovery-')),buffer=new MessageBuffer(path.join(dir,'buffer.json')),sent=[];
  const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,stickerPolicyFor:()=>({enabled:false}),decide:(...args)=>f.client.followup(...args),send:async(_target,text)=>{sent.push(text);}});
  t.after(()=>{engine.stop();assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const msg={platform:'wechat',kind:'private',conversation_id:'123',self_id:'99',sender_id:'123',message_id:'bad-image',text:'看图',timestamp:Date.now()/1000,images:[{id:'a'.repeat(64)}]};
  engine.receive(msg);for(let i=0;i<400&&buffer.unread('wechat:private:123').length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(sent.length,1);assert.deepEqual(f.requests.map(r=>r.images.length),[1,0]);assert.equal(f.requests[1].searchOptOut,true);assert.equal(f.requests[1].memeLibraryDisabled,true);
  engine.receive({...msg,message_id:'later-text',text:'还在吗',images:[]});for(let i=0;i<400&&sent.length<2;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(sent.length,2);assert.equal(buffer.unread('wechat:private:123').length,0);assert.equal(f.requests.length,3);assert.equal(engine.decisions.size,0);
});

test('a vision timeout waits briefly for cancellation and the text fallback never loops',async t=>{
  const f=await fixture(t,[{status:503,body:{error:'agent_unavailable',detail:'agent_timeout'}},{status:503,body:{error:'agent_unavailable',detail:'session_busy'}},{status:200,body:{text:'RESPOND: 已恢复'}}]);
  assert.equal(await f.client.followup('wechat:private:123','fixture',{images:[{id:'a'.repeat(64)}]}),'RESPOND: 已恢复');
  assert.deepEqual(f.requests.map(r=>r.images.length),[1,0,0]);
  const bad=await fixture(t,[{status:502,body:{error:'turn_failed',code:'INVALID_REQUEST'}}]);
  await assert.rejects(bad.client.followup('wechat:private:123','fixture',{images:[{id:'a'.repeat(64)}]}));assert.equal(bad.requests.length,2);
});
