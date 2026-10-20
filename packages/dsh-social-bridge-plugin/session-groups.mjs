import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {allowedConversation} from './conversation-policy.mjs';

export const groupFault = (code, status = 409) => Object.assign(Error(code), {code, status});
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const titleOf = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\x00-\x1f\x7f]/.test(value)) throw groupFault('SESSION_GROUP_INVALID_NAME', 400);
  return value.trim();
};
export function createSessionGroups({ctx, root, isAllowed, move, references=()=>[]}) {
  let tail = Promise.resolve();
  function registry() {
    const value = ctx.get?.('workspaceRegistry');
    if (!value?.list || !value?.get || !value?.create) throw groupFault('SESSION_GROUP_SERVICE_UNAVAILABLE', 503);
    return value;
  }
  function snapshot() {
    if (!isAllowed()) throw groupFault('SESSION_GROUP_ACCOUNT_CHANGED');
    let owner; try { owner = registry(); } catch { return {available:false,groups:[],revision:'',reason:'SESSION_GROUP_SERVICE_UNAVAILABLE'}; }
    const archived=new Set(owner.archivedSessionIds??[]);
    const groups = owner.list().map(group => ({id:String(group.id),title:group.title,path:group.path,sessionIds:group.sessionIds.map(String).filter(id=>!archived.has(id)),updatedAt:group.updatedAt ?? 0}));
    return {available:true,groups,revision:digest(groups)};
  }
  const groupFor = (sid, profile = {}) => {
    const data = snapshot();
    return data.groups.find(group => group.sessionIds.includes(sid)) ?? data.groups.find(group => group.id === profile.workspaceId && group.path === profile.workspacePath) ?? null;
  };
  async function run(operation, body, signal) {
    const job = tail.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      if (!isAllowed()) throw groupFault('SESSION_GROUP_ACCOUNT_CHANGED');
      const owner = registry();
      if (operation === 'move') {
        const config = JSON.parse(fs.readFileSync(path.join(root,'config/wechatagent.json'),'utf8').replace(/^\uFEFF/,''));
        if (!allowedConversation(config.wechat,body.conversationKey)) throw groupFault('SESSION_GROUP_CHAT_NOT_ALLOWED',400);
        const group = owner.get(body.groupId);
        if (!group) throw groupFault('SESSION_GROUP_NOT_FOUND',404);
        return move(body,group,signal);
      }
      if (body.revision !== snapshot().revision) throw groupFault('SESSION_GROUP_CHANGED');
      if (operation === 'create') {
        const title = titleOf(body.title), directory = body.path;
        if (typeof directory !== 'string' || directory.length > 1024 || /[\0\r\n]/.test(directory) || !path.isAbsolute(directory) || process.platform === 'win32' && path.parse(directory).root.length < 3) throw groupFault('SESSION_GROUP_INVALID_PATH',400);
        let canonical;
        try { canonical = await fs.promises.realpath(directory); if (!(await fs.promises.stat(canonical)).isDirectory()) throw Error(); }
        catch { throw groupFault('SESSION_GROUP_INVALID_PATH',400); }
        signal?.throwIfAborted(); if (!isAllowed()) throw groupFault('SESSION_GROUP_ACCOUNT_CHANGED');
        const prior = await owner.resolveByPath(canonical);
        const group = prior ?? await owner.create(canonical,title);
        return {ok:true,groupId:String(group.id),reused:!!prior,...snapshot()};
      }
      const group = owner.get(body.groupId);
      if (!group) throw groupFault('SESSION_GROUP_NOT_FOUND',404);
      if (operation === 'rename') {
        const title = titleOf(body.title);
        if (owner.list().some(item => item.id !== group.id && item.title === title)) throw groupFault('SESSION_GROUP_DUPLICATE_NAME',400);
        await group.setTitle(title);
      } else if (operation === 'delete') {
        if (body.confirmed !== true) throw groupFault('SESSION_GROUP_CONFIRM_REQUIRED',400);
        if (group.sessionIds.some(id=>!(owner.archivedSessionIds??[]).includes(id))||references().some(profile=>profile.workspaceId===String(group.id))) throw groupFault('SESSION_GROUP_NOT_EMPTY');
        await owner.delete(group.id);
      } else throw groupFault('SESSION_GROUP_INVALID_OPERATION',400);
      return {ok:true,...snapshot()};
    });
    tail = job; return job;
  }
  return {snapshot,groupFor,run};
}
