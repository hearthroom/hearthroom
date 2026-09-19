import type { MyCard } from './api';
import type { CardCopy } from './distribution';
import { can, type ProviderId } from './provider';
export type WorkspaceCard = MyCard & { provider: ProviderId; sourceAvailable: boolean };
export const workKey = (card: MyCard) => card.workId ?? `${card.sourceProvider ?? card.provider}:${card.sourceRoleId ?? card.roleId}`;
/** Keep originals authoritative; never treat a synchronized copy as a new publication. */
export function groupWorks(rows: Partial<Record<ProviderId, MyCard[]>>): WorkspaceCard[] {
 const works = new Map<string, WorkspaceCard>();
 for (const provider of Object.keys(rows) as ProviderId[]) for (const card of rows[provider] ?? []) {
  const sourceAvailable = (!card.sourceProvider || card.sourceProvider === provider) && (!card.sourceRoleId || card.sourceRoleId === card.roleId);
  const entry = {...card, provider, sourceAvailable};
  const key = workKey(entry);
  if (!works.has(key) || sourceAvailable) works.set(key, entry);
 }
 return [...works.values()];
}
export function playCopies(roleId:string, provider:ProviderId, copies:CardCopy[], connected:ProviderId[]) {
 const entries = new Map<ProviderId,string>();
 entries.set(provider,roleId);
 for (const copy of copies) if(copy.roleId && ['source','synced','pending','published'].includes(copy.status)) entries.set(copy.provider,copy.roleId);
 return [...entries].filter(([p])=>connected.includes(p)&&can('chatTest',p)).map(([provider,roleId])=>({provider,roleId}));
}
