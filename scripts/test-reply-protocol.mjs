import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseSocialDecision,resolveSocialDecision,cleanReplyProtocol,hasReplyProtocolControl} from '../components/qq-bridge/src/core/decision-format.js';
import {MessageBuffer,replyDeliveryParts} from '../components/qq-bridge/src/core/message-buffer.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {ProactiveEngine} from '../components/qq-bridge/src/core/proactive-engine.js';
import {PROACTIVE_DEFAULTS} from '../components/qq-bridge/src/core/proactive-policy.js';
const key='wechat:private:123';
const message=(id='fixture',kind='private')=>({platform:'wechat',kind,conversation_id:'123',sender_id:'456',self_id:'99',message_id:id,text:'你好',direct_mention:true,timestamp:Date.now()/1000});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reply-protocol-'));t.after(()=>{assert(dir.startsWith(os.tmpdir()+path.sep));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});return {dir,buffer:new MessageBuffer(path.join(dir,'messages.json'))};}
async function until(check){for(let i=0;i<250;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('protocol fixture timeout');}

test('duplicate and per-line RESPOND envelopes are removed before replies are split into messages',()=>{
 for(const raw of ['RESPOND: RESPOND: 你好','RESPOND: respond：你好','respond: RESPOND: respond: 你好','RESPOND: \u200brespond\u200b:\ufeff你好','RESPOND:\nRESPOND:\n你好','```text\nRESPOND: respond: 你好\n```']){
  assert.deepEqual(parseSocialDecision(raw),{decision:'RESPOND',text:'你好'},raw);
 }
 const result=parseSocialDecision('RESPOND: respond: 第一段\n\nRESPOND：第二段\nrespond: 同一段续行');
 assert.deepEqual(result.textParts,['第一段','第二段\n同一段续行']);assert.equal(result.text,'第一段\n\n第二段\n同一段续行');assert.equal(cleanReplyProtocol(result.text),result.text);
});

test('normal English, inline quotations and closed code examples preserve their content',()=>{
 const bodies=['Please respond: hello','respond to this message','这里讨论 RESPOND: 的含义','`RESPOND:` 是一个标记','> RESPOND: 这是引用','Response: 保留普通内容','示例：\n```text\nRESPOND: 你好\n\nrespond: 第二行示例\n```'];
 for(const body of bodies){const result=parseSocialDecision('RESPOND: '+body);assert.equal(result.decision,'RESPOND');assert.equal(result.text,body);assert.equal(hasReplyProtocolControl(body),false);}
 assert.equal(parseSocialDecision('RESPOND: '+bodies.at(-1)).textParts,undefined,'Do not split a fenced example across messages');
});

test('normalizing envelopes preserves silence and bound sticker choices without accepting reasoning or unmarked prose',()=>{
 const id='a'.repeat(64);assert.equal(parseSocialDecision('RESPOND: respond: SILENT').decision,'SILENT');
 assert.deepEqual(parseSocialDecision('RESPOND: RESPOND: [STICKER:S1]',{S1:id}),{decision:'STICKER',stickerId:id,text:''});
 const caption=parseSocialDecision('RESPOND: respond: 早\nRESPOND: [STICKER:S1]',{S1:id},{allowStickerCaption:true});assert.equal(caption.text,'早');assert.equal(caption.stickerId,id);
 for(const raw of ['RESPOND:respond:<think>private</think>你好','RESPOND:respond:[S9]','没有协议的普通模型输出','RESPOND: '+ 'RESPOND: '.repeat(20)+'你好'])assert.equal(parseSocialDecision(raw).decision,'INVALID',raw);
});

test('ambiguous decorated headers receive only one bounded correction with a fresh deterministic repair identity',async()=>{
 const raw='RESPOND: **RESPOND:** 你好',metadata={batchId:'b'.repeat(64)};assert.equal(parseSocialDecision(raw).decision,'INVALID');
 const ids=[];let calls=0;
 for(let i=0;i<2;i++){
  const result=await resolveSocialDecision({rawOutput:raw,key,metadata,decide:async(_key,_prompt,options)=>{calls++;ids.push(options.batchId);return 'RESPOND: respond: 你好';}});assert.equal(result.result.text,'你好');
 }
 assert.equal(calls,2);assert.equal(ids[0],ids[1]);assert.notEqual(ids[0],metadata.batchId);
 let invalidCalls=0;const invalid=await resolveSocialDecision({rawOutput:raw,key,metadata,decide:async()=>{invalidCalls++;return raw;}});assert.equal(invalidCalls,1);assert.equal(invalid.result.decision,'INVALID');
});

test('private and group replies deliver cleaned bodies once and record only actual text',async t=>{
 for(const kind of ['private','group']){
  const f=fixture(t),sent=[];let calls=0;
  const engine=new SocialEngine({buffer:f.buffer,batchMs:1,minIntervalMs:0,privateMinIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:1000,decide:async()=>{calls++;return 'RESPOND: respond: 第一段\n\nRESPOND: 第二段';},send:async(_target,text)=>{sent.push(text);return{delivered:'database-confirmed'};}});t.after(()=>engine.stop());
  const msg=message(kind,kind),chat='wechat:'+kind+':123';engine.receive(msg);await until(()=>f.buffer.unread(chat).length===0&&!engine.running.has(chat));
  assert.deepEqual(sent,['第一段','第二段']);assert.equal(calls,1);assert.deepEqual(f.buffer.recent(chat).filter(row=>row.outgoing).map(row=>row.text),sent);
 }
});

test('an old queued protocol prefix is cancelled without changing confirmed history or blocking new messages',async t=>{
 const f=fixture(t),msg=message(),sent=[];let calls=0;f.buffer.append(msg);const throughId=f.buffer.unread(key)[0].id,deliveryId='c'.repeat(64);
 const result={decision:'RESPOND',text:'已确认第一段\n\nRESPOND: 旧的第二段',textParts:['已确认第一段','RESPOND: 旧的第二段']},parts=replyDeliveryParts(result,deliveryId);parts[0].state='confirmed';
 f.buffer.recordReplyPart(key,{deliveryId:parts[0].deliveryId},{...msg,text:'已确认第一段',delivery_status:'confirmed',timestamp:Date.now()/1000});
 f.buffer.rememberReply(key,{result,parts,throughId,deliveryId,message:msg,sending:true});
 const restored=new MessageBuffer(path.join(f.dir,'messages.json')),engine=new SocialEngine({buffer:restored,batchMs:1,privateMinIntervalMs:0,maxPerMinute:100,decide:async()=>{calls++;return 'RESPOND: respond: 新回复';},send:async(_target,text)=>{sent.push(text);return{delivered:'database-confirmed'};}});t.after(()=>engine.stop());
 engine.replay(key);await until(()=>restored.pendingReplies.size===0&&restored.unread(key).length===0&&!engine.running.has(key));assert.deepEqual(sent,[]);assert.equal(calls,0);assert.match(restored.contextNotices.get(key).text,/协议/);
 assert.deepEqual(restored.recent(key).filter(row=>row.outgoing).map(row=>row.text),['已确认第一段']);
 engine.receive(message('after-restart'));await until(()=>sent.length===1&&restored.unread(key).length===0);assert.deepEqual(sent,['新回复']);assert.equal(calls,1);
 assert.equal(restored.recent(key).filter(row=>row.outgoing&&row.text==='已确认第一段').length,1);
});

test('proactive greetings normalize protocol without changing the existing message layout',async t=>{
 const f=fixture(t),sent=[];let now=Date.parse('2026-10-19T02:00:00Z'),calls=0;
 const settings={wechat:{whitelist:{private:['123'],groups:[]},proactive:{...PROACTIVE_DEFAULTS,enabled:true,mode:'greeting',intervalMinutes:30,idleMinutes:5,jitterMinutes:0,chats:{[key]:true}}}};
 const social=new SocialEngine({buffer:f.buffer,decide:async()=> 'SILENT',send:async()=>{throw Error('No unrelated sends');}});t.after(()=>social.stop());
 const proactive=new ProactiveEngine({stateFile:path.join(f.dir,'proactive.json'),buffer:f.buffer,social,settingsFor:()=>settings,personaFor:()=>({persona:'offline fixture persona',personaName:'Fixture'}),selfIdFor:()=> '99',now:()=>now,random:()=>0,decide:async()=>{calls++;return 'RESPOND: respond: 早\n\nRESPOND: 今天好好聊';},send:async(_target,text)=>{sent.push(text);return{delivered:'database-confirmed'};}});
 await proactive.tick();now+=30*60000;await proactive.tick();assert.equal(calls,1);assert.equal(sent.join('\n\n'),'早\n\n今天好好聊');assert(sent.every(text=>!hasReplyProtocolControl(text)));
});

test('a legacy proactive draft containing a protocol marker is cancelled on restart',async t=>{
 const f=fixture(t),sent=[];let now=Date.parse('2026-10-19T02:00:00Z'),calls=0;
 const settings={wechat:{whitelist:{private:['123'],groups:[]},proactive:{...PROACTIVE_DEFAULTS,enabled:true,mode:'greeting',intervalMinutes:30,idleMinutes:5,jitterMinutes:0,chats:{[key]:true}}}};
 const social=new SocialEngine({buffer:f.buffer,decide:async()=> 'SILENT',send:async()=>{throw Error('No unrelated sends');}});t.after(()=>social.stop());
 const stateFile=path.join(f.dir,'proactive.json'),make=()=>new ProactiveEngine({stateFile,buffer:f.buffer,social,settingsFor:()=>settings,personaFor:()=>({persona:'offline fixture persona',personaName:'Fixture'}),selfIdFor:()=> '99',now:()=>now,random:()=>0,decide:async()=>{calls++;return 'RESPOND: 早';},send:async()=>{throw Object.assign(Error('fixture busy'),{code:'SENDER_BUSY'});}});
 const proactive=make();await proactive.tick();now+=30*60000;await proactive.tick();assert.equal(calls,1);assert(proactive.state.chats[key].job);
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.chats[key].job.text='RESPOND: 旧草稿';fs.writeFileSync(stateFile,JSON.stringify(state));
 const restored=make();restored.send=async(_target,text)=>sent.push(text);await restored.tick();await restored.tick();
 assert.deepEqual(sent,[]);assert.equal(calls,1);assert.equal(restored.state.chats[key].job,null);assert(f.buffer.contextNotices.has(key));assert.equal(f.buffer.recent(key).filter(row=>row.outgoing).length,0);
});
