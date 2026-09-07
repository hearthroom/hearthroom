#!/usr/bin/env node
/**
 * 把一個主站帳號登記成本站的審核人（初期由站方手動做；之後由 Discord bot 接手）。
 *
 *   node scripts/grant-reviewer.mjs <accountNumId> [--revoke] [--local]
 *
 * accountNumId 是主站的公開數字 ID（他在本站登入後，主站 /open/v1/me 回的那個）。
 * 成員不存在就建一個（他還沒登入過也能先登記，第一次登入會對上同一個身分）。
 * 走 wrangler d1 execute，所以需要能部署的 Cloudflare 登入態；--local 打本機資料庫。
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const local = args.includes("--local");
const id = args.find((a) => /^\d+$/.test(a));
if (!id) {
  console.error("用法：node scripts/grant-reviewer.mjs <accountNumId> [--revoke] [--local]");
  process.exit(2);
}
const memberId = `m-lunatalk-${id}`;
const now = Date.now();
const sql = revoke
  ? `UPDATE reviewers SET revoked_at = ${now} WHERE member_id IN (SELECT member_id FROM member_identities WHERE provider = 'lunatalk' AND external_id = '${id}') AND revoked_at IS NULL;`
  : [
      `INSERT OR IGNORE INTO members (id, created_at) VALUES ('${memberId}', ${now});`,
      `INSERT OR IGNORE INTO member_identities (provider, external_id, member_id, linked_at) VALUES ('lunatalk', '${id}', '${memberId}', ${now});`,
      `INSERT INTO reviewers (member_id, granted_at, granted_by) SELECT member_id, ${now}, 'manual' FROM member_identities WHERE provider = 'lunatalk' AND external_id = '${id}' ON CONFLICT(member_id) DO UPDATE SET revoked_at = NULL, granted_at = ${now};`,
    ].join(" ");

const r = spawnSync("npx", ["wrangler", "d1", "execute", "DB", local ? "--local" : "--remote", "--command", sql], { stdio: "inherit" });
process.exit(r.status ?? 1);
