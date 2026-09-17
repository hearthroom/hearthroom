import type { TransferProgress } from "./card-transfer-resources";
import { MEDIA_FIELDS } from "./card-media";
import { transfers, type TransferCard, type WorldbookMap } from "./card-transfer";
import { HttpError, type Env } from "./types";
import type { ProviderId } from "./providers";
import { memberProfile } from "./members";
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
        ...(card.translations?{translations:card.translations}:{}),
        media: MEDIA_FIELDS.map((key) => card.media?.[key] ?? ""),
        // 開場白備選／序章、世界書條目（不含兩邊各自的 id）、作者資產：改了任何一項都要再同步。
        welcome: card.welcome ?? null,
        worldbooks: (card.worldbooks ?? []).map((b) => ({ name: b.name, entries: b.entries, ...(b.metadata?{metadata:b.metadata}:{}) })),
        authorAsset: card.authorAsset ?? null,
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
  worldbooks: string;
  transfer_state: string;
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
  let books: WorldbookMap = {};
  try {
    books = JSON.parse(row.worldbooks || "{}");
  } catch {
    books = {};
  }
  const progress:TransferProgress=JSON.parse(row.transfer_state||'{"books":{}}');
  for(const [sourceId,remoteId] of Object.entries(books)) {
    if(!progress.books[sourceId])progress.books[sourceId]={id:remoteId,status:'created'};
  }
  const saveProgress=async()=>{
    const saved=await env.DB.prepare("UPDATE work_copies SET transfer_state=?,updated_at=? WHERE work_id=? AND provider=? AND operation=?")
      .bind(JSON.stringify(progress),Date.now(),id,i.targetProvider,operation).run();
    if(!saved.meta.changes)throw new HttpError(409,"sync_busy");
  };
  // 假來源（測試）的 update 沒有回傳值：對照表就維持原樣。
  const remember = (next: WorldbookMap | void) => {
    if (next) books = next;
  };
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
        remember(await transfers.update(
          env,
          i.targetProvider,
          i.targetToken,
          roleId,
          source.card,
          checkpoint,
          progress, saveProgress
        ));
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
      remember(await transfers.update(
        env,
        i.targetProvider,
        i.targetToken,
        roleId,
        source.card,
        checkpoint,
        progress, saveProgress
      ));
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
      "UPDATE work_copies SET status=?,source_hash=?,target_hash=?,worldbooks=?,error='',operation=NULL,updated_at=? WHERE work_id=? AND provider=? AND operation=?"
    )
      .bind(status, hash, hash, JSON.stringify(books), Date.now(), id, i.targetProvider, operation)
      .run();
    return { workId: id, provider: i.targetProvider, roleId, status };
  } catch (e) {
    const error = creating
      ? "sync_create_unconfirmed"
      : e instanceof HttpError
      ? e.message
      : "sync_failed";
    await env.DB.prepare(
      "UPDATE work_copies SET status=?,error=?,worldbooks=?,operation=NULL,updated_at=? WHERE work_id=? AND provider=? AND operation=?"
    )
      .bind(
        creating ? "unknown" : "failed",
        error,
        JSON.stringify(books),
        Date.now(),
        id,
        i.targetProvider,
        operation
      )
      .run();
    throw new HttpError(e instanceof HttpError ? e.status : 502, error);
  }
}
export interface DistributeTarget {
  provider: ProviderId;
  token: string;
}
/**
 * 登記即分發（owner 2026-09-17）：作者按下登記，卡就排進其他已登入渠道的同步。
 * 這條在回應之後跑（executionCtx.waitUntil），登記本身不等它；結果落在 work_copies，
 * 「我的卡片」的分發面板讀那裡。一家失敗不影響另一家，也不影響登記。
 */
export async function distributeCard(
  env: Env,
  memberId: string,
  source: { provider: ProviderId; roleId: string; account: number; token: string },
  targets: DistributeTarget[]
): Promise<void> {
  const profile = await memberProfile(env.DB, memberId);
  for (const target of targets) {
    if (target.provider === source.provider) continue;
    try {
      const who = await (await import("./upstream")).upstream.fetchMe(env, target.token, target.provider);
      // 目標帳號要是這個成員綁過的：不能拿別人的 token 把卡寫進別人的帳號
      if (!profile?.identities.some((x) => x.provider === target.provider && x.externalId === who.accountNumId)) {
        console.error("distribute skipped: target account not connected", { provider: target.provider });
        continue;
      }
      await syncCard(env, {
        memberId,
        sourceProvider: source.provider,
        sourceRoleId: source.roleId,
        sourceAccount: source.account,
        sourceToken: source.token,
        targetProvider: target.provider,
        targetAccount: who.accountNumId,
        targetToken: target.token,
        publish: true,
      });
    } catch (err) {
      // syncCard 已把失敗原因寫進 work_copies.error；這裡只留一行給日誌
      console.error("distribute failed", { provider: target.provider, error: String(err) });
    }
  }
}
/**
 * 這一批卡在別家已發布的副本：`來源家:來源卡 id` → 副本們。每小時同步把副本的對話數加進來源那張。
 * 一次查完整批（json_each 展開），D1 呼叫也算子請求，逐張查會吃掉上游的額度。
 */
export async function publishedCopiesFor(
  db: D1Database,
  cards: { provider: string; source_role_id: string }[]
): Promise<Map<string, { provider: ProviderId; roleId: string }[]>> {
  const out = new Map<string, { provider: ProviderId; roleId: string }[]>();
  if (!cards.length) return out;
  const rows = await db
    .prepare(
      `SELECT w.source_provider, w.source_role_id, wc.provider, wc.role_id FROM works w
         JOIN work_copies wc ON wc.work_id = w.id
        WHERE wc.status = 'published' AND wc.role_id IS NOT NULL
          AND w.source_role_id IN (SELECT value FROM json_each(?))`
    )
    .bind(JSON.stringify(cards.map((c) => c.source_role_id)))
    .all<{ source_provider: string; source_role_id: string; provider: ProviderId; role_id: string }>();
  const wanted = new Set(cards.map((c) => `${c.provider}:${c.source_role_id}`));
  for (const r of rows.results) {
    const key = `${r.source_provider}:${r.source_role_id}`;
    if (!wanted.has(key)) continue;
    out.set(key, [...(out.get(key) ?? []), { provider: r.provider, roleId: r.role_id }]);
  }
  return out;
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
