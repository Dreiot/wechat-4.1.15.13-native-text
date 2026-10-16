import { withoutSocialTools } from './social-tool-policy.mjs';
import { WEB_READER_POLICY } from './web-reader-policy.mjs';
import {MODEL_SEARCH_POLICY} from './model-search.mjs';
import {DSH_ACCESS_POLICY} from './dsh-access.mjs';
import {MEME_LIBRARY_POLICY} from './meme-library-policy.mjs';
import {MEMBER_MEMORY_POLICY} from './member-memory-policy.mjs';
export const name = 'social-tool-restrict';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.presentAs?.('native'); // Visibility and execution use the same live per-chat authorization below.
  const policies = agent => [Symbol.for('wechatagent.extension-tools.v1'),WEB_READER_POLICY,MODEL_SEARCH_POLICY,DSH_ACCESS_POLICY,MEME_LIBRARY_POLICY,MEMBER_MEMORY_POLICY]
    .map(symbol => agent?.ctx?.[symbol] ?? ctx[symbol]).filter(Boolean);
  ctx.tools.guard(exec => policies(exec?.agent).some(policy => policy.check(exec?.name)) ? undefined : '微信群友会话不允许调用未授权工具');
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const original = await next(), assembly=original.sections?.some(section=>section.name==='dsh-expression:companion')?{...original,sections:original.sections.filter(section=>section.name!=='dsh-expression:companion')}:original, names = new Set(policies(context?.scope).flatMap(policy => [...policy.names()]));
    return names.size ? { ...assembly, tools: assembly.tools.filter(tool => names.has(tool.name)).map(({deferLoading,...tool})=>tool) } : withoutSocialTools(assembly);
  }, { prepend: true });
}
