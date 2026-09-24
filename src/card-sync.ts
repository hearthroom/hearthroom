import {PROVIDER_IDS, type ProviderId} from "./providers";
export interface CopySummary {
  provider: ProviderId;
  roleId: string | null;
  status: string;
  error: string;
  updatedAt: number;
}
/**
 * 作品現在的原作在哪。原作所在的服務已經下線（例如 LunaTalk）時，這一份就是唯一還能編輯、送審的版本，
 * 把它當原作；否則沿用作品登記的原作。只用在「能不能送審、是不是原作」的判斷——卡號仍跟著作品登記走，
 * 不然已分享出去的卡片連結會變。
 */
export function authoringSource(
  work: { source_provider: ProviderId; source_role_id: string } | null | undefined,
  provider: ProviderId,
  roleId: string
): { provider: ProviderId; roleId: string } {
  if (!work || !(PROVIDER_IDS as readonly string[]).includes(work.source_provider)) return { provider, roleId };
  return { provider: work.source_provider, roleId: work.source_role_id };
}

/**
 * 原作在已下線服務的作品，由它在這一家的副本接手成為原作：同一個作品（審核與版本紀錄都在），
 * 不另立新作品。送審、開始編輯前呼叫；已經有同名原作或不是下線來源時什麼都不做。
 */
export async function adoptRetiredWork(db: D1Database, provider: ProviderId, roleId: string): Promise<void> {
  const work = await db
    .prepare(`SELECT w.id, w.source_provider FROM works w JOIN work_copies cp ON cp.work_id = w.id WHERE cp.provider = ? AND cp.role_id = ?`)
    .bind(provider, roleId)
    .first<{ id: string; source_provider: string }>();
  if (!work || (PROVIDER_IDS as readonly string[]).includes(work.source_provider)) return;
  const taken = await db.prepare(`SELECT 1 FROM works WHERE source_provider = ? AND source_role_id = ?`).bind(provider, roleId).first();
  if (taken) return;
  await db.batch([
    db.prepare(`UPDATE works SET source_provider = ?, source_role_id = ? WHERE id = ?`).bind(provider, roleId, work.id),
    db.prepare(`DELETE FROM work_copies WHERE work_id = ? AND provider = ?`).bind(work.id, provider),
  ]);
}

export async function workFor(
  db: D1Database,
  provider: ProviderId,
  roleId: string
) {
  return db
    .prepare(
      `SELECT id,source_provider,source_role_id FROM works WHERE (source_provider=? AND source_role_id=?) OR id IN (SELECT work_id FROM work_copies WHERE provider=? AND role_id=?) OR id IN (SELECT v.work_id FROM hosting_versions v JOIN hosting_replicas r ON r.version_id=v.version_id WHERE r.provider=? AND r.hosted_revision_id=?)`
    )
    .bind(provider, roleId, provider, roleId, provider, roleId)
    .first<{
      id: string;
      source_provider: ProviderId;
      source_role_id: string;
    }>();
}
export async function copiesFor(
  db: D1Database,
  provider: ProviderId,
  roleId: string
): Promise<CopySummary[]> {
  const work = await workFor(db, provider, roleId);
  if (!work) return [];
  if(work.source_provider!=='harbor')return [];
  return [{provider:'harbor',roleId:work.source_role_id,status:'source',error:'',updatedAt:0}];
}
