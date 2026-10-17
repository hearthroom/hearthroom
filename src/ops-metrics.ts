/**
 * 各功能的操作計數，共用一張表、依 metric 分開輸出。每個 metric 列舉自己的合法值，
 * 表裡多出來的列（舊版本、手動寫入）不會變成 Prometheus 標籤。
 */
const METRICS = {
  draft_transfer_gate: {
    name: "hearthroom_draft_transfer_gate_total",
    help: "Durable scoped transfer barrier transitions and rejected admission.",
    label: "operation",
    operations: ["transition", "admission"],
    outcomes: ["success", "denied", "error"],
  },
  comment_moderation: {
    name: "hearthroom_comment_moderation_total",
    help: "Comment moderation: holds, releases, removals, mutes, reports, AI flags, keyword and settings changes.",
    label: "action",
    operations: ["hold", "release", "remove", "mute", "unmute", "report", "flag", "dismiss", "keyword", "settings"],
    outcomes: ["success", "denied", "error"],
  },
  blog: {
    name: "hearthroom_blog_operations_total",
    help: "Official blog: saves, publishing, pinning, comment switch, restores, column changes, image uploads and reader likes.",
    label: "operation",
    operations: ["save", "publish", "unpublish", "pin", "comments", "restore", "column", "image", "like", "unlike"],
    outcomes: ["success", "denied", "error"],
  },
  campaign: {
    name: "hearthroom_campaign_operations_total",
    help: "Share-reward campaign: settings, submissions, review decisions, payouts, reconciliation and evidence screenshots.",
    label: "operation",
    operations: ["settings", "submit", "resubmit", "decide", "payout", "reconcile", "evidence_upload", "evidence_view", "purge"],
    // insufficient：點數池餘額不足，發放排隊（只有發錢的指標有）
    outcomes: ["success", "denied", "error", "insufficient"],
  },
  card_reward: {
    name: "hearthroom_card_reward_operations_total",
    help: "Card-publish reward campaign: payouts to authors of approved cards and reconciliation with the provider.",
    label: "operation",
    operations: ["payout", "reconcile"],
    // insufficient：點數池餘額不足，發放排隊
    outcomes: ["success", "denied", "error", "insufficient"],
  },
} as const;
export type OpsMetric = keyof typeof METRICS;

/** outcome 由各指標自己的 outcomes 推出：insufficient 只在發錢的指標合法。 */
export async function bumpOp<M extends OpsMetric>(db: D1Database, metric: M, operation: string, outcome: (typeof METRICS)[M]["outcomes"][number], by = 1): Promise<void> {
  try {
    await db.prepare("INSERT INTO ops_metrics VALUES (?1, ?2, ?3, ?4) ON CONFLICT(metric, operation, outcome) DO UPDATE SET value = value + ?4").bind(metric, operation, outcome, by).run();
  } catch {
    console.warn("Ops metric unavailable");
  }
}

export async function opsMetrics(db: D1Database): Promise<string> {
  const rows = await db.prepare("SELECT metric, operation, outcome, value FROM ops_metrics ORDER BY metric, operation, outcome").all<{ metric: string; operation: string; outcome: string; value: number }>();
  const out: string[] = [];
  for (const [key, m] of Object.entries(METRICS)) {
    out.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} counter`);
    for (const r of rows.results) {
      if (r.metric === key && (m.operations as readonly string[]).includes(r.operation) && (m.outcomes as readonly string[]).includes(r.outcome)) {
        out.push(`${m.name}{${m.label}="${r.operation}",outcome="${r.outcome}"} ${r.value}`);
      }
    }
  }
  return out.join("\n") + "\n";
}
