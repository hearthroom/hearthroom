import { MEDIA_FIELDS } from "./card-media";
import { transfers, type TransferCard } from "./card-transfer";
import { HttpError, type Env } from "./types";
import type { ProviderId } from "./providers";
export { transfers };
export interface SyncInput {
  memberId: string;
  sourceProvider: ProviderId;
  sourceRoleId: string;
  sourceAccount: number;
  sourceToken: string;
  targetProvider: ProviderId;
  targetAccount: number;
  targetToken: string;
  publish: boolean;
}
export async function cardHash(card: TransferCard) {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        name: card.name,
        summary: card.summary,
        description: card.description,
        greeting: card.greeting,
        language: card.language,
        fields: card.fields ?? {},
        media: MEDIA_FIELDS.map((key) => card.media?.[key] ?? ""),
      })
    )
  );
  return [...new Uint8Array(raw)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
interface Copy {
  role_id: string | null;
  external_id: number;
  source_hash: string;
  target_hash: string;
  status: string;
  updated_at: number;
  operation: string | null;
}
export async function syncCard(env: Env, i: SyncInput) {
  if (i.sourceProvider === i.targetProvider)
    throw new HttpError(400, "sync_same_provider");
  const source = await transfers.read(
    env,
    i.sourceProvider,
    i.sourceToken,
    i.sourceRoleId,
    i.sourceAccount
  );
  if (i.targetProvider === "lunatalk" && source.card.media?.backgroundLandscape)
    throw new HttpError(409, "sync_unsupported_content");
  const existingWork = await workFor(env.DB, i.sourceProvider, i.sourceRoleId);
  if (
    existingWork &&
    (existingWork.source_provider !== i.sourceProvider ||
      existingWork.source_role_id !== i.sourceRoleId)
  )
    throw new HttpError(409, "sync_from_original");
  const hash = await cardHash(source.card);
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO works VALUES (?,?,?,?,?)")
    .bind(
      crypto.randomUUID(),
      i.memberId,
      i.sourceProvider,
      i.sourceRoleId,
      now
    )
    .run();
  const work = await env.DB.prepare(
    "SELECT id FROM works WHERE source_provider=? AND source_role_id=?"
  )
    .bind(i.sourceProvider, i.sourceRoleId)
    .first<{ id: string }>();
  const id = work!.id;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO work_copies(work_id,provider,external_id,status,updated_at) VALUES (?,?,?,'missing',?)"
  )
    .bind(id, i.targetProvider, i.targetAccount, now)
    .run();
  const row = (await env.DB.prepare(
    "SELECT * FROM work_copies WHERE work_id=? AND provider=?"
  )
    .bind(id, i.targetProvider)
    .first<Copy>())!;
  if (row.external_id !== i.targetAccount)
    throw new HttpError(409, "sync_account_changed");
  if (row.status === "unknown" || (row.status === "syncing" && !row.role_id))
    throw new HttpError(409, "sync_create_unconfirmed");
  if (row.status === "syncing" && now - row.updated_at < 300000)
    throw new HttpError(409, "sync_busy");
  const operation = crypto.randomUUID();
  const lock = await env.DB.prepare(
    "UPDATE work_copies SET status='syncing',operation=?,updated_at=? WHERE work_id=? AND provider=? AND updated_at=? AND status=?"
  )
    .bind(operation, now, id, i.targetProvider, row.updated_at, row.status)
    .run();
  if (!lock.meta.changes) throw new HttpError(409, "sync_busy");
  let roleId = row.role_id;
  let creating = false;
  let status = "synced";
  let targetHash = row.target_hash;
  const checkpoint = async () => {
    const current = await transfers.read(
      env,
      i.targetProvider,
      i.targetToken,
      roleId!,
      i.targetAccount
    );
    targetHash = await cardHash(current.card);
    await env.DB.prepare(
      "UPDATE work_copies SET target_hash=?,updated_at=? WHERE work_id=? AND provider=? AND operation=?"
    )
      .bind(targetHash, Date.now(), id, i.targetProvider, operation)
      .run();
  };
  try {
    if (roleId) {
      if (!targetHash) throw new HttpError(409, "sync_target_unverified");
      const existing = await transfers.read(
        env,
        i.targetProvider,
        i.targetToken,
        roleId,
        i.targetAccount
      );
      const actual = await cardHash(existing.card);
      if (targetHash && actual !== targetHash && actual !== hash)
        throw new HttpError(409, "sync_target_changed");
      if (actual === hash)
        status = existing.public
          ? "published"
          : existing.pending
          ? "pending"
          : "synced";
      else {
        if (existing.public || existing.pending)
          throw new HttpError(409, "sync_target_published");
        await transfers.update(
          env,
          i.targetProvider,
          i.targetToken,
          roleId,
          source.card,
          checkpoint
        );
      }
    } else {
      creating = true;
      roleId = await transfers.create(
        env,
        i.targetProvider,
        i.targetToken,
        source.card,
        `${id}:${i.targetProvider}`
      );
      await env.DB.prepare(
        "UPDATE work_copies SET role_id=? WHERE work_id=? AND provider=? AND operation=?"
      )
        .bind(roleId, id, i.targetProvider, operation)
        .run();
      creating = false;
      // Record the initial remote version so a failed later write can be retried safely.
      targetHash = await cardHash(
        (
          await transfers.read(
            env,
            i.targetProvider,
            i.targetToken,
            roleId,
            i.targetAccount
          )
        ).card
      );
      await env.DB.prepare(
        "UPDATE work_copies SET target_hash=? WHERE work_id=? AND provider=? AND operation=?"
      )
        .bind(targetHash, id, i.targetProvider, operation)
        .run();
      await transfers.update(
        env,
        i.targetProvider,
        i.targetToken,
        roleId,
        source.card,
        checkpoint
      );
    }
    const readback = await transfers.read(
      env,
      i.targetProvider,
      i.targetToken,
      roleId,
      i.targetAccount
    );
    if ((await cardHash(readback.card)) !== hash)
      throw new HttpError(409, "sync_readback_mismatch");
    if (i.publish && status !== "published" && status !== "pending") {
      await transfers.publish(
        env,
        i.targetProvider,
        i.targetToken,
        roleId
      );
      status = "pending";
    }
    await env.DB.prepare(
      "UPDATE work_copies SET status=?,source_hash=?,target_hash=?,error='',operation=NULL,updated_at=? WHERE work_id=? AND provider=? AND operation=?"
    )
      .bind(status, hash, hash, Date.now(), id, i.targetProvider, operation)
      .run();
    return { workId: id, provider: i.targetProvider, roleId, status };
  } catch (e) {
    const error = creating
      ? "sync_create_unconfirmed"
      : e instanceof HttpError
      ? e.message
      : "sync_failed";
    await env.DB.prepare(
      "UPDATE work_copies SET status=?,error=?,operation=NULL,updated_at=? WHERE work_id=? AND provider=? AND operation=?"
    )
      .bind(
        creating ? "unknown" : "failed",
        error,
        Date.now(),
        id,
        i.targetProvider,
        operation
      )
      .run();
    throw new HttpError(e instanceof HttpError ? e.status : 502, error);
  }
}
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
      `SELECT id,source_provider,source_role_id FROM works WHERE (source_provider=? AND source_role_id=?) OR id IN (SELECT work_id FROM work_copies WHERE provider=? AND role_id=?)`
    )
    .bind(provider, roleId, provider, roleId)
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
  const copies = (
    await db
      .prepare(
        "SELECT provider,role_id AS roleId,status,error,updated_at AS updatedAt FROM work_copies WHERE work_id=?"
      )
      .bind(work.id)
      .all<CopySummary>()
  ).results;
  return [
    {
      provider: work.source_provider,
      roleId: work.source_role_id,
      status: "source",
      error: "",
      updatedAt: 0,
    },
    ...copies,
  ];
}
