import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { makeMember, resetDb } from "./helpers";
import {
  beginLink,
  completeLink,
  acceptIdentity,
  unlink,
  communityView,
  ingestXP,
  setPreferences,
  finishProjection,
  projection,
} from "../src/community/service";
import { sign, verifyBridge } from "../src/community/crypto";
import type { Env } from "../src/types";
const config = () =>
  ({
    ...env,
    COMMUNITY_ENABLED: "true",
    COMMUNITY_GUILD_ID: "123456789012345678",
    COMMUNITY_BRIDGE_KEY: "a".repeat(64),
    DISCORD_CLIENT_ID: "223456789012345678",
    DISCORD_CLIENT_SECRET: "test",
    COMMUNITY_SITE_URL: "https://hearthroom.club",
    COMMUNITY_XP_CHANNELS: "323456789012345678",
  }) as Env;
const user = "423456789012345678";
const nonce = "browser-proof-12345678901234567890";
async function linked(member: string, id = user) {
  const start = await beginLink(config(), member, nonce);
  const receipt = await acceptIdentity(config(), start.state, {
    id,
    name: "Member",
  });
  await completeLink(config(), member, receipt, nonce);
}
beforeEach(resetDb);
describe("community identity and source ledger", () => {
  it("requires the initiating member and browser, consumes the receipt once, hides Discord identity publicly", async () => {
    const member = await makeMember(1),
      other = await makeMember(2);
    const start = await beginLink(config(), member, nonce);
    const receipt = await acceptIdentity(config(), start.state, {
      id: user,
      name: "Member",
    });
    await expect(
      completeLink(config(), other, receipt, nonce),
    ).rejects.toThrow();
    await expect(
      completeLink(config(), member, receipt, "wrong-browser"),
    ).rejects.toThrow();
    await completeLink(config(), member, receipt, nonce);
    await expect(
      completeLink(config(), member, receipt, nonce),
    ).rejects.toThrow();
    expect((await communityView(config(), member)).link?.name).toBe("Member");
  });
  it("keeps both subjects reserved until unlink role cleanup is read back", async () => {
    const a = await makeMember(1),
      b = await makeMember(2);
    await linked(a);
    await expect(linked(b)).rejects.toThrow();
    await unlink(config(), a);
    expect((await communityView(config(), a)).link?.state).toBe("cleanup");
    await expect(linked(b)).rejects.toThrow();
    const p = await projection(config(), user);
    await finishProjection(config(), user, p.revision, "synced");
    await linked(b);
    expect((await communityView(config(), b)).link?.state).toBe("pending");
  });
  it("does not accept stale role receipts after revocation", async () => {
    const a = await makeMember(1);
    await linked(a);
    const old = await projection(config(), user);
    await unlink(config(), a);
    expect(await finishProjection(config(), user, old.revision, "synced")).toBe(
      false,
    );
    expect((await communityView(config(), a)).link?.state).toBe("cleanup");
  });
  it("deduplicates XP, enforces event-time cooldown and channel allowlist, and does not move XP on link", async () => {
    const now = Date.now();
    const event = {
      id: "523456789012345678",
      user,
      channel: "323456789012345678",
      time: now,
    };
    for (let i = 0; i < 10; i++) await ingestXP(config(), event, now);
    await ingestXP(
      config(),
      { ...event, id: "523456789012345679", time: now + 1000 },
      now + 1000,
    );
    await expect(
      ingestXP(
        config(),
        { ...event, id: "523456789012345680", channel: "623456789012345678" },
        now,
      ),
    ).rejects.toThrow();
    const a = await makeMember(1);
    await linked(a);
    expect((await communityView(config(), a)).xp).toBe(1);
    await setPreferences(config(), a, { xpEnabled: false });
    await ingestXP(
      config(),
      { ...event, id: "523456789012345681", time: now + 61000 },
      now + 61000,
    );
    expect((await communityView(config(), a)).xp).toBe(1);
  });
  it("rejects replayed or modified bridge requests", async () => {
    const e = config(),
      body = "{}",
      time = String(Date.now()),
      n = crypto.randomUUID();
    const signature = await sign(
      e.COMMUNITY_BRIDGE_KEY!,
      "POST",
      "/internal/community/events",
      time,
      n,
      body,
    );
    const request = () =>
      new Request("https://hearthroom.club/internal/community/events", {
        method: "POST",
        body,
        headers: {
          "X-Community-Time": time,
          "X-Community-Nonce": n,
          "X-Community-Signature": signature,
        },
      });
    await verifyBridge(e, request());
    await expect(verifyBridge(e, request())).rejects.toThrow();
    const altered = new Request(
      "https://hearthroom.club/internal/community/projection",
      { method: "POST", body, headers: request().headers },
    );
    await expect(verifyBridge(e, altered)).rejects.toThrow();
  });
});
it("caps XP by UTC event day even when a delayed batch arrives together", async () => {
  const now = Date.UTC(2026, 8, 20, 12),
    start = Date.UTC(2026, 8, 20, 8);
  for (let i = 0; i < 61; i++)
    await ingestXP(
      config(),
      {
        id: String(623456789012345000n + BigInt(i)),
        user,
        channel: "323456789012345678",
        time: start + i * 60000,
      },
      now,
    );
  expect((await projection(config(), user)).xp).toBe(60);
  await expect(
    ingestXP(
      config(),
      {
        id: "723456789012345678",
        user,
        channel: "323456789012345678",
        time: now - 86400001,
      },
      now,
    ),
  ).rejects.toThrow();
});
