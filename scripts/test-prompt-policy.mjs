import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {dedupePreviousReply,cleanChatPrompt,stableChatInstructions,CHAT_MESSAGE_LAYOUT_NOTICE,SOCIAL_PROTOCOL_NOTICE} from '../packages/dsh-social-bridge-plugin/prompt-context.mjs';
import {modelSearchInstructions,createModelSearchTurn} from '../packages/dsh-social-bridge-plugin/model-search.mjs';
import {webReaderInstructions,createWebReaderTurn} from '../packages/dsh-social-bridge-plugin/web-reader.mjs';
import {buildPrivatePrompt} from '../components/qq-bridge/src/core/social-engine.js';
import {buildProactivePrompt} from '../components/qq-bridge/src/core/proactive-engine.js';
import {resolveSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
const key='wechat:private:123',source={kind:'wechat-social-bridge',form:'relay'};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-prompt-policy-'));t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{private:['123'],groups:[]},search:{enabled:true}}}));return root;}
const sessionFor=(text,extra={})=>{const event={seq:1,type:'assistant/message',data:{message:{content:[{type:'text',text}],...extra}}};return{surface:{nodes:[1]},snapshotEvents:()=>[event]};};
function incoming(previous='原回复<&>',status='confirmed'){return{content:[{type:'text',text:buildPrivatePrompt({key,previousReply:{text:previous,delivery_status:status},rows:[{sender_id:'456',text:'引用 <previous_reply> 保留，接着说',timestamp:0}]} )},{type:'image',attachmentId:'fixture'}],source};}

test('confirmed reply echoes are omitted only when the exact latest native answer is still effective',()=>{
 const session=sessionFor('RESPOND: 原回复<&>'),message=incoming(),before=JSON.stringify(session.snapshotEvents()),result=dedupePreviousReply(session,message);
 assert(!result.content[0].text.includes('上一条已发送的 AI 回复'));assert(result.content[0].text.includes('引用 &lt;previous_reply&gt; 保留，接着说'));assert.equal(result.content[1],message.content[1]);assert.equal(message.content[0].text.includes('<previous_reply>'),true);assert.equal(JSON.stringify(session.snapshotEvents()),before);
});

test('missing history, unconfirmed delivery, rewritten output, partial messages and tool commentary retain the echo',()=>{
 const cases=[
  [sessionFor('RESPOND: 原回复<&>'),incoming('原回复<&>','unconfirmed')],
  [sessionFor('RESPOND: 模型草稿'),incoming('实际发送的不同文本')],
  [sessionFor('RESPOND: 第一条\n\n第二条'),incoming('第二条')],
  [sessionFor('RESPOND: 原回复<&>',{toolCalls:[{}]}),incoming()],
  [sessionFor('RESPOND: 原回复<&>\nSTICKER_LABELS: []'),incoming()],
  [sessionFor('SILENT'),incoming()],
  [{surface:{nodes:[]},snapshotEvents:()=>[]},incoming()],
 ];
 for(const [session,message]of cases)assert.equal(dedupePreviousReply(session,message),message);
 const foreign={...incoming(),source:{kind:'other'}};assert.equal(dedupePreviousReply(sessionFor('RESPOND: 原回复<&>'),foreign),foreign);
});

test('old protocol tails migrate without stripping the same words from actual chat or quotations',()=>{
 const old='先承接前文和自己上一句，理解“那个”“不行”“你要问”等省略表达的对象；前文明确时直接接话。简短和玩梗不能压过事实与前后连贯；自己说错就简短承认并纠正。正常追问、接话和纠正事实不是修改人格。';
 const raw='新的微信好友私聊消息。\n<untrusted_chat>用户引用：'+old+'\n</untrusted_chat>\n'+old+'\n'+SOCIAL_PROTOCOL_NOTICE;
 const result=cleanChatPrompt(raw);assert.equal(result.split(old).length-1,1);assert(!result.includes(SOCIAL_PROTOCOL_NOTICE));assert.equal(cleanChatPrompt(result),result);assert.equal(cleanChatPrompt('用户贴的原文：'+old), '用户贴的原文：'+old);
});

test('autonomous search retains concise stable guidance with no URL or keyword gate',t=>{
 const root=fixture(t),turn=createModelSearchTurn();const text=modelSearchInstructions(root,key,turn);
 assert(text.includes('web_search'));assert(text.includes('城市'));assert(text.includes('凭据'));assert([...text].length<550);
 assert.equal(modelSearchInstructions(root,key,{...turn,optOut:true}),'');assert.equal(modelSearchInstructions(root,'wechat:private:999',turn),'');
});

test('web reading adds site rules only for the actual allowed source domains',t=>{
 const root=fixture(t),read=urls=>webReaderInstructions(root,key,createWebReaderTurn(urls));
 const plain=read('https://example.com/article');assert([...plain].length<450);assert(!plain.includes('女娲石'));assert(!plain.includes('video_page_text'));
 const quotes=read('https://zxsj-tools.cn/yinliang.html');assert(quotes.includes('coin: "nws"'));assert(quotes.includes('selection_required'));assert(quotes.includes('元/万银'));assert(!quotes.includes('video_page_text'));
 for(const url of ['https://www.bilibili.com/video/fixture','https://b23.tv/fixture'])assert(read(url).includes('video_page_text'));
 const mixed=read('https://zxsj-tools.cn/yinliang.html https://b23.tv/fixture');assert.equal(mixed.split('## 诛仙世界工具站行情').length-1,1);assert.equal(mixed.split('## Bilibili 页面').length-1,1);
 assert.equal(webReaderInstructions(root,key,createWebReaderTurn('你好')),'');assert(!read('https://example.com/bilibili.com').includes('video_page_text'));
});

test('system preset defers message count to the selected layout and proactive guidance stays bounded',t=>{
 const root=fixture(t),provider=path.join(root,'packages/native-features/plugins/native-reply-layout');fs.mkdirSync(provider,{recursive:true});fs.writeFileSync(path.join(provider,'index.js'),'// fixture');
 const stable=stableChatInstructions(root,key);assert.equal(stable.split(CHAT_MESSAGE_LAYOUT_NOTICE).length-1,1);assert.equal(stable.split(SOCIAL_PROTOCOL_NOTICE).length-1,1);
 const preset=fs.readFileSync(new URL('../packages/dsh-social-bridge-plugin/cordis.patch.yml',import.meta.url),'utf8').match(/prefix: >-\r?\n\s+([^\r\n]+)/)?.[1];assert(preset);assert(!preset.includes('一条短消息'));assert(preset.includes('只调用本轮实际授权的工具'));
 const proactive=buildProactivePrompt({key,rows:[],mode:'greeting',now:Date.parse('2026-10-19T02:00:00Z')});assert([...proactive].length<600);assert(proactive.includes('不追问近况'));assert(proactive.includes('本轮不需要联网'));assert(!proactive.includes('最多一句简短文字'));
});

test('one format repair never duplicates layout guidance and honours a disabled layout',async()=>{
 for(const allowTextParts of [true,false]){let prompt;const result=await resolveSocialDecision({rawOutput:'invalid fixture',key,metadata:{},allowTextParts,decide:async(_key,value)=>{prompt=value;return 'RESPOND: 正常回复';}});assert.equal(result.result.text,'正常回复');assert(prompt.split(CHAT_MESSAGE_LAYOUT_NOTICE).length-1<=(allowTextParts?1:0));assert.equal(prompt.split(SOCIAL_PROTOCOL_NOTICE).length-1,1);}
});
