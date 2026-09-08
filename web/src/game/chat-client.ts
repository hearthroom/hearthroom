/**
 * 遊戲頁自己的對話回路：直接走開放 API v1，不經舞台套件。
 *
 * 舞台（stage/）是一整個對話畫布，帶著它自己的訊息列表、正則版面與工具列；遊戲頁只要
 * 「送一句、收一段串流、拿到完整回覆」三件事，所以照它的線路自己接一份最小的：
 *   1. POST /conversation/start        → conversationId 與開場白
 *   2. POST /conversation/ws-ticket    → 一次性票證（串流連線不能帶 Authorization 標頭）
 *   3. WS   /conversation/ws?protocolVersion=2
 *        第一幀 {type:'auth', ticket}，伺服器回 `event: ready` 後才送聊天幀；
 *        之後是 SSE 格式的文字幀：answer（choices[0].delta.content）、[DONE]、done、error。
 *
 * ponytail: 沒接續跑／重連／存檔切換；斷線就報錯讓玩家再送一次。要做再照舞台的 chat-transport 補。
 */

export interface ChatSession { conversationId: string; welcome: string; hasHistory: boolean }

export interface TurnHandlers {
  onDelta: (fullText: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
};

const headers = (token: string, lang: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${token}`,
  language: lang,
});

export async function startConversation(base: string, token: string, roleId: string, lang: string): Promise<ChatSession> {
  const body = await json<{ conversationId: string; defaultRelay?: string; historyConversation?: boolean }>(
    await fetch(`${base}/open/v1/conversation/start`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ roleId }) }),
  );
  return { conversationId: body.conversationId, welcome: body.defaultRelay || "", hasHistory: !!body.historyConversation };
}

/**
 * 這段對話最近的 AI 回覆（舊到新）。伺服器第一頁是最新的、由新到舊，所以反過來。
 * 重新整理後把它們照順序合併，舞台狀態就能接回上次的存檔。
 */
export interface HistoryRow { chatId: string; role: "AI" | "USER"; text: string }

/** 這段對話最近的訊息（舊到新，含雙方）。伺服器第一頁是最新的、由新到舊，所以反過來。 */
export async function fetchRecentMessages(base: string, token: string, conversationId: string, lang: string, pageSize = 30): Promise<HistoryRow[]> {
  const q = new URLSearchParams({ conversationId, pageNum: "1", pageSize: String(pageSize) });
  const body = await json<{ chats?: { chatId?: string | number; chatRole?: string; chatMessage?: string }[] }>(
    await fetch(`${base}/open/v1/conversation/messages?${q}`, { headers: headers(token, lang) }),
  );
  return (body.chats || [])
    .filter((m) => m.chatMessage && (m.chatRole === "AI" || m.chatRole === "USER"))
    .map((m) => ({ chatId: String(m.chatId ?? ""), role: m.chatRole as "AI" | "USER", text: String(m.chatMessage) }))
    .reverse();
}

export async function fetchRecentAiMessages(base: string, token: string, conversationId: string, lang: string, pageSize = 30): Promise<string[]> {
  return (await fetchRecentMessages(base, token, conversationId, lang, pageSize)).filter((m) => m.role === "AI").map((m) => m.text);
}

/** 幫答：伺服器替玩家擬一句，填進輸入框由玩家決定送不送。點數不足時回空字串並帶 code。 */
export async function suggestReply(base: string, token: string, conversationId: string, lang: string): Promise<{ reply: string; code?: string }> {
  const res = await fetch(`${base}/open/v1/conversation/suggest-reply`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ conversationId, regenerate: false }) });
  const body = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
  return { reply: String(body.reply || ""), code: body.error ? String(body.error) : undefined };
}

/** 存下這一段、另起一段新的（同一張卡）。回新對話與開場白。 */
export async function startNewConversation(base: string, token: string, conversationId: string, lang: string): Promise<ChatSession> {
  const body = await json<{ conversationId: string; defaultRelay?: string }>(
    await fetch(`${base}/open/v1/conversation/save-and-start-new`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ conversationId, save: true }) }),
  );
  return { conversationId: body.conversationId, welcome: body.defaultRelay || "", hasHistory: false };
}

async function fetchTicket(base: string, token: string, lang: string): Promise<string> {
  const body = await json<{ ticket?: string }>(
    await fetch(`${base}/open/v1/conversation/ws-ticket`, { method: "POST", headers: headers(token, lang), body: "{}" }),
  );
  if (!body.ticket) throw new Error("no ticket");
  return body.ticket;
}

/** http(s)://host → ws(s)://host；base 為空（開發時走同源代理）就用目前網址。 */
export function wsBaseOf(base: string): string {
  const origin = base || location.origin;
  return origin.replace(/^http/, "ws");
}

interface SseEvent { event: string; data: unknown; raw: string }

/**
 * 一幀裡可能有多個事件，一個事件也可能跨幀（JSON 切在半路）。照舞台的解析器來：
 * 逐行讀，每一個完整的 data: 行就是一個事件，行尾還沒到的殘句留到下一幀；空行把事件名重設。
 */
function makeSseParser() {
  let buffer = "";
  let event = "message";
  return (chunk: string): SseEvent[] => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = buffer.endsWith("\n") ? "" : lines.pop() || "";
    const events: SseEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) { event = "message"; continue; }
      if (line.startsWith("event:")) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      let data: unknown = raw;
      if (raw && raw !== "[DONE]") { try { data = JSON.parse(raw); } catch { /* 純文字 */ } }
      events.push({ event, data, raw });
    }
    return events;
  };
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export interface TurnInput {
  base: string; token: string; conversationId: string; message: string; lang: string;
  /** 重寫：指向要重跑的那一句「玩家訊息」的 chatId（伺服器契約），message 帶原句 */
  rewriteChatId?: string;
}

/** 送一輪。回傳的函式可以中止（關 socket）。 */
export function sendTurn(input: TurnInput, h: TurnHandlers): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let text = "";
  let heartbeat = 0;

  const finish = (err?: string) => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { ws?.close(); } catch { /* ignore */ }
    if (err) h.onError(err);
    else h.onDone(text);
  };

  (async () => {
    let ticket: string;
    try { ticket = await fetchTicket(input.base, input.token, input.lang); } catch (e) { finish(String((e as Error).message || e)); return; }
    if (closed) return;
    const parse = makeSseParser();
    ws = new WebSocket(`${wsBaseOf(input.base)}/open/v1/conversation/ws?protocolVersion=2`);
    ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", ticket }));
    ws.onerror = () => finish("socket");
    ws.onclose = () => finish(text ? undefined : "closed");
    ws.onmessage = (ev) => {
      const frame = typeof ev.data === "string" ? ev.data : "";
      if (!frame) return;
      // 伺服器在點數不足時回的是一句純文字（「积分不足」），不是 SSE 事件
      if (frame === "\u79ef\u5206\u4e0d\u8db3") { finish("insufficient_credits"); return; }
      // 非串流的 JSON 信封（例如 cg_update）：遊戲頁用不到
      if (frame.charCodeAt(0) === 123) { try { const env = JSON.parse(frame); if (env && typeof env.type === "string") return; } catch { /* SSE */ } }
      for (const e of parse(frame)) {
        if (e.event === "ready") {
          heartbeat = window.setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() })), 10000);
          ws?.send(JSON.stringify({
            conversationId: input.conversationId, storyId: "", message: input.message, model: "", thinkingDepth: "",
            rewrite: !!input.rewriteChatId, contine: false, presetCmd: "", language: input.lang, chatId: input.rewriteChatId || "",
            clientTurnId: uuid(), ackToken: "", supportsPassBlock: true,
          }));
        } else if (e.event === "answer") {
          if (e.raw === "[DONE]") continue;
          const d = e.data as { choices?: { delta?: { content?: string } }[] } | null;
          const delta = d?.choices?.[0]?.delta?.content;
          if (delta) { text += delta; h.onDelta(text); }
        } else if (e.event === "done") {
          finish();
        } else if (e.event === "error") {
          const d = e.data as { code?: string; message?: string } | string;
          finish(typeof d === "string" ? d : d?.message || d?.code || "error");
        }
      }
    };
  })();

  return () => finish(text ? undefined : "aborted");
}
