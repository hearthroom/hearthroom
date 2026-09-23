import type {ProviderId} from "./providers";
export interface CopySummary {
  provider: ProviderId;
  roleId: string | null;
  status: string;
  error: string;
  updatedAt: number;
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
