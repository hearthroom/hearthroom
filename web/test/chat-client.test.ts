import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTurn, wsBaseOf } from "@/game/chat-client";

/** 假的 WebSocket：記下送出的幀，測試手動餵伺服器幀。 */
class FakeSocket {
  static last: FakeSocket | null = null;
  url: string;
  sent: string[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeSocket.last = this; }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  feed(frame: string) { this.onmessage?.({ data: frame }); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("sendTurn", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("swaps the ticket for a socket, waits for ready, streams answer deltas, ends on done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ticket: "T1" }), { status: 200 })));
    vi.stubGlobal("WebSocket", FakeSocket);
    const deltas: string[] = [];
    let done = "";
    let err = "";
    sendTurn({ base: "https://api.example", token: "tok", conversationId: "c1", message: "问诺亚", lang: "zh-Hans" }, {
      onDelta: (t) => deltas.push(t), onDone: (t) => { done = t; }, onError: (e) => { err = e; },
    });
    await flush();
    const ws = FakeSocket.last!;
    expect(ws.url).toBe("wss://api.example/open/v1/conversation/ws?protocolVersion=2");
    ws.onopen?.();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "auth", ticket: "T1" });
    // ready 之前不送聊天幀
    expect(ws.sent).toHaveLength(1);
    ws.feed("event: ready\ndata: {}\n\n");
    const payload = JSON.parse(ws.sent[1]);
    expect(payload).toMatchObject({ conversationId: "c1", message: "问诺亚", language: "zh-Hans", rewrite: false, contine: false, supportsPassBlock: true });
    expect(payload.clientTurnId).toBeTruthy();
    // 一幀多事件、跨幀殘句都要接得起來
    ws.feed('event: accepted\ndata: {"ok":true}\n\nevent: answer\ndata: {"choices":[{"delta":{"content":"生盐"}}]}\n\nevent: answer\ndata: {"choices":[{"delta":{"co');
    ws.feed('ntent":"诺亚翻开记录本。"}}]}\n\n');
    ws.feed("event: answer\ndata: [DONE]\n\nevent: done\ndata: {}\n\n");
    expect(deltas).toEqual(["生盐", "生盐诺亚翻开记录本。"]);
    expect(done).toBe("生盐诺亚翻开记录本。");
    expect(err).toBe("");
    expect(ws.readyState).toBe(3);
  });

  it("reports the credits frame and server errors instead of hanging", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ticket: "T2" }), { status: 200 })));
    vi.stubGlobal("WebSocket", FakeSocket);
    const errors: string[] = [];
    sendTurn({ base: "https://api.example", token: "tok", conversationId: "c1", message: "x", lang: "en" }, {
      onDelta: () => {}, onDone: () => {}, onError: (e) => errors.push(e),
    });
    await flush();
    FakeSocket.last!.feed("积分不足");
    expect(errors).toEqual(["insufficient_credits"]);

    sendTurn({ base: "https://api.example", token: "tok", conversationId: "c1", message: "x", lang: "en" }, {
      onDelta: () => {}, onDone: () => {}, onError: (e) => errors.push(e),
    });
    await flush();
    FakeSocket.last!.feed('event: error\ndata: {"code":"unauthorized","retryable":false}\n\n');
    expect(errors).toEqual(["insufficient_credits", "unauthorized"]);
  });

  it("surfaces a failed ticket exchange", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const errors: string[] = [];
    sendTurn({ base: "https://api.example", token: "bad", conversationId: "c1", message: "x", lang: "en" }, {
      onDelta: () => {}, onDone: () => {}, onError: (e) => errors.push(e),
    });
    await flush();
    expect(errors[0]).toMatch(/^401/);
  });
});

describe("wsBaseOf", () => {
  it("maps http(s) to ws(s) and falls back to the page origin for a relative base", () => {
    expect(wsBaseOf("https://api.lunatalk.ai")).toBe("wss://api.lunatalk.ai");
    expect(wsBaseOf("http://127.0.0.1:8899")).toBe("ws://127.0.0.1:8899");
    expect(wsBaseOf("")).toBe(location.origin.replace(/^http/, "ws"));
  });
});
