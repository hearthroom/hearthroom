import { allowedHarborProxyRequest, PROXY_ROUTES, proxyRoute } from './harbor-api-proxy';

/**
 * 各功能的操作計數，共用一張表、依 metric 分開輸出。每個 metric 列舉自己的合法值，
 * 表裡多出來的列（舊版本、手動寫入）不會變成 Prometheus 標籤。
 */
const METRICS = {
  visibility_read: {
    name:'hearthroom_visibility_reads_total',
    help:'Current work policy checks before returning data; adult and social rules apply separately.',
    label:'surface',
    operations:['list','detail','social','library','metadata','aggregate'],
    outcomes:['allow','denied','unavailable'],
  },
  work_access: {
    name:'hearthroom_visibility_operations_total',
    help:'Durable work policy requests and publication finalization outcomes.',
    label:'operation',
    operations:['bind','private','unlisted','restore','prepare','cancel','restrict','publish','reconcile'],
    outcomes:['success','confirmed','replay','pending','conflict','error'],
  },
  ga4_session: {
    name: "hearthroom_ga4_session_total",
    help: "First-party analytics session IDs issued, reused, or suppressed by GPC.",
    label: "operation",
    operations: ["session"],
    outcomes: ["issued", "reused", "opted_out"],
  },
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
    operations: ["payout", "reconcile", "topup_request", "topup"],
    // insufficient：點數池餘額不足，發放排隊
    outcomes: ["success", "denied", "error", "insufficient"],
  },
  card_heat: {
    name: "hearthroom_card_heat_sync_total",
    help: "Hourly card heat sync: batch reads from the provider.",
    label: "operation",
    operations: ["batch"],
    outcomes: ["success", "error"],
  },
  reward_events: {
    name: "hearthroom_reward_events_total",
    help: "App reward events reported to Harbor: queued, sent, rejected, retried (error), expired, or dropped (bots, repeat visitors).",
    label: "type",
    operations: ["share_open", "share_link_created", "comment_posted", "comment_removed", "author_reply", "rating_set"],
    outcomes: ["queued", "sent", "rejected", "error", "expired", "dropped"],
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
  const pending=await db.prepare("SELECT count(*) AS n FROM (SELECT operation_id FROM visibility_operations WHERE state IN ('intent','pending') UNION SELECT coalesce(sync_operation_id,work_id) FROM managed_work_access WHERE sync_state='changing' OR moderation_revision>confirmed_moderation_revision)").first<{n:number}>();
  out.push('# HELP hearthroom_visibility_pending_operations Work projections awaiting confirmed Provider state.',
    '# TYPE hearthroom_visibility_pending_operations gauge',`hearthroom_visibility_pending_operations ${pending?.n??0}`);
  out.push('# HELP hearthroom_harbor_proxy_requests_total Estimated proxy responses: 1 percent successful responses weighted by 100, all other upstream responses and valid-path errors counted.', '# TYPE hearthroom_harbor_proxy_requests_total counter');
  for (const r of rows.results) {
    const [route, ws] = r.operation.split(':');
    if (r.metric === 'harbor_proxy' && (PROXY_ROUTES as readonly string[]).includes(route)
      && /^(true|false)$/.test(ws ?? '') && r.operation === `${route}:${ws}` && /^[1-5]xx$/.test(r.outcome)) {
      out.push(`hearthroom_harbor_proxy_requests_total{route="${route}",status_class="${r.outcome}",websocket="${ws}"} ${r.value}`);
    }
  }
  return out.join("\n") + "\n";
}

/** Persist after headers/upgrade arrive; never wait for a long-lived stream to close. */
export async function bumpHarborProxy(db: D1Database, request: Request, status: number): Promise<void> {
  // Local path/host refusals are not upstream attempts. Successful streams and
  // reads use a weighted 1% sample to avoid a D1 write for every API request.
  if (!allowedHarborProxyRequest(request)) return;
  const success = status >= 200 && status < 300;
  if (success && Math.random() >= 0.01) return;
  const weight = success ? 100 : 1;
  const route = proxyRoute(new URL(request.url).pathname.slice('/hh-api'.length));
  const websocket = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  const statusClass = `${Math.floor(status / 100)}xx`;
  try {
    await db.prepare('INSERT INTO ops_metrics VALUES (?1, ?2, ?3, ?4) ON CONFLICT(metric, operation, outcome) DO UPDATE SET value = value + ?4')
      .bind('harbor_proxy', `${route}:${websocket}`, statusClass, weight).run();
  } catch { console.warn('Harbor proxy metric unavailable'); }
}
