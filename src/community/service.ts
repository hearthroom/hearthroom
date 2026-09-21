import { SANDBOX_PARENT_ORIGINS } from '../../shared/site-hosts';
import { activeAwardKeys } from './badges';
import { appearanceView, projectAppearance, type AppearancePreferences } from './appearance';
import { HttpError, type Env } from "../types";
import { digest, random } from "./crypto";
export const snowflake = (v: unknown): v is string =>
  typeof v === "string" && /^\d{17,20}$/.test(v);
export function enabled(env: Env) {
  if (
    env.COMMUNITY_ENABLED !== "true" ||
    !env.COMMUNITY_SITE_URL ||
    !env.COMMUNITY_GUILD_ID ||
    !env.COMMUNITY_BRIDGE_KEY ||
    !/^[a-f0-9]{64}$/i.test(env.COMMUNITY_BRIDGE_KEY)
  )
    throw new HttpError(503, "community_unavailable");
}
export function site(env: Env) {
  const url = new URL(env.COMMUNITY_SITE_URL!);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new HttpError(503, "community_unavailable");
  return url.origin;
}
export const level = (xp: number) => Math.floor(Math.sqrt(xp / 10));
export async function beginLink(env: Env, member: string, nonce: string, returnOrigin = site(env)) {
  enabled(env);
  if (returnOrigin !== site(env) && !SANDBOX_PARENT_ORIGINS.includes(returnOrigin))
    throw new HttpError(400, "community_input");
  if (
    !env.DISCORD_CLIENT_ID ||
    !env.DISCORD_CLIENT_SECRET ||
    typeof nonce !== "string" ||
    nonce.length < 32 ||
    nonce.length > 128
  )
    throw new HttpError(400, "community_input");
  if (
    await env.DB.prepare("SELECT 1 FROM discord_links WHERE member_id=?")
      .bind(member)
      .first()
  )
    throw new HttpError(409, "community_link_conflict");
  const state = random() + "~" + returnOrigin;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM discord_link_attempts WHERE expires<? OR member_id=?",
    ).bind(now, member),
    env.DB.prepare(
      "INSERT INTO discord_link_attempts(state,member_id,nonce,expires) VALUES(?,?,?,?)",
    ).bind(await digest(state), member, await digest(nonce), now + 600000),
  ]);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: site(env) + "/v1/community/discord/callback",
    response_type: "code",
    scope: "identify",
    state,
  }).toString();
  return { state, url: url.toString() };
}
/** Use only after the complete state matched its stored digest; old attempts use the canonical site. */
export function linkReturnOrigin(env: Env, state: string): string {
  const origin = state.split('~')[1];
  return origin === site(env) || SANDBOX_PARENT_ORIGINS.includes(origin) ? origin : site(env);
}
export async function acceptIdentity(
  env: Env,
  state: string,
  identity: { id: string; name: string },
) {
  if (!snowflake(identity.id)) throw new HttpError(400, "community_identity");
  const receipt = random();
  const row = await env.DB.prepare(
    "UPDATE discord_link_attempts SET receipt=?,discord_id=?,name=? WHERE state=? AND receipt IS NULL AND consumed=0 AND expires>? RETURNING state",
  )
    .bind(
      await digest(receipt),
      identity.id,
      identity.name.slice(0, 80),
      await digest(state),
      Date.now(),
    )
    .first();
  if (!row) throw new HttpError(400, "community_expired");
  return receipt;
}
export async function completeLink(
  env: Env,
  member: string,
  receipt: string,
  nonce: string,
) {
  const hashed = await digest(receipt),
    proof = await digest(nonce),
    now = Date.now();
  const attempt = await env.DB.prepare(
    "SELECT * FROM discord_link_attempts WHERE receipt=? AND member_id=? AND nonce=? AND consumed=0 AND expires>?",
  )
    .bind(hashed, member, proof, now)
    .first<{ discord_id: string; name: string; state: string }>();
  if (!attempt) throw new HttpError(400, "community_expired");
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO community_subjects(discord_id) VALUES(?)",
      ).bind(attempt.discord_id),
      env.DB.prepare(
        `INSERT INTO discord_links(member_id,discord_id,name,version,created_at)
 SELECT member_id,discord_id,name,state,? FROM discord_link_attempts WHERE receipt=? AND member_id=? AND nonce=? AND consumed=0 AND expires>?`,
      ).bind(now, hashed, member, proof, now),
      env.DB.prepare(
        "UPDATE discord_link_attempts SET consumed=1 WHERE receipt=? AND EXISTS(SELECT 1 FROM discord_links WHERE version=discord_link_attempts.state)",
      ).bind(hashed),
    ]);
    if (!results[1].meta.changes) throw new Error("expired");
  } catch {
    throw new HttpError(409, "community_link_conflict");
  }
}
export async function unlink(env: Env, member: string) {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE discord_links SET state='cleanup',version=? WHERE member_id=? AND state='active'",
    ).bind(random(), member),
    env.DB.prepare("DELETE FROM community_case_jobs WHERE member_id=?").bind(
      member,
    ),
    env.DB.prepare("DELETE FROM discord_link_attempts WHERE member_id=?").bind(
      member,
    ),
    env.DB.prepare(
      "UPDATE community_preferences SET case_access=0,discord_dm=0 WHERE member_id=?",
    ).bind(member),
  ]);
}
export async function projection(env: Env, user: string) {
  const row = await env.DB.prepare(
    `SELECT s.*,l.member_id,l.version,l.state,m.handle FROM community_subjects s LEFT JOIN discord_links l ON l.discord_id=s.discord_id LEFT JOIN members m ON m.id=l.member_id WHERE s.discord_id=?`,
  )
    .bind(user)
    .first<{
      revision: string;
      xp_enabled: number;
      state: string | null;
      member_id: string | null;
      version: string | null;
      handle: string | null;
      sync_state: string;
      synced_at: number | null;
    }>();
  if (!row)
    return {
      revision: "",
      xp: 0,
      level: 0,
      linked: false,
      cleanup: false,
      badges: [] as string[],
      state: "unlinked",
      handle: null,
      version: null,
    };
  const xp = await env.DB.prepare(
    "SELECT COALESCE(SUM(points),0) AS xp FROM community_xp WHERE discord_id=?",
  )
    .bind(user)
    .first<{ xp: number }>();
  const linked = row.state === "active";
  const badges = linked ? await activeAwardKeys(env,row.member_id!) : [];
  return {
    revision: row.revision,
    xp: xp!.xp,
    level: level(xp!.xp),
    linked,
    cleanup: row.state === "cleanup",
    badges,
    state:
      row.state === "cleanup"
        ? "cleanup"
        : row.sync_state === "synced" &&
            (!row.synced_at || row.synced_at < Date.now() - 86400000)
          ? "pending"
          : row.sync_state,
    handle: linked ? row.handle : null,
    version: linked ? row.version : null,
  };
}
export async function finishProjection(
  env: Env,
  user: string,
  revision: string,
  state: string,
) {
  if (!["synced", "not_member", "denied", "failed"].includes(state))
    throw new HttpError(400, "community_input");
  const result = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM discord_links WHERE discord_id=? AND state='cleanup' AND EXISTS(SELECT 1 FROM community_subjects WHERE discord_id=? AND revision=?) AND ? IN ('synced','not_member')`,
    ).bind(user, user, revision, state),
    env.DB.prepare(
      "UPDATE community_subjects SET dirty=?,sync_state=?,synced_at=?,retry_at=? WHERE discord_id=? AND revision=?",
    ).bind(
      state === "synced" || state === "not_member" ? 0 : 1,
      state,
      Date.now(),
      Date.now() + 60000,
      user,
      revision,
    ),
  ]);
  return !!result[1].meta.changes;
}
async function memberBadges(env: Env, member: string) {
  const badges = await activeAwardKeys(env,member);
  if(await env.DB.prepare("SELECT 1 FROM discord_links WHERE member_id=? AND state='active'").bind(member).first()) badges.unshift('discord_linked');
  if((await appearanceView(env,member)).supporter.active) badges.push('server_booster');
  return badges;
}

type PublicIdentity = {badges:string[];level?:number;appearance?:Awaited<ReturnType<typeof appearanceView>>['effective']};
/** A cold page is one joined projection, rather than a chain of queries per author. */
export async function publicCommunityViews(env:Env,members:string[]):Promise<Map<string,PublicIdentity>> {
 if(!members.length)return new Map();
 const rows=(await env.DB.prepare(`SELECT m.id,p.public_badges,p.public_level,l.member_id AS linked,
 a.verified_at,a.boosting_since,a.assets,ap.avatar_source,ap.name_style,ap.frame,ap.public_enabled,
 CASE WHEN p.public_badges=1 THEN (SELECT json_group_array(badge) FROM
  (SELECT badge FROM community_awards WHERE member_id=m.id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) ORDER BY badge)) ELSE '[]' END AS badges,
 CASE WHEN p.public_level=1 AND l.member_id IS NOT NULL THEN
  (SELECT COALESCE(SUM(points),0) FROM community_xp WHERE discord_id=l.discord_id) END AS xp
 FROM members m LEFT JOIN community_preferences p ON p.member_id=m.id
 LEFT JOIN discord_links l ON l.member_id=m.id AND l.state='active'
 LEFT JOIN community_discord_appearance a ON a.member_id=m.id AND a.link_version=l.version
 LEFT JOIN community_appearance_preferences ap ON ap.member_id=m.id
 WHERE m.id IN (${members.map(()=>'?').join(',')})`).bind(Date.now(),...members).all<{
 id:string;public_badges:number|null;public_level:number|null;linked:string|null;verified_at:number|null;boosting_since:number|null;assets:string|null;
 avatar_source:AppearancePreferences['avatarSource']|null;name_style:AppearancePreferences['nameStyle'];frame:AppearancePreferences['frame'];public_enabled:number;badges:string;xp:number|null;
 }>()).results;
 return new Map(rows.map(row=>{
  const appearance=projectAppearance(env,row.avatar_source?{...row,avatar_source:row.avatar_source}:null,row.verified_at===null?null:{verified_at:row.verified_at,boosting_since:row.boosting_since,assets:row.assets??'{}'},true);
  const badges:string[]=JSON.parse(row.badges);
  if(row.public_badges){if(row.linked)badges.unshift('discord_linked');if(appearance.supporter.active)badges.push('server_booster');}
  const result:PublicIdentity={badges};
  if(row.public_level&&row.xp!==null)result.level=level(row.xp);
  if(appearance.effective.avatarUrl||appearance.effective.nameStyle!=='none'||appearance.effective.frame!=='none')result.appearance=appearance.effective;
  return [row.id,result];
 }));
}
export async function publicCommunityView(env: Env, member: string):Promise<PublicIdentity> {
 return (await publicCommunityViews(env,[member])).get(member)??{badges:[]};
}

export async function communityView(env: Env, member: string) {
  const link = await env.DB.prepare(
    "SELECT discord_id,name,state FROM discord_links WHERE member_id=?",
  )
    .bind(member)
    .first<{ discord_id: string; name: string; state: string }>();
  const p = link ? await projection(env, link.discord_id) : null;
  const preferences = (await env.DB.prepare(
    "SELECT public_badges,public_level,notifications,discord_dm,case_access FROM community_preferences WHERE member_id=?",
  )
    .bind(member)
    .first()) ?? {
    public_badges: 0,
    public_level: 0,
    notifications: 0,
    discord_dm: 0,
    case_access: 0,
  };
  const xpEnabled = link
    ? !!(
        await env.DB.prepare(
          "SELECT xp_enabled FROM community_subjects WHERE discord_id=?",
        )
          .bind(link.discord_id)
          .first<{ xp_enabled: number }>()
      )?.xp_enabled
    : true;
  const badges = await memberBadges(env, member);
  return {
    enabled: env.COMMUNITY_ENABLED === "true",
    invite: invite(env),
    link: link
      ? {
          name: link.name,
          state: link.state === "cleanup" ? "cleanup" : p!.state,
        }
      : null,
    xp: link?.state === "active" ? p!.xp : 0,
    level: link?.state === "active" ? p!.level : 0,
    badges,
    preferences,
    xpEnabled,
    appearance: await appearanceView(env,member),
  };
}
export function invite(env: Env) {
  try {
    const u = new URL(env.COMMUNITY_INVITE_URL ?? "");
    return u.protocol === "https:" &&
      ["discord.gg", "discord.com"].includes(u.hostname)
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
export async function setPreferences(
  env: Env,
  member: string,
  input: Record<string, unknown>,
) {
  const keys = {
    publicBadges: "public_badges",
    publicLevel: "public_level",
    notifications: "notifications",
    discordDm: "discord_dm",
    caseAccess: "case_access",
  };
  if (
    Object.entries(input).some(
      ([key, value]) =>
        ![...Object.keys(keys), "xpEnabled"].includes(key) ||
        typeof value !== "boolean",
    )
  )
    throw new HttpError(400, "community_input");
  const statements = [
    env.DB.prepare(
      "INSERT OR IGNORE INTO community_preferences(member_id) VALUES(?)",
    ).bind(member),
  ];
  for (const [key, column] of Object.entries(keys))
    if (key in input)
      statements.push(
        env.DB.prepare(
          `UPDATE community_preferences SET ${column}=? WHERE member_id=?`,
        ).bind(input[key] ? 1 : 0, member),
      );
  if ("xpEnabled" in input)
    statements.push(
      env.DB.prepare(
        "UPDATE community_subjects SET xp_enabled=? WHERE discord_id IN(SELECT discord_id FROM discord_links WHERE member_id=? AND state='active')",
      ).bind(input.xpEnabled ? 1 : 0, member),
    );
  if (input.caseAccess === false)
    statements.push(
      env.DB.prepare("DELETE FROM community_case_jobs WHERE member_id=?").bind(
        member,
      ),
    );
  await env.DB.batch(statements);
}
export interface XPEvent {
  id: string;
  user: string;
  channel: string;
  time: number;
}
export async function ingestXP(env: Env, event: XPEvent, now = Date.now()) {
  if (
    !event ||
    !snowflake(event.id) ||
    !snowflake(event.user) ||
    !snowflake(event.channel) ||
    !(env.COMMUNITY_XP_CHANNELS ?? "")
      .split(",")
      .map((v) => v.trim())
      .includes(event.channel) ||
    !Number.isSafeInteger(event.time) ||
    event.time > now + 5000 ||
    event.time < now - 86400000
  )
    throw new HttpError(400, "community_event");
  const day = Math.floor(event.time / 86400000) * 86400000;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO community_subjects(discord_id) VALUES(?)",
    ).bind(event.user),
    env.DB.prepare(
      `INSERT OR IGNORE INTO community_xp(event_id,discord_id,event_time,points)
 SELECT ?,?,?,CASE WHEN s.xp_enabled=1 AND NOT EXISTS(SELECT 1 FROM community_xp WHERE discord_id=? AND points>0 AND ABS(event_time-?)<60000)
 AND (SELECT COUNT(*) FROM community_xp WHERE discord_id=? AND points>0 AND event_time>=? AND event_time<?)<60 THEN 1 ELSE 0 END FROM community_subjects s WHERE discord_id=?`,
    ).bind(
      event.id,
      event.user,
      event.time,
      event.user,
      event.time,
      event.user,
      day,
      day + 86400000,
      event.user,
    ),
  ]);
  return await env.DB.prepare(
    "SELECT points FROM community_xp WHERE event_id=?",
  )
    .bind(event.id)
    .first();
}
/** Also runs on the website schedule when the bot is offline. Reads enforce expiry independently. */
export async function communityMaintenance(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE community_awards SET expiry_notified=1 WHERE expires_at<=? AND expiry_notified=0").bind(now),
    env.DB.prepare("DELETE FROM community_case_jobs WHERE expires<?").bind(now),
    env.DB.prepare("DELETE FROM discord_link_attempts WHERE expires<?").bind(
      now,
    ),
    env.DB.prepare("DELETE FROM community_nonces WHERE expires<?").bind(now),
    env.DB.prepare(
      "DELETE FROM community_notifications WHERE created_at<?",
    ).bind(now - 2592000000),
  ]);
}
