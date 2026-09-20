import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HttpError, type Env } from "../types";
import { requireMember, memberByHandle, memberNsfw } from "../members";
import { getCard } from "../cards";
import { random, digest, verifyBridge, seal, unseal } from "./crypto";
import {
  enabled,
  site,
  invite,
  beginLink,
  acceptIdentity,
  completeLink,
  unlink,
  communityView,
  publicCommunityView,
  setPreferences,
  projection,
  finishProjection,
  ingestXP,
  snowflake,
  type XPEvent,
} from "./service";
export const communityRoutes = new Hono<{ Bindings: Env }>();
const app = communityRoutes;
app.onError((error, c) =>
  c.json(
    {
      error:
        error instanceof HttpError ? error.message : "community_unavailable",
    },
    error instanceof HttpError ? error.status : 503,
  ),
);
for (const path of [
  "/v1/me/community*",
  "/internal/community/*",
  "/v1/community/discord/callback",
])
  app.use(path, async (c, next) => {
    const operation = c.req.path.startsWith("/internal/")
      ? "bridge"
      : c.req.path.endsWith("/callback")
        ? "oauth"
        : "member";
    let outcome = "success";
    try {
      await next();
      outcome =
        c.res.status < 400
          ? "success"
          : c.res.status < 500
            ? "denied"
            : "error";
    } catch (e) {
      outcome = e instanceof HttpError && e.status < 500 ? "denied" : "error";
      throw e;
    } finally {
      try {
        await c.env.DB.prepare(
          "INSERT INTO community_metrics VALUES(?,?,1) ON CONFLICT(operation,outcome) DO UPDATE SET value=value+1",
        )
          .bind(operation, outcome)
          .run();
      } catch {
        /* Metrics do not change the operation result. */
      }
    }
  });
app.use("/v1/me/community*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});
app.use(
  "/v1/me/community/*",
  bodyLimit({
    maxSize: 16000,
    onError: (c) => c.json({ error: "community_input" }, 413),
  }),
);
app.use(
  "/internal/community/*",
  bodyLimit({
    maxSize: 200000,
    onError: (c) => c.json({ error: "community_input" }, 413),
  }),
);
app.get("/v1/community/config", (c) =>
  c.json({
    enabled: c.env.COMMUNITY_ENABLED === "true",
    invite: invite(c.env),
  }),
);
app.get("/v1/me/community", async (c) =>
  c.json(await communityView(c.env, (await requireMember(c)).id)),
);
app.post("/v1/me/community/link", async (c) => {
  const m = await requireMember(c);
  const b = await c.req.json();
  const started = await beginLink(c.env, m.id, b.nonce);
  return c.json({ url: started.url });
});
app.post("/v1/me/community/complete", async (c) => {
  enabled(c.env);
  const m = await requireMember(c),
    b = await c.req.json();
  if (
    typeof b.receipt !== "string" ||
    typeof b.nonce !== "string" ||
    b.receipt.length > 150 ||
    b.nonce.length > 128
  )
    throw new HttpError(400, "community_input");
  await completeLink(c.env, m.id, b.receipt, b.nonce);
  return c.json(await communityView(c.env, m.id));
});
app.delete("/v1/me/community/link", async (c) => {
  const m = await requireMember(c);
  await unlink(c.env, m.id);
  return c.json(await communityView(c.env, m.id));
});
app.patch("/v1/me/community/preferences", async (c) => {
  const m = await requireMember(c);
  await setPreferences(c.env, m.id, await c.req.json());
  return c.json(await communityView(c.env, m.id));
});
app.post("/v1/me/community/retry", async (c) => {
  const m = await requireMember(c);
  await c.env.DB.prepare(
    "UPDATE community_subjects SET dirty=1,retry_at=0,revision=lower(hex(randomblob(16))),sync_state='pending' WHERE discord_id IN(SELECT discord_id FROM discord_links WHERE member_id=?)",
  )
    .bind(m.id)
    .run();
  return c.json(await communityView(c.env, m.id));
});
app.get("/v1/community/members/:handle", async (c) => {
  c.header("Cache-Control", "no-store");
  const m = await memberByHandle(c.env.DB, c.req.param("handle"));
  return c.json(await publicCommunityView(c.env, m ?? ""));
});
// The OAuth access token is used only for identify and immediately revoked/discarded.
export const discordOAuth = {
  async identify(env: Env, code: string) {
    const fields = {
      client_id: env.DISCORD_CLIENT_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
    };
    const tokenResponse = await fetch(
      "https://discord.com/api/v10/oauth2/token",
      {
        method: "POST",
        body: new URLSearchParams({
          ...fields,
          grant_type: "authorization_code",
          code,
          redirect_uri: site(env) + "/v1/community/discord/callback",
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!tokenResponse.ok) throw new HttpError(400, "community_oauth");
    const token = (await tokenResponse.json()) as { access_token: string };
    try {
      const r = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: "Bearer " + token.access_token },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new HttpError(400, "community_oauth");
      const u = (await r.json()) as {
        id: string;
        global_name?: string;
        username: string;
      };
      return { id: u.id, name: u.global_name || u.username };
    } finally {
      try {
        await fetch("https://discord.com/api/v10/oauth2/token/revoke", {
          method: "POST",
          body: new URLSearchParams({
            ...fields,
            token: token.access_token,
            token_type_hint: "access_token",
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        /* Discard regardless; never persist OAuth tokens. */
      }
    }
  },
};
app.get("/v1/community/discord/callback", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  enabled(c.env);
  const state = c.req.query("state") ?? "",
    code = c.req.query("code") ?? "";
  if (
    state.length > 150 ||
    code.length > 2048 ||
    !code ||
    !(await c.env.DB.prepare(
      "SELECT 1 FROM discord_link_attempts WHERE state=? AND receipt IS NULL AND expires>?",
    )
      .bind(await digest(state), Date.now())
      .first())
  )
    return c.redirect(site(c.env) + "/me#discord_error=expired");
  try {
    const receipt = await acceptIdentity(
      c.env,
      state,
      await discordOAuth.identify(c.env, code),
    );
    return c.redirect(site(c.env) + "/me#discord_receipt=" + receipt);
  } catch {
    return c.redirect(site(c.env) + "/me#discord_error=oauth");
  }
});
app.get("/v1/me/community/notifications", async (c) => {
  const m = await requireMember(c);
  const rows = await c.env.DB.prepare(
    "SELECT id,kind,path,created_at,read_at FROM community_notifications WHERE member_id=? ORDER BY created_at DESC LIMIT 50",
  )
    .bind(m.id)
    .all();
  return c.json({ items: rows.results });
});
app.post("/v1/me/community/notifications/read", async (c) => {
  const m = await requireMember(c),
    b = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE community_notifications SET read_at=? WHERE member_id=? AND id=?",
  )
    .bind(Date.now(), m.id, String(b.id))
    .run();
  return c.json({ ok: true });
});
async function activeCaseLink(env: Env, member: string) {
  const link = await env.DB.prepare(
    "SELECT l.discord_id,l.version FROM discord_links l JOIN community_preferences p ON p.member_id=l.member_id AND p.case_access=1 WHERE l.member_id=? AND l.state='active'",
  )
    .bind(member)
    .first<{ discord_id: string; version: string }>();
  if (!link) throw new HttpError(403, "community_case_link_required");
  return link;
}
app.post("/v1/me/community/cases", async (c) => {
  enabled(c.env);
  const m = await requireMember(c),
    l = await activeCaseLink(c.env, m.id),
    b = await c.req.json();
  if (
    ![
      "list",
      "read",
      "create",
      "supplement",
      "request_close",
      "request_reopen",
    ].includes(b.action) ||
    typeof b.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{20,80}$/.test(b.requestId)
  )
    throw new HttpError(400, "community_input");
  const id = await digest(m.id + ":" + l.version + ":" + b.requestId);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM community_case_jobs WHERE id=? AND member_id=? AND expires>?",
  )
    .bind(id, m.id, Date.now())
    .first();
  if (existing) return c.json({ id });
  if (
    (await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM community_case_jobs WHERE member_id=? AND expires>?",
    )
      .bind(m.id, Date.now())
      .first<{ n: number }>())!.n >= 20
  )
    throw new HttpError(429, "community_rate_limited");
  const payload: Record<string, unknown> = { action: b.action };
  if (b.action === "list") {
    payload.offset =
      Number.isSafeInteger(b.offset) && b.offset >= 0 && b.offset <= 1000
        ? b.offset
        : 0;
  } else if (b.action === "create") {
    if (
      typeof b.title !== "string" ||
      !b.title.trim() ||
      b.title.length > 80 ||
      typeof b.body !== "string" ||
      !b.body.trim() ||
      b.body.length > 1000 ||
      ![
        "bug",
        "billing",
        "account",
        "card_error",
        "review",
        "card_report",
        "general",
      ].includes(b.category)
    )
      throw new HttpError(400, "community_input");
    Object.assign(payload, {
      title: b.title,
      body: b.body,
      category: b.category,
    });
    if (b.card) {
      const card = await getCard(c.env.DB, String(b.card));
      const access = await memberNsfw(c.env.DB, m.id);
      if (
        !card ||
        card.status !== "approved" ||
        card.public_blocked ||
        (card.nsfw && !(access.ageVerifiedAt && access.showNsfw))
      )
        throw new HttpError(404, "not_found");
      const canonical = await c.env.DB.prepare(
        "SELECT work_id FROM community_card_owners WHERE card_id=?",
      )
        .bind(card.id)
        .first<{ work_id: string }>();
      payload.body =
        b.body +
        "\n\n" +
        site(c.env) +
        "/cards/" +
        String(b.card) +
        "\nWork: " +
        (canonical?.work_id ?? "") +
        "\nVersion: " +
        (card.approved_version_id ?? "published");
    }
  } else {
    if (
      typeof b.caseId !== "string" ||
      !/^[a-f0-9]{24}$/.test(b.caseId) ||
      (b.action !== "read" && !Number.isSafeInteger(b.version)) ||
      typeof (b.body ?? "") !== "string" ||
      (b.body ?? "").length > 1400
    )
      throw new HttpError(400, "community_input");
    Object.assign(payload, {
      caseId: b.caseId,
      version: b.version ?? 0,
      body: b.body ?? "",
    });
  }
  await c.env.DB.prepare(
    "DELETE FROM community_case_jobs WHERE id=? AND expires<?",
  )
    .bind(id, Date.now())
    .run();
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO community_case_jobs(id,member_id,discord_id,link_version,payload,expires) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      id,
      m.id,
      l.discord_id,
      l.version,
      await seal(c.env.COMMUNITY_BRIDGE_KEY!, payload),
      Date.now() + 600000,
    )
    .run();
  return c.json({ id });
});
app.get("/v1/me/community/cases/:id", async (c) => {
  const m = await requireMember(c),
    l = await activeCaseLink(c.env, m.id);
  const job = await c.env.DB.prepare(
    "SELECT status,result FROM community_case_jobs WHERE id=? AND member_id=? AND link_version=? AND expires>?",
  )
    .bind(c.req.param("id"), m.id, l.version, Date.now())
    .first<{ status: string; result: string | null }>();
  if (!job) throw new HttpError(404, "not_found");
  return c.json({
    status: job.status,
    result: job.result
      ? await unseal(c.env.COMMUNITY_BRIDGE_KEY!, job.result)
      : null,
  });
});
app.post("/internal/community/:operation", async (c) => {
  c.header("Cache-Control", "no-store");
  const b = await verifyBridge(c.env, c.req.raw),
    op = c.req.param("operation");
  if (b.guild !== c.env.COMMUNITY_GUILD_ID)
    throw new HttpError(403, "community_guild");
  if (op === "card") {
    if (typeof b.card !== "string" || !/^[1-9]\d{0,11}$/.test(b.card))
      throw new HttpError(400, "community_input");
    const card = await getCard(c.env.DB, b.card);
    if (!card || card.status !== "approved" || card.public_blocked || card.nsfw)
      throw new HttpError(404, "not_found");
    const names = JSON.parse(card.names),
      summaries = JSON.parse(card.summaries);
    const language = b.lang === "en" ? "en" : "zh";
    return c.json({
      title: String(names[language] || names.zh || "HearthRoom").slice(0, 100),
      summary: String(summaries[language] || summaries.zh || "").slice(0, 300),
      url: site(c.env) + "/cards/" + b.card,
    });
  }
  if (op === "events") {
    enabled(c.env);
    if (!Array.isArray(b.events) || b.events.length > 50)
      throw new HttpError(400, "community_input");
    const receipts = [];
    for (const event of b.events) {
      try {
        receipts.push({
          id: event.id,
          ...(await ingestXP(c.env, event as XPEvent)),
        });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        receipts.push({ id: event?.id, error: "rejected" });
      }
    }
    return c.json({ receipts });
  }
  if (op === "pending") {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM community_case_jobs WHERE expires<?").bind(
        Date.now(),
      ),
      c.env.DB.prepare(
        "DELETE FROM discord_link_attempts WHERE expires<?",
      ).bind(Date.now()),
      c.env.DB.prepare(
        "DELETE FROM community_notifications WHERE created_at<?",
      ).bind(Date.now() - 2592000000),
    ]);
    const subjects = await c.env.DB.prepare(
      "SELECT discord_id FROM community_subjects WHERE retry_at<? AND (dirty=1 OR synced_at<?) ORDER BY retry_at LIMIT 20",
    )
      .bind(Date.now(), Date.now() - 86400000)
      .all<{ discord_id: string }>();
    const jobs = await c.env.DB.prepare(
      "SELECT j.id FROM community_case_jobs j JOIN discord_links l ON l.member_id=j.member_id AND l.version=j.link_version AND l.state='active' JOIN community_preferences p ON p.member_id=l.member_id AND p.case_access=1 WHERE j.status='pending' AND j.lease_until<? AND j.expires>? LIMIT 10",
    )
      .bind(Date.now(), Date.now())
      .all();
    const notifications = await c.env.DB.prepare(
      "SELECT n.id FROM community_notifications n JOIN community_preferences p ON p.member_id=n.member_id AND p.discord_dm=1 AND p.notifications=1 JOIN discord_links l ON l.member_id=n.member_id AND l.state='active' WHERE n.delivered=0 AND n.retry_at<? AND (n.author_id IS NULL OR EXISTS(SELECT 1 FROM member_follows f WHERE f.member_id=n.member_id AND f.author_id=n.author_id)) ORDER BY n.created_at LIMIT 10",
    )
      .bind(Date.now())
      .all();
    const review = await c.env.DB.prepare(
      "SELECT revision FROM community_review_signal WHERE delivered=0",
    ).first();
    return c.json({
      subjects: subjects.results.map((r) => r.discord_id),
      jobs: jobs.results,
      notifications: notifications.results,
      review,
    });
  }
  if (op === "projection" || op === "ack" || op === "xp-preference") {
    if (!snowflake(b.user)) throw new HttpError(400, "community_input");
    if (op === "ack")
      return c.json({
        accepted: await finishProjection(
          c.env,
          b.user,
          String(b.revision),
          String(b.state),
        ),
      });
    if (op === "xp-preference") {
      if (typeof b.enabled !== "boolean")
        throw new HttpError(400, "community_input");
      await c.env.DB.prepare(
        "INSERT INTO community_subjects(discord_id,xp_enabled) VALUES(?,?) ON CONFLICT(discord_id) DO UPDATE SET xp_enabled=excluded.xp_enabled",
      )
        .bind(b.user, b.enabled ? 1 : 0)
        .run();
    }
    return c.json(await projection(c.env, b.user));
  }
  if (op === "case-lease") {
    const lease = random(),
      now = Date.now();
    const j = await c.env.DB.prepare(
      `UPDATE community_case_jobs SET lease=?,lease_until=? WHERE id=? AND status='pending' AND lease_until<? AND expires>? AND EXISTS(SELECT 1 FROM discord_links l JOIN community_preferences p ON p.member_id=l.member_id AND p.case_access=1 WHERE l.member_id=community_case_jobs.member_id AND l.version=community_case_jobs.link_version AND l.state='active') RETURNING id,discord_id,link_version,payload`,
    )
      .bind(lease, now + 15000, String(b.id), now, now)
      .first<{
        id: string;
        discord_id: string;
        link_version: string;
        payload: string;
      }>();
    if (!j) throw new HttpError(409, "community_stale");
    return c.json({
      id: j.id,
      user: j.discord_id,
      version: j.link_version,
      lease,
      expires: now + 15000,
      payload: await unseal(c.env.COMMUNITY_BRIDGE_KEY!, j.payload),
    });
  }
  if (op === "case-check" || op === "case-result") {
    const j = await c.env.DB.prepare(
      `SELECT j.id FROM community_case_jobs j JOIN discord_links l ON l.member_id=j.member_id AND l.version=j.link_version AND l.state='active' JOIN community_preferences p ON p.member_id=l.member_id AND p.case_access=1 WHERE j.id=? AND j.lease=? AND j.lease_until>? AND j.expires>?`,
    )
      .bind(String(b.id), String(b.lease), Date.now(), Date.now())
      .first();
    if (!j) throw new HttpError(409, "community_stale");
    if (op === "case-result")
      await c.env.DB.prepare(
        "UPDATE community_case_jobs SET result=?,status='done' WHERE id=? AND lease=?",
      )
        .bind(
          await seal(c.env.COMMUNITY_BRIDGE_KEY!, b.result),
          String(b.id),
          String(b.lease),
        )
        .run();
    return c.json({ ok: true });
  }
  if (op === "notification") {
    const n = await c.env.DB.prepare(
      "SELECT n.kind,n.path,l.discord_id FROM community_notifications n JOIN discord_links l ON l.member_id=n.member_id AND l.state='active' JOIN community_preferences p ON p.member_id=n.member_id AND p.discord_dm=1 AND p.notifications=1 WHERE n.id=? AND n.delivered=0 AND (n.author_id IS NULL OR EXISTS(SELECT 1 FROM member_follows f WHERE f.member_id=n.member_id AND f.author_id=n.author_id))",
    )
      .bind(String(b.id))
      .first();
    if (!n) throw new HttpError(404, "not_found");
    if (b.delivered === true)
      await c.env.DB.prepare(
        "UPDATE community_notifications SET delivered=1 WHERE id=?",
      )
        .bind(String(b.id))
        .run();
    else
      await c.env.DB.prepare(
        "UPDATE community_notifications SET retry_at=? WHERE id=?",
      )
        .bind(Date.now() + 300000, String(b.id))
        .run();
    return c.json(n);
  }
  if (op === "review-ack") {
    await c.env.DB.prepare(
      "UPDATE community_review_signal SET delivered=1 WHERE revision=?",
    )
      .bind(String(b.revision))
      .run();
    return c.json({ ok: true });
  }
  throw new HttpError(404, "not_found");
});
