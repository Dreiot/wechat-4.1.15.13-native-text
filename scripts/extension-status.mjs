import { searchPolicy } from '../packages/dsh-social-bridge-plugin/search-policy.mjs';
import { stickerPolicy } from '../components/qq-bridge/src/core/sticker-policy.js';
import { proactivePolicy } from '../components/qq-bridge/src/core/proactive-policy.js';
import { contextPolicy } from '../packages/dsh-social-bridge-plugin/context-policy.mjs';
import { webReaderEnabled } from '../packages/dsh-social-bridge-plugin/web-reader-policy.mjs';

export const BUILTIN_FEATURES = Object.freeze([
  {id:'native-web-reader',name:'网页阅读',feature:'webReader',description:'读取本轮提供的公开网页正文，供模型总结和分析。',host:'dsh',defaultEnabled:true,chatMode:'all'},
  {id:'native-search',name:'联网搜索',feature:'search',description:'按需查询搜索摘要和天气资料。',host:'bridge',defaultEnabled:false,chatMode:'override'},
  {id:'native-stickers',name:'原生表情发送',feature:'stickers',description:'使用当前聊天收到并准备好的表情资源。',host:'bridge',defaultEnabled:true,chatMode:'override'},
  {id:'native-proactive',name:'主动聊天',feature:'proactive',description:'按已设置的时间和间隔，向选中的聊天主动发言。',host:'bridge',defaultEnabled:false,chatMode:'selected'},
  {id:'native-context',name:'上下文压缩',feature:'context',description:'在达到阈值且聊天空闲时自动压缩上下文。',host:'bridge',defaultEnabled:false,chatMode:'context'},
]);
export const allowedKeys = config => ['private','group'].flatMap(kind => (config.wechat?.whitelist?.[kind==='group'?'groups':'private'] ?? []).map(id=>'wechat:'+kind+':'+id));
export function featureEnabled(config,id,key) {
  const w=config.wechat ?? {};
  if(id==='native-web-reader')return !!webReaderEnabled(w,key);
  if(id==='native-search')return searchPolicy(w,key).enabled;
  if(id==='native-stickers')return stickerPolicy(w,key).enabled;
  if(id==='native-proactive')return proactivePolicy(w,key).enabled;
  if(id==='native-context')return contextPolicy(w,key).enabled;
  return true;
}
export function extensionPresentation(item,config,runtimeConnected) {
  const keys=allowedKeys(config),scope=item.chats===null?keys:keys.filter(key=>(item.chats ?? []).includes(key));
  const descriptor=BUILTIN_FEATURES.find(row=>row.id===item.id);
  const gate=item.management==='project'||item.enabled;
  const effective=gate?scope.filter(key=>!descriptor||featureEnabled(config,item.id,key)):[];
  const globalEnabled=descriptor?(config.wechat?.[descriptor.feature]?.enabled ?? descriptor.defaultEnabled):null;
  let label='已开启',tone='ok';
  if(item.invalid){label='配置无效';tone='error';}
  else if(!gate){label='已关闭';tone='muted';}
  else if(descriptor&&!effective.length&&!globalEnabled){label=item.management==='project'?'已关闭':'功能未开启';tone='muted';}
  else if(!keys.length){label='未选择聊天';tone='warning';}
  else if(!scope.length){label='未分配聊天';tone='warning';}
  else if(descriptor&&!effective.length){label='功能未开启';tone='muted';}
  else if(item.management!=='project' && item.host!=='bridge' && (!runtimeConnected || !item.active)){label='待生效';tone='warning';}
  else if(effective.length<scope.length){label='部分开启';tone='warning';}
  return {...item,statusLabel:label,statusTone:tone,effectiveChats:effective,scopeCount:scope.length,
    featureState:descriptor?{name:descriptor.name,globalEnabled,effectiveCount:effective.length,totalCount:keys.length,feature:descriptor.feature}:null};
}

export function builtinCatalog(config,revision,runtimeConnected=false) {
  return {apiVersion:1,revision,canImport:false,runtimeConnected,extensions:BUILTIN_FEATURES.map(feature=>extensionPresentation({
    ...feature,builtin:true,kind:'skills',format:'code',version:'1.0.0',apiVersion:1,management:'project',
    // These controls edit the existing feature settings, rather than a second gate.
    enabled:config.wechat?.[feature.feature]?.enabled ?? feature.defaultEnabled,featureSettings:structuredClone(config.wechat?.[feature.feature] ?? {}),
    chats:null,settings:{},configSchema:{},requestedPermissions:[],permissions:[],reason:runtimeConnected?'按功能条件生效':'设置已保存，等待服务连接',
  },config,runtimeConnected))};
}

export function applyBuiltinUpdate(config,id,body) {
  const descriptor=BUILTIN_FEATURES.find(item=>item.id===id);
  if(!descriptor || typeof body.enabled!=='boolean')throw Error('内置扩展或开关无效。');
  const next=structuredClone(config),settings=next.wechat[descriptor.feature] ??= {};
  settings.enabled=body.enabled;
  if(descriptor.chatMode!=='all') {
    const keys=allowedKeys(next),patch=body.chatSettings;
    if(!patch || typeof patch!=='object' || Array.isArray(patch) || Object.keys(patch).some(key=>!keys.includes(key)))throw Error('聊天范围无效，请重新打开扩展设置。');
    settings.chats ??= {};
    for(const [key,value] of Object.entries(patch)) {
      if(value==='inherit' && descriptor.chatMode==='override')delete settings.chats[key];
      else if(descriptor.chatMode==='context' && value==='inherit')delete settings.chats[key];
      else if(descriptor.chatMode==='context' && value===false)settings.chats[key]=0;
      else if(descriptor.chatMode==='context' && value===true){if(settings.chats[key]===0)delete settings.chats[key];}
      else if(typeof value==='boolean' && descriptor.chatMode!=='context')settings.chats[key]=value;
      else throw Error('聊天开关无效。');
    }
  }
  return next;
}
