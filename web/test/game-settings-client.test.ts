import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoleSettings, saveRoleSettings, type RoleSettings } from "../src/game/settings-client";

afterEach(() => vi.unstubAllGlobals());
describe("game settings instruction wire name", () => {
  it("reads canonical instructions and writes an empty override without changing local drafts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ customInstructions: "Original instruction" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { settings: before } = await fetchRoleSettings("https://provider.test", "test-token", "en", "fixture-role");
    expect(before.jailbreak).toBe("Original instruction");
    const after: RoleSettings = { ...before, jailbreak: "" };
    await saveRoleSettings("https://provider.test", "test-token", "en", "fixture-role", before, after);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ roleId: "fixture-role", customInstructions: "" });
    expect(before.jailbreak).toBe("Original instruction");
  });
});
