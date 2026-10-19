import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createExtensionUI} from '../public/console/extensions.js';
import {builtinCatalog} from './extension-status.mjs';

function fixture(t,{memeStatus=async()=>({available:true}),dshCatalog=async()=>({skills:[],tools:[]})}={}) {
  const documentBefore=globalThis.document;
  globalThis.document={addEventListener(){}};
  t.after(()=>{if(documentBefore===undefined)delete globalThis.document;else globalThis.document=documentBefore;});
  const config={wechat:{whitelist:{private:['123'],groups:['456']},search:{enabled:true},memeLibrary:{enabled:true}}};
  const original=JSON.stringify(config),catalog=builtinCatalog(config,'fixture-revision',true),requests=[];
  const ui=createExtensionUI({
    api:async route=>{requests.push(route);if(route==='/api/extensions')return catalog;if(route==='/api/meme-library-status')return memeStatus();if(route==='/api/dsh-catalog')return dshCatalog();throw Error('Unexpected request: '+route);},
    modal(){},closeModal(){},confirmAction(){},escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    icon:()=>'',state:{config,names:new Map()},renderPage(){},toast(){},
  });
  t.after(()=>assert.equal(JSON.stringify(config),original,'rendering must not reset feature settings'));
  return {ui,catalog,requests};
}

function assertCards(html,catalog) {
  assert.equal(typeof html,'string');
  assert(!html.includes('[object Promise]'),'the page must contain rendered markup');
  assert.match(html,/href="#stickers"[^>]*>管理表情包/);
  assert.equal([...html.matchAll(/data-extension-card="/g)].length,catalog.extensions.length);
  for(const item of catalog.extensions)assert(html.includes('data-extension-card="'+item.id+'"'),'missing card: '+item.id);
  assert.match(html,/id="extension-search"/);assert.match(html,/id="extension-status-filter"/);
}

test('extension page waits for delayed status and renders every card alongside sticker management',async t=>{
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  const f=fixture(t,{memeStatus:()=>delayed});let settled=false;
  const pending=f.ui.page().then(html=>{settled=true;return html;});
  try{await nextTurn();assert.equal(settled,false,'a slow status response must not turn the catalog into Promise text');}
  finally{release({available:true});}
  const html=await pending;assertCards(html,f.catalog);assert.match(html,/DSH 技能与插件工具/);
});

test('unavailable DSH and meme services keep built-in extension cards and settings visible',async t=>{
  const unavailable=async()=>{throw Error('offline fixture');};
  const f=fixture(t,{memeStatus:unavailable,dshCatalog:unavailable});
  const html=await f.ui.page();assertCards(html,f.catalog);assert.match(html,/DSH 未连接/);
  assert.equal(f.requests.length,3);
});

test('reopening the extension page still renders the complete catalog',async t=>{
  const f=fixture(t);
  assertCards(await f.ui.page(),f.catalog);assertCards(await f.ui.page(),f.catalog);
});
