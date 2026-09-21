/**
 * 沙箱殼的位址：正式站給每張卡一個子網域，標籤一律小寫（瀏覽器與 postMessage 的 origin 都是小寫）；
 * 不合 DNS 標籤的 roleId 與非正式站退回同站 opaque 殼。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCardSaves, putCardSave } from '../src/lib/api';

vi.mock("../src/lib/api", () => ({ fetchCardSaves: vi.fn(), putCardSave: vi.fn(), deleteCardSave: vi.fn() }));

const session = { accessToken: async () => "t" } as unknown as Parameters<typeof import("../src/lib/stage-host").sandboxOptions>[1];

describe("sandboxOptions", () => {
  beforeEach(() => vi.resetAllMocks());
  it('prefetches saved state before handshake and consumes it only once', async () => {
    const { sandboxOptions } = await import('../src/lib/stage-host');
    let finish!: (value: Record<string, unknown>) => void;
    vi.mocked(fetchCardSaves).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const o = sandboxOptions('localhost', session, 'harbor');
    const prefetch = o.prefetch('role');
    await vi.waitFor(() => expect(fetchCardSaves).toHaveBeenCalledWith('role', 't', 'harbor'));
    const load = o.saves.load('role');
    finish({ checkpoint: 7 });
    await prefetch;
    await expect(load).resolves.toEqual({ checkpoint: 7 });
    expect(fetchCardSaves).toHaveBeenCalledTimes(1);
    vi.mocked(fetchCardSaves).mockResolvedValueOnce({ checkpoint: 8 });
    await expect(o.saves.load('role')).resolves.toEqual({ checkpoint: 8 });
  });

  it('does not reuse another token, role, or state from before a write', async () => {
    const { sandboxOptions } = await import('../src/lib/stage-host');
    let token = 'first';
    const o = sandboxOptions('localhost', { accessToken: async () => token }, 'harbor');
    vi.mocked(fetchCardSaves).mockResolvedValue({ old: true });
    await o.prefetch('role');
    token = 'second';
    vi.mocked(fetchCardSaves).mockResolvedValue({ current: true });
    await expect(o.saves.load('role')).resolves.toEqual({ current: true });
    expect(fetchCardSaves).toHaveBeenLastCalledWith('role', 'second', 'harbor');
    await o.prefetch('role');
    await o.saves.load('other-role');
    expect(fetchCardSaves).toHaveBeenLastCalledWith('other-role', 'second', 'harbor');
    await o.prefetch('role');
    await o.saves.set('role', 'checkpoint', 9);
    expect(putCardSave).toHaveBeenCalled();
    const before = vi.mocked(fetchCardSaves).mock.calls.length;
    await o.saves.load('role');
    expect(fetchCardSaves).toHaveBeenCalledTimes(before + 1);
  });

  it('retries a failed prefetch at handshake instead of inventing empty saves', async () => {
    const { sandboxOptions } = await import('../src/lib/stage-host');
    const o = sandboxOptions('localhost', session);
    vi.mocked(fetchCardSaves).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ checkpoint: 7 });
    await o.prefetch('role');
    await expect(o.saves.load('role')).resolves.toEqual({ checkpoint: 7 });
    expect(fetchCardSaves).toHaveBeenCalledTimes(2);
  });
  it("正式站：子網域殼，標籤小寫", async () => {
    const { sandboxOptions } = await import("../src/lib/stage-host");
    const o = sandboxOptions("hearthroom.club", session);
    expect(o.shellUrl("a7A2-b00b")).toBe("https://ca7a2-b00b.hearthroom.club/sandbox/");
    expect(o.origin("a7A2-b00b")).toBe("https://ca7a2-b00b.hearthroom.club");
    expect(sandboxOptions("www.hearthroom.club", session).origin("1")).toBe("https://c1.hearthroom.club");
  });

  it("不合 DNS 標籤的 roleId、或不在正式站 → 同站 opaque 殼", async () => {
    const { sandboxOptions } = await import("../src/lib/stage-host");
    const prod = sandboxOptions("hearthroom.club", session);
    for (const bad of ["a_b", "a.b", "", "x".repeat(63)]) {
      expect(prod.shellUrl(bad), bad).toBe("/sandbox/");
      expect(prod.origin(bad), bad).toBe("null");
    }
    const local = sandboxOptions("localhost", session);
    expect(local.shellUrl("abc")).toBe("/sandbox/");
    expect(local.origin("abc")).toBe("null");
  });
});

for (const root of ['sukisuki.ai', 'sukisuki.chat']) {
  it(`uses isolated per-card shells on ${root} and its card app`, async () => {
    const { sandboxOptions } = await import('../src/lib/stage-host');
    for (const host of [root, `www.${root}`, `play.${root}`]) {
      const options = sandboxOptions(host, session);
      expect(options.shellUrl('Role-1')).toBe(`https://crole-1.${root}/sandbox/`);
      expect(options.origin('Role-1')).toBe(`https://crole-1.${root}`);
    }
    expect(sandboxOptions(`${root}.evil.test`, session).origin('1')).toBe('null');
  });
}
