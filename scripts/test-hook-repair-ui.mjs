import test from 'node:test';import assert from 'node:assert/strict';
import {openProcessRecovery} from '../public/console/process-recovery.js';
test('repair UI inspects, asks for confirmation and reopens only after confirmed stopping',async()=>{
 const previous=globalThis.document,calls=[];let reopened=0,title='';
 const element=()=>({disabled:false,focus(){},addEventListener(name,fn){this['on'+name]=fn;}});
 let nodes={},selected=[];
 const body={set innerHTML(html){nodes={};selected=[];
  for(const name of ['data-recovery-rescan','data-recovery-prepare','data-recovery-back','data-recovery-stop','data-recovery-open','data-recovery-error'])if(html.includes(name))nodes['['+name+']']=element();
  if(html.includes('type="checkbox"'))selected=[{value:'matched-client',checked:true}];
 },querySelector(s){if(s==='input[type=checkbox]:checked')return selected.find(i=>i.checked);return nodes[s];},querySelectorAll(s){return s==='button'?Object.values(nodes):selected;}};
 globalThis.document={querySelector:s=>s==='#modal-content'?body:{set textContent(value){title=value;}}};
 try{
  const api=async(route,body)=>{calls.push({route,body});if(route.includes('?purpose='))return{purpose:'hook-repair',scanId:'scan',items:[{id:'matched-client',pid:123,name:'Weixin.exe',path:'C:/matching/Weixin.exe',canStop:true}]};if(route.endsWith('/prepare'))return{confirmation:'confirmed-token',items:[{pid:123,name:'Weixin.exe'}]};if(route.endsWith('/stop'))return{stopped:[123]};throw Error(route);};
  await openProcessRecovery({api,modal(){},refreshStatus:async()=>{},toast(){},repairWeChat:true,onRecovered:async()=>reopened++});
  assert.equal(calls.length,1);assert.equal(reopened,0);assert.equal(nodes['[data-recovery-prepare]'].disabled,false);
  await nodes['[data-recovery-prepare]'].onclick();assert.equal(calls.length,2);assert.equal(reopened,0);assert.match(title,/再次确认/);
  await nodes['[data-recovery-stop]'].onclick();assert.equal(calls[2].body.confirmed,true);assert.equal(reopened,1);
  let oldRequests=0;await openProcessRecovery({api:async()=>{oldRequests++;return{items:[{id:'foreign',canStop:true}]};},modal(){},refreshStatus:async()=>{},toast(){},repairWeChat:true,onRecovered:async()=>reopened++});
  assert.equal(oldRequests,1);assert.equal(nodes['[data-recovery-prepare]'],undefined);assert.equal(nodes['[data-recovery-stop]'],undefined);assert.equal(reopened,1);
 }finally{globalThis.document=previous;}
});
