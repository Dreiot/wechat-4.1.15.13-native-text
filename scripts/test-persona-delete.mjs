import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createConsole} from './console-server.mjs';import {projectRoot} from './project-config.mjs';
import {createPersonaDeletion} from '../public/console/persona-delete.js';
import deployment from '../apps/console-desktop/deployment.cjs';

async function fixture(t){
 const baseDir=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-persona-delete-')),root=path.join(baseDir,'workspace');fs.mkdirSync(root);for(const dir of ['config','roles'])fs.mkdirSync(path.join(root,dir));
 const config=JSON.parse(fs.readFileSync(path.join(projectRoot,'config/wechatagent.example.json'),'utf8'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify(config));
 fs.writeFileSync(path.join(root,'roles',config.persona.default+'.md'),'# Default fixture');fs.writeFileSync(path.join(root,'roles/Unused.md'),'# Unused fixture');fs.writeFileSync(path.join(root,'roles/README.md'),'# Instructions');
 const app=createConsole({root,port:0,runner:async()=>0}),address=await app.start(),base='http://127.0.0.1:'+address.port,info=await fetch(base+'/api/info').then(res=>res.json());
 t.after(async()=>{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));assert(baseDir.startsWith(os.tmpdir()+path.sep));fs.rmSync(baseDir,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 const request=async(route,body,headers={})=>{const res=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'X-Console-Token':info.token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:res.status,body:await res.json()};};
 const roles=(await request('/api/roles')).body.roles;
 return{root,config,base,home:baseDir,request,roles,target:roles.find(role=>role.name==='Unused')};
}

test('deleting an unused persona requires confirmation, backs up the file and leaves configuration unchanged',async t=>{
 const f=await fixture(t),file=path.join(f.root,'roles/Unused.md'),configFile=path.join(f.root,'config/wechatagent.json'),before=fs.readFileSync(configFile),content=fs.readFileSync(file),body={name:'Unused',revision:f.target.revision};
 assert.equal((await f.request('/api/roles/delete',body)).status,409);assert(fs.existsSync(file));
 assert.equal((await f.request('/api/roles/delete',{...body,confirmed:true},{'X-Console-Token':'wrong'})).status,401);
 assert.equal((await f.request('/api/roles/delete',{...body,confirmed:true})).status,200);assert(!fs.existsSync(file));assert.deepEqual(fs.readFileSync(configFile),before);
 const backups=fs.readdirSync(path.join(f.root,'state/console-backups'));assert.equal(backups.length,1);assert.deepEqual(fs.readFileSync(path.join(f.root,'state/console-backups',backups[0])),content);assert(!fs.existsSync(path.join(f.root,'state/console-state.json')));
 assert(!(await f.request('/api/roles')).body.roles.some(role=>role.name==='Unused'));assert.equal((await f.request('/api/roles/delete',{...body,confirmed:true})).status,404);
 assert.equal((await fetch(f.base+'/persona-delete.js')).status,200);
});

test('default and chat-bound personas cannot be deleted through case variants or bypassed UI checks',async t=>{
 const f=await fixture(t),role=f.roles.find(role=>role.name===f.config.persona.default);
 assert.equal((await f.request('/api/roles/delete',{name:role.name.toLocaleUpperCase(),revision:role.revision,confirmed:true})).status,409);
 f.config.persona.chats={'wechat:group:123':'UNUSED'};const configFile=path.join(f.root,'config/wechatagent.json');fs.writeFileSync(configFile,JSON.stringify(f.config));const before=fs.readFileSync(configFile);
 assert.equal((await f.request('/api/roles/delete',{name:'unused',revision:f.target.revision,confirmed:true})).status,409);assert(fs.existsSync(path.join(f.root,'roles/Unused.md')));assert.deepEqual(fs.readFileSync(configFile),before);
});

test('installer relaunch and upgrade remember explicit deletion while recreating a card restores normal seeding',async t=>{
 const f=await fixture(t),resources=path.join(f.home,'resources'),write=(relative,value)=>{const file=path.join(resources,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 write('project/config/wechatagent.example.json',JSON.stringify(f.config));write('project/roles/Unused.md','# Bundled fixture');write('runtime/python/python.exe','fixture');write('runtime/node.exe','fixture');write('vendor/dsh/DeepSeek Harness.exe','fixture');write('vendor/wechat/Weixin.exe','fixture');write('vendor/hook/version.dll','fixture');write('vendor/hook/build.json','{}');
 const manifest={version:'0.0.1',files:['config/wechatagent.example.json','roles/Unused.md']};write('project/deployment.json',JSON.stringify(manifest));
 assert.equal((await f.request('/api/roles/delete',{name:'Unused',revision:f.target.revision,confirmed:true})).status,200);
 await deployment.bootstrapDeployment(resources,f.home);assert(!fs.existsSync(path.join(f.root,'roles/Unused.md')));
 manifest.version='0.0.2';write('project/deployment.json',JSON.stringify(manifest));await deployment.bootstrapDeployment(resources,f.home);assert(!fs.existsSync(path.join(f.root,'roles/Unused.md')));
 assert.equal((await f.request('/api/roles',{name:'Unused',content:'# Recreated'})).status,200);const file=path.join(f.root,'roles/Unused.md');assert.equal(fs.readFileSync(file,'utf8'),'# Recreated');
 fs.unlinkSync(file);await deployment.bootstrapDeployment(resources,f.home);assert.equal(fs.readFileSync(file,'utf8'),'# Bundled fixture');
});

test('stale files, reserved names, traversal and linked directories are refused without deleting other data',async t=>{
 const f=await fixture(t),file=path.join(f.root,'roles/Unused.md');fs.writeFileSync(file,'# Modified elsewhere');
 assert.equal((await f.request('/api/roles/delete',{name:'Unused',revision:f.target.revision,confirmed:true})).status,409);
 for(const name of ['README','readme','../Unused','CON.extra','a/b'])assert.equal((await f.request('/api/roles/delete',{name,revision:f.target.revision,confirmed:true})).status,400);
 assert.equal(fs.readFileSync(file,'utf8'),'# Modified elsewhere');assert.equal(fs.readFileSync(path.join(f.root,'roles/README.md'),'utf8'),'# Instructions');
 const original=path.join(f.root,'roles'),moved=path.join(f.root,'original-roles');assert(path.resolve(original).startsWith(f.root+path.sep)&&path.resolve(moved).startsWith(f.root+path.sep));fs.renameSync(original,moved);fs.symlinkSync(moved,original,process.platform==='win32'?'junction':'dir');
 assert.equal((await f.request('/api/roles/delete',{name:'Unused',revision:f.target.revision,confirmed:true})).status,400);assert.equal(fs.readFileSync(path.join(moved,'Unused.md'),'utf8'),'# Modified elsewhere');
});

function uiFixture(api){
 const elements=new Map(),get=selector=>{if(!elements.has(selector))elements.set(selector,{disabled:false,textContent:'',addEventListener(_name,handler){this.click=handler;}});return elements.get(selector);};
 const state={config:{persona:{default:'Default',chats:{}}},draft:{persona:{default:'Default',chats:{}},unrelated:'draft'},roles:[{name:'Default',revision:'default'},{name:'Unused',revision:'original'},{name:'Other',revision:'other'}],selectedRole:'Unused',roleDrafts:new Map([['Unused',{content:'unsaved'}],['Other',{content:'other unsaved'}]])},roleSaves=new Map(),requests=[],messages=[];let dialog,closed=0;
 const open=createPersonaDeletion({state,roleSaves,api:async(route,body)=>{requests.push({route,body});return api?.(route,body);},modal:(title,html,options)=>{dialog={title,html,options};},closeModal:()=>{closed++;},escapeHtml:text=>text,renderPage:async()=>{},updateDraftUI:()=>{},toast:text=>messages.push(text),query:get});
 return{state,roleSaves,open,requests,messages,get, get dialog(){return dialog;},get closed(){return closed;}};
}

test('UI confirmation deletes only the selected card and preserves all unrelated settings and drafts',async()=>{
 let finish;const gate=new Promise(resolve=>{finish=resolve;}),f=uiFixture(()=>gate),before=JSON.stringify([f.state.config,f.state.draft]);f.open();assert.equal(f.requests.length,0);assert(f.dialog.html.includes('未保存'));assert.equal(f.dialog.options.beforeClose(),true);
 const pending=f.get('#confirm-role-delete').click();assert.equal(f.requests.length,1);assert.equal(f.dialog.options.beforeClose(),false);await f.get('#confirm-role-delete').click();assert.equal(f.requests.length,1);finish({ok:true});await pending;
 assert.deepEqual(f.state.roles.map(role=>role.name),['Default','Other']);assert.equal(f.state.selectedRole,'Other');assert(!f.state.roleDrafts.has('Unused'));assert(f.state.roleDrafts.has('Other'));assert.equal(JSON.stringify([f.state.config,f.state.draft]),before);assert.equal(f.closed,1);
});

test('UI keeps cards and drafts on server failure, and blocks saved or draft bindings and ongoing saves',async()=>{
 const f=uiFixture(()=>{throw Error('人设卡已被修改');});f.open();await f.get('#confirm-role-delete').click();assert.equal(f.state.roles.length,3);assert(f.state.roleDrafts.has('Unused'));assert.equal(f.closed,0);assert.equal(f.get('#role-delete-error').textContent,'人设卡已被修改');assert.equal(f.get('#confirm-role-delete').disabled,false);
 for(const kind of ['saved-default','draft-chat','saving']){const f=uiFixture();if(kind==='saved-default')f.state.config.persona.default='unused';if(kind==='draft-chat')f.state.draft.persona.chats={'wechat:group:123':'UNUSED'};if(kind==='saving')f.roleSaves.set('Other',Promise.resolve());f.open();assert.equal(f.dialog,undefined);assert.equal(f.requests.length,0);assert.equal(f.state.roles.length,3);assert.equal(f.messages.length,1);}
});
