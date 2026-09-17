import { currentProvider, providerName, type ProviderId } from "./provider";
import { accountToken } from "./connections";
import { i18n } from "./i18n";
export interface CardCopy {
  provider: ProviderId;
  roleId: string | null;
  status: string;
  error?: string;
  updatedAt?: number;
}
export class DistributionError extends Error {
  constructor(code:string, readonly detail?:{provider?:ProviderId;step?:string;upstreamStatus?:number;upstreamCode?:string}) { super(code); }
}
export function canRecreateCopy(error: unknown, provider:ProviderId):boolean {
 let code=error instanceof Error?error.message:'';
 let detail=error instanceof DistributionError?error.detail:undefined;
 if(code.startsWith('{')) {try{const parsed=JSON.parse(code);code=parsed.error;detail=parsed.detail;}catch{return false;}}
 return code==='sync_resource_missing' && detail?.provider===provider && detail.step==='read'
   && detail.upstreamStatus===404 && detail.upstreamCode==='role_not_found';
}
export function connectionMessage(error: unknown): string {
  let code = error instanceof Error ? error.message : "";
  let detail = error instanceof DistributionError ? error.detail : undefined;
  // Durable results use the same safe envelope as the immediate response.
  if(code.startsWith('{')) { try { const parsed=JSON.parse(code);code=parsed.error;detail=parsed.detail; } catch {code='';} }
  const safe=(v:unknown):v is string=>typeof v==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(v);
  if(!safe(code))code='sync_failed';
  const key = `linked.error.${code}`;
  const message=i18n.global.te(key)?i18n.global.t(key):i18n.global.t("linked.error.generic");
  const parts=[code];
  if(detail?.provider==='lunatalk'||detail?.provider==='harbor')parts.push(providerName(detail.provider));
  if(safe(detail?.step))parts.push(i18n.global.te(`linked.step.${detail.step}`)?i18n.global.t(`linked.step.${detail.step}`):detail.step);
  if(Number.isInteger(detail?.upstreamStatus))parts.push(`HTTP ${detail!.upstreamStatus}`);
  if(safe(detail?.upstreamCode))parts.push(detail.upstreamCode);
  return `${message} (${parts.join(' · ')})`;
}
async function response(r:Response) {
 const body=await r.json().catch(()=>({error:'sync_invalid_response'}));
 if(!r.ok || body.error)throw new DistributionError(body.error||'sync_failed',body.detail);
 return body;
}
export function platformPath(path: string, provider: ProviderId): string {
  return `${path}${path.includes("?") ? "&" : "?"}provider=${provider}`;
}
export async function copies(
  roleId: string,
  provider: ProviderId
): Promise<CardCopy[]> {
  const token = await accountToken(provider);
  if (!token) throw new Error("connection_source_expired");
  const r = await fetch(`/v1/me/card-copies/${encodeURIComponent(roleId)}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Provider": provider },
  });
  return (await response(r)).copies;
}
export async function synchronize(
  roleId: string,
  sourceProvider: ProviderId,
  targetProvider: ProviderId,
  publish = false,
  updatePublished = false,
  recreateMissing = false
): Promise<CardCopy> {
  const [sourceToken, targetToken, memberToken] = await Promise.all([
    accountToken(sourceProvider),
    accountToken(targetProvider),
    accountToken(currentProvider()),
  ]);
  if (!sourceToken || !targetToken || !memberToken)
    throw new DistributionError("connection_source_expired",{provider:!sourceToken?sourceProvider:!targetToken?targetProvider:currentProvider(),step:'identity'});
  const r = await fetch("/v1/me/card-sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${memberToken}`,
      "X-Provider": currentProvider(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sourceProvider,
      sourceRoleId: roleId,
      sourceToken,
      targetProvider,
      targetToken,
      publish,
      updatePublished,
      recreateMissing,
    }),
  });
  return response(r);
}
