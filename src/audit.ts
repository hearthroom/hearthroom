/**
 * 稽核（開業活動設計 §9.1）：誰、什麼時候、對什麼、做了什麼、為什麼、改前改後。
 *
 * 只追加。回傳一條 prepared statement，呼叫端把它放進跟業務寫入同一個 db.batch：
 * 業務成功但稽核沒寫，等於這次操作沒人知道是誰做的。operation_id 讓連點與重試只留一筆。
 */
export const AUDIT_SUBJECTS = ["comment", "comment_report", "comment_keyword", "member", "community_settings"] as const;
export type AuditSubject = (typeof AUDIT_SUBJECTS)[number];
export type ActorKind = "human" | "ai" | "system";

export interface AuditEntry {
  subjectKind: AuditSubject;
  subjectId: string;
  actorMemberId: string | null;
  actorKind: ActorKind;
  action: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  operationId: string;
  now: number;
}

export function auditStmt(db: D1Database, e: AuditEntry): D1PreparedStatement {
  if (!(AUDIT_SUBJECTS as readonly string[]).includes(e.subjectKind)) throw new Error(`unknown audit subject: ${e.subjectKind}`);
  return db
    .prepare("INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), e.subjectKind, e.subjectId, e.actorMemberId, e.actorKind, e.action, e.reason ?? "", JSON.stringify(e.before ?? {}), JSON.stringify(e.after ?? {}), e.operationId, e.now);
}
