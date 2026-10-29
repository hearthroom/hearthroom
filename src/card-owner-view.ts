import {CARD_NUMBER,toCard,previewCard,ensureCardNumber,type CardRow} from './cards';
import type {ProviderId} from './providers';
import {managedWork,workPolicyGateway} from './work-policy';
import {hostGateway} from './hosting';
import {upstream} from './upstream';
import type {Env} from './types';
export async function readOwnCardView(env:Env,id:string,row:CardRow|null,language:string,bearer:string|undefined,provider:ProviderId) {
  if (!bearer) return null;
  const me = await upstream.fetchMe(env, bearer, provider).catch(() => null);
  if (!me) return null;
  if (row) {
    if(row.provider!==provider||row.author_num_id!==me.accountNumId)return null;
    if(provider==='harbor'&&(row.status==='unlisted'||await managedWork(env.DB,provider,row.source_role_id))){
      try{
        await workPolicyGateway.owner(env,provider,row.source_role_id,bearer);
        const role=await hostGateway.read(env,bearer,row.source_role_id,provider);
        if(role.roleId!==row.source_role_id||role.authorNumId!==me.accountNumId)return null;
        return {...previewCard(role,language,provider,row.num??Number(row.id)),status:row.status,canInteract:false,listed:false};
      }catch{return null;}
    }
    return {...toCard(row,language),status:row.status};
  }
  // 卡號查不到就是沒這張卡；只有上游的卡片 ID 才值得去上游問
  if (CARD_NUMBER.test(id)) return null;
  const role = await (provider==='harbor'?hostGateway.read(env,bearer,id):upstream.fetchRole(env,id,provider)).catch(() => null);
  if (!role || role.authorNumId !== me.accountNumId) return null;
  return previewCard(role, language, provider, await ensureCardNumber(env.DB,provider,role.roleId));
}

