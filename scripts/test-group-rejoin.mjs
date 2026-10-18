import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('the real session CLI keeps the same key and persona after a group changes its title',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-group-rejoin-'));let title='原群名';const requests=[];
  for(const folder of ['scripts','config','state','roles','components/qq-bridge/src'])fs.mkdirSync(path.join(root,folder),{recursive:true});
  const source=path.resolve('scripts/manage-dsh-sessions.mjs');fs.copyFileSync(source,path.join(root,'scripts/manage-dsh-sessions.mjs'));
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  fs.writeFileSync(path.join(root,'scripts/hook-onebot.mjs'),'export {conversationId} from '+JSON.stringify(pathToFileURL(path.resolve('scripts/hook-onebot.mjs')).href)+';');
  fs.writeFileSync(path.join(root,'components/qq-bridge/src/role-card.js'),'export {selectRoleText} from '+JSON.stringify(pathToFileURL(path.resolve('components/qq-bridge/src/role-card.js')).href)+';');
  fs.writeFileSync(path.join(root,'roles/fixture.md'),'# 测试人格\n只用于离线验证。');
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const b of req)chunks.push(b);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
    res.setHeader('content-type','application/json');
    if(req.url==='/health')return res.end(JSON.stringify({contextMode:'native-session-v1'}));
    if(req.url.startsWith('/api/v1/sessions'))return res.end(JSON.stringify({sessions:[{username:'room@chatroom',displayName:title,conversationId:'123'}]}));
    if(req.url==='/configure'){requests.push(body);return res.end(JSON.stringify({ok:true,sessionId:'unchanged-fixture-session'}));}
    res.writeHead(404);res.end('{}');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  const port=server.address().port;
  fs.writeFileSync(path.join(root,'state/wechat-io-config.json'),JSON.stringify({reader_base_url:'http://127.0.0.1:'+port,reader_token:'fixture'}));fs.writeFileSync(path.join(root,'state/social-dsh-token.txt'),'fixture');
  fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({ports:{dshPlugin:port},wechat:{whitelist:{private:[],groups:['123']}},persona:{default:'fixture',chats:{'wechat:group:123':'fixture'}}}));
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'scripts/manage-dsh-sessions.mjs'),'configure','wechat:group:123'],{windowsHide:true});let output='',errors='';
    const timer=setTimeout(()=>{child.kill();reject(Error('Session CLI fixture timeout'));},10000);
    child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;});child.on('error',reject);
    child.on('exit',code=>{clearTimeout(timer);if(code)reject(Error(errors));else resolve(JSON.parse(output.trim()));});
  });
  const before=await run();title='被踢后重进的新群名';const after=await run();
  assert.equal(before.sessionId,after.sessionId);assert.equal(requests.length,2);
  assert(requests.every(r=>r.conversationKey==='wechat:group:123'&&r.personaName==='fixture'));
  assert.deepEqual(requests.map(r=>r.conversationName),['原群名','被踢后重进的新群名']);
});
