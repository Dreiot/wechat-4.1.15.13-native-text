import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {MessageBuffer} from '../components/qq-bridge/src/core/message-buffer.js';

const key='wechat:private:123',id='a'.repeat(64);
const message=n=>({platform:'wechat',kind:'private',conversation_id:'123',self_id:'99',sender_id:'123',message_id:n,text:n,timestamp:Date.now()/1000});
async function until(check){for(let i=0;i<400;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('media fixture timeout');}
function fixture(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-media-lane-')),file=path.join(root,'messages.json'),sent=[],engines=[];let calls=0;
  const make=()=>{const buffer=new MessageBuffer(file);const engine=new SocialEngine({buffer,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,
    deliveryRetry:{mediaDeadlineMs:5000,mediaCallTimeoutMs:40,receiptDelayMs:5,busyDelayMs:5},
    stickerChoicesFor:async()=>[{id,description:'测试图',tags:['测试']}],
    decide:async()=>++calls===1?'RESPOND: 第一轮\n[STICKER:S1]':'RESPOND: 后续文字',send:async(_target,text)=>{sent.push(text);},
    sendSticker:(...args)=>args[2]?.abandon?Promise.resolve({released:true}):(options.sendSticker??(()=>new Promise(()=>{})))(...args)});engines.push(engine);return engine;};
  t.after(()=>{for(const e of engines)e.stop();assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {make,file,sent,get calls(){return calls;}};
}
test('a permanently hung sticker RPC never blocks later text in the same conversation',async t=>{
  let submissions=0,checks=0,late;
  const f=fixture(t,{sendSticker:(_target,_id,meta)=>{if(meta.receiptOnly){checks++;return new Promise(()=>{});}submissions++;return new Promise(resolve=>{late=resolve;});}}),e=f.make();
  e.receive(message('first'));await until(()=>submissions===1);
  e.receive(message('second'));await until(()=>f.sent.includes('后续文字'));
  assert.equal(f.calls,2);assert.equal(submissions,1);
  await until(()=>e.buffer.mediaReplies.size===0);assert.equal(checks,2);
  late({delivered:'database-confirmed'});await new Promise(r=>setTimeout(r,20));
  assert.equal(e.buffer.recent(key).filter(r=>r.outgoing&&r.sticker_id).length,1);
  assert.equal(e.buffer.recent(key).find(r=>r.sticker_id).delivery_status,'unconfirmed');
  assert.equal(e.running.size,0);assert.equal(e.buffer.pendingReplies.size,0);
});
test('restarting during submission resumes receipt-only and keeps the same chat usable',async t=>{
  let submissions=0,checks=0;
  const f=fixture(t,{sendSticker:async(_target,_id,meta)=>{if(meta.receiptOnly){checks++;return {delivered:'database-confirmed'};}submissions++;return new Promise(()=>{});}}),old=f.make();
  old.receive(message('first'));await until(()=>submissions===1);old.stop();
  const restored=f.make();restored.receive(message('after-restart'));
  await until(()=>f.sent.includes('后续文字')&&checks===1&&restored.buffer.mediaReplies.size===0);
  assert.equal(submissions,1);assert.equal(f.sent.filter(x=>x==='第一轮').length,1);
});
test('expired media is removed after restart without resubmitting or delaying text',async t=>{
  let submissions=0;
  const f=fixture(t,{sendSticker:()=>{submissions++;return new Promise(()=>{});}}),old=f.make();
  old.receive(message('first'));await until(()=>submissions===1);old.stop();
  const saved=JSON.parse(fs.readFileSync(f.file,'utf8'));for(const item of Object.values(saved.mediaReplies)){item.createdAt=Date.now()-1000;item.expiresAt=Date.now()-500;}
  fs.writeFileSync(f.file,JSON.stringify(saved));const restored=f.make();restored.receive(message('after-expiry'));
  await until(()=>f.sent.includes('后续文字')&&restored.buffer.mediaReplies.size===0);assert.equal(submissions,1);
});
test('a pure text turn never attaches unlabeled library candidates for synchronous recognition',async t=>{
  const f=fixture(t),e=f.make();e.stickerChoicesFor=async()=>[{id}];let images;
  e.decide=async(_key,_prompt,metadata)=>{images=metadata.images;return 'RESPOND: 文字';};
  e.receive(message('text-only'));await until(()=>f.sent.length===1);assert.deepEqual(images,[]);
});
