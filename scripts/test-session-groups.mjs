import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createSessionGroups} from '../packages/dsh-social-bridge-plugin/session-groups.mjs';
import {createSessionGroupUI} from '../public/console/session-groups.js';
import {createConsole} from './console-server.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wca-session-groups-'));t.after(()=>{assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});return root;}
test('DSH groups reuse existing directories, serialize revisions, rename and only remove empty registrations',async t=>{
  const root=fixture(t),groups=new Map();let ready=true,index=0,deleted=[];
  const registry={list:()=>[...groups.values()],get:id=>groups.get(id),archivedSessionIds:['old-backup'],resolveByPath:async file=>[...groups.values()].find(group=>group.path===file),create:async(file,title)=>{const item={id:'group-'+(++index),path:file,title,sessionIds:[],setTitle:async name=>{item.title=name;}};groups.set(item.id,item);return item;},delete:async id=>{deleted.push(id);groups.delete(id);}};
  const manager=createSessionGroups({ctx:{get:()=>registry},root,isAllowed:()=>ready,move:()=>{throw Error('not a model tool');}});
  const first=await manager.run('create',{revision:manager.snapshot().revision,title:'日常聊天',path:root});assert.equal(first.groups[0].title,'日常聊天');
  const reused=await manager.run('create',{revision:first.revision,title:'另一个名字',path:root});assert(reused.reused);assert.equal(groups.size,1);assert.equal(reused.groups[0].title,'日常聊天');
  await assert.rejects(manager.run('rename',{groupId:'group-1',title:'新名字',revision:'stale'}),/CHANGED/);
  const renamed=await manager.run('rename',{groupId:'group-1',title:'朋友',revision:manager.snapshot().revision});assert.equal(renamed.groups[0].title,'朋友');
  groups.get('group-1').sessionIds=['another-persons-dsh-session'];
  await assert.rejects(manager.run('delete',{groupId:'group-1',confirmed:true,revision:manager.snapshot().revision}),/NOT_EMPTY/);assert.deepEqual(deleted,[]);
  groups.get('group-1').sessionIds=['old-backup'];assert.deepEqual(manager.snapshot().groups[0].sessionIds,[]);
  await manager.run('delete',{groupId:'group-1',confirmed:true,revision:manager.snapshot().revision});assert.deepEqual(deleted,['group-1']);assert(fs.existsSync(root));
  ready=false;assert.throws(()=>manager.snapshot(),/ACCOUNT_CHANGED/);
});
test('group mutations reject invalid names, missing paths, unapproved chats and unavailable DSH services',async t=>{
  const root=fixture(t);fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{private:['123'],groups:[]}}}));
  const registry={list:()=>[],get:()=>null,create:async()=>{throw Error('must not create');}},manager=createSessionGroups({ctx:{get:()=>registry},root,isAllowed:()=>true,move:()=>{throw Error('must not move');}}),revision=manager.snapshot().revision;
  for(const title of ['', 'x'.repeat(61),'bad\nname'])await assert.rejects(manager.run('create',{revision,title,path:root}),/INVALID_NAME/);
  await assert.rejects(manager.run('create',{revision,title:'ok',path:'relative'}),/INVALID_PATH/);
  await assert.rejects(manager.run('create',{revision,title:'ok',path:path.join(root,'missing')}),/INVALID_PATH/);
  await assert.rejects(manager.run('move',{conversationKey:'wechat:private:999',groupId:'missing'}),/NOT_ALLOWED/);
  assert.equal(createSessionGroups({ctx:{get:()=>undefined},root,isAllowed:()=>true}).snapshot().available,false);
});
test('session grouping UI filters without merging chats and escapes workspace names and paths',()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let renders=0;const ui=createSessionGroupUI({escapeHtml:esc,icon:()=>'',renderPage:()=>renders++});
  ui.prepare({available:true,revision:'r',groups:[{id:'g',title:'<script>bad</script>',path:'E:/a&b',sessionIds:['s']}],assignments:{}},[{conversationKey:'wechat:private:1',sessionId:'s',groupId:'g'}],new Set(['wechat:private:1','wechat:group:2']));
  const button=value=>({dataset:{sessionGroupFilter:value}});ui.click(button('g'));assert.equal(renders,1);assert(ui.visible('wechat:private:1'));assert(!ui.visible('wechat:group:2'));
  const html=ui.toolbar();assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('E:/a&amp;b'));assert.match(html,/aria-pressed="true"/);assert.match(ui.control('wechat:private:1'),/移动到分组/);
  ui.click(button('unassigned'));assert(ui.visible('wechat:group:2'));assert(!ui.visible('wechat:private:1'));
  ui.prepare({available:false,groups:[]},[],new Set());assert.match(ui.toolbar(),/原有会话仍可继续使用/);assert.equal(ui.control('wechat:private:1'),'');
});
test('console groups proxy requires local CSRF, checks plugin ownership and forwards typed requests',async t=>{
  const root=fixture(t),config=JSON.parse(fs.readFileSync(new URL('../config/wechatagent.example.json',import.meta.url),'utf8'));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify(config));fs.writeFileSync(path.join(root,'state/social-dsh-token.txt'),'fixture-group-token');
  const calls=[],app=createConsole({root,port:0,filePicker:async kind=>{assert.equal(kind,'workspace');return root;},fetchImpl:async(url,options={})=>{
    calls.push({url,options});return new Response(JSON.stringify(String(url).endsWith('/health')?{ok:true,project:'WeChatAgent',projectRoot:root}:{available:true,groups:[],ok:true}),{headers:{'Content-Type':'application/json'}});
  }});await app.start();t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));});
  const base='http://127.0.0.1:'+app.server.address().port,info=await(await fetch(base+'/api/info')).json();
  assert.equal((await fetch(base+'/api/session-groups')).status,401);
  const headers={'x-console-token':info.token,'Content-Type':'application/json',Origin:base};
  assert.equal((await fetch(base+'/api/session-groups',{headers})).status,200);
  const body={conversationKey:'wechat:private:123',groupId:'test',expectedSessionId:'old',confirmed:true};
  assert.equal((await fetch(base+'/api/session-groups/move',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),body);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer fixture-group-token');
  assert.equal((await fetch(base+'/api/session-groups/move',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify(body)})).status,403);
  assert.equal((await(await fetch(base+'/api/browse',{method:'POST',headers,body:JSON.stringify({kind:'workspace'})})).json()).path,root);
  for(const asset of ['session-groups.js','session-groups.css'])assert.equal((await fetch(base+'/'+asset)).status,200);
});
