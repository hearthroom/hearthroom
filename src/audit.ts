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
  /** 呼叫端自己給 id，同一個 batch 的後續語句才能以「這一次的稽核列存在」為條件。沒給就產生一個。 */
  id?: string;
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

const AUDIT_COLUMNS = "(id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)";

function auditValues(e: AuditEntry): unknown[] {
  if (!(AUDIT_SUBJECTS as readonly string[]).includes(e.subjectKind)) throw new Error(`unknown audit subject: ${e.subjectKind}`);
  return [e.id ?? crypto.randomUUID(), e.subjectKind, e.subjectId, e.actorMemberId, e.actorKind, e.action, e.reason ?? "", JSON.stringify(e.before ?? {}), JSON.stringify(e.after ?? {}), e.operationId, e.now];
}

export function auditStmt(db: D1Database, e: AuditEntry): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_log ${AUDIT_COLUMNS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...auditValues(e));
}

/** 只在同一個 batch 裡前一條語句真的改到列時才寫（SQLite changes()）；條件式更新輸了，稽核就不留。 */
export function auditStmtIfChanged(db: D1Database, e: AuditEntry): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_log ${AUDIT_COLUMNS} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(...auditValues(e));
}
