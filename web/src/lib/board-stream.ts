import { reactive } from "vue";
import { ApiError, type BoardQuery } from "./api";
import type { CardPage, CommunityCard } from "./types";

export interface BoardStreamSnapshot {
  first: CardPage | null;
  hot: CardPage | null;
  week: CardPage | null;
  month: CardPage | null;
  last: CardPage | null;
  phase: "first" | "week" | "month" | "hot";
  dayEnded: boolean;
  done: boolean;
  error: string;
  cursors: string[];
  cursorReceivedAt: number | null;
}

const CURSOR_REFRESH_AGE_MS = 55 * 60_000;
const empty = (): BoardStreamSnapshot => ({ first: null, hot: null, week: null, month: null, last: null, phase: "first", dayEnded: false, done: false, error: "", cursors: [], cursorReceivedAt: null });
/** One request at a time. The last server page owns pagination; deduped cards never set the offset. */
export function createBoardStream(read: (query: BoardQuery & { rating?: string }) => Promise<CardPage>, active = () => true) {
  const state = reactive({ ...empty(), loading: false, refreshing: false });
  let query: BoardQuery & { rating?: string } = {};
  let generation = 0;
  let defaultFeed = false;
  function reset(next: typeof query, cascade = false) {
    defaultFeed = cascade && next.sort === "day";
    generation++;
    query = { ...next };
    Object.assign(state, empty(), { loading: false, refreshing: false });
  }
  function restore(next: typeof query, saved: BoardStreamSnapshot, cascade = false) {
    reset(next, cascade);
    Object.assign(state, structuredClone(saved));
  }
  function snapshot(): BoardStreamSnapshot {
    // Vue proxies cannot be structuredClone'd. Card objects contain only JSON data.
    return JSON.parse(JSON.stringify({ ...state, loading: undefined, refreshing: undefined }));
  }
  function invalidate() {
    generation++;
    state.loading = state.refreshing = false;
  }
  function restartPhase() {
    state.last = null;
    state.cursors = [];
    state.cursorReceivedAt = null;
    if (state.phase === "first") query.cursor = undefined;
  }
  function cursorIsStale() {
    return !!state.last?.nextCursor && state.cursorReceivedAt !== null &&
      Date.now() - state.cursorReceivedAt >= CURSOR_REFRESH_AGE_MS;
  }
  function accept(result: CardPage) {
    const target = state.phase;
    const seen = new Set([state.first, state.week, state.month, state.hot].flatMap(part => part?.items ?? []).map(c => c.id));
    const fresh: CommunityCard[] = [];
    for (const card of result.items) if (!seen.has(card.id)) { seen.add(card.id); fresh.push(card); }
    state[target] = { ...result, offset: state[target]?.offset ?? result.offset, items: [...(state[target]?.items ?? []), ...fresh] };
    state.last = result;
    state.cursorReceivedAt = result.hasNext && result.nextCursor ? Date.now() : null;
    if (result.hasNext) {
      if (result.nextCursor) state.cursors.push(result.nextCursor);
    } else if ((state.phase === "first" && query.sort === "day") || (defaultFeed && (state.phase === "week" || state.phase === "month"))) {
      if (state.phase === "first") state.dayEnded = true;
      state.phase = defaultFeed ? state.phase === "first" ? "week" : state.phase === "week" ? "month" : "hot" : "hot";
      state.last = null;
      state.cursors = [];
    } else state.done = true;
    return fresh.length;
  }
  /** HTML first paint uses exactly the same transition rules as an HTTP page. */
  function seed(result: CardPage) { accept(result); }
  function refreshIfStale() {
    const last = state.last;
    if (last && cursorIsStale()) return load(last.offset);
  }
  async function load(refreshThrough?: number) {
    if (state.loading || state.done || !active()) return;
    const id = generation;
    const refreshing = refreshThrough !== undefined;
    state.loading = true;
    state.refreshing = refreshing;
    let restarted = refreshing || (!!state.error && cursorIsStale());
    if (restarted) restartPhase();
    if (!refreshing) state.error = "";
    try {
      let reads = 0;
      do {
        const last = state.last;
        const offset = last ? last.offset + last.limit : state.phase !== "first" ? 0 : query.offset ?? 0;
        const cursor = last ? last.nextCursor : state.phase !== "first" ? undefined : query.cursor;
        let result: CardPage;
        try {
          result = await read({ ...query, sort: state.phase === "first" ? query.sort : state.phase, offset, cursor });
        } catch (err) {
          if (id !== generation) return;
          if (!cursor || !(err instanceof ApiError) || err.status !== 400 || err.code !== "invalid_cursor") throw err;
          // Replay from the start of this phase: visible rank can differ from the raw offset.
          restartPhase();
          if (restarted) throw err;
          restarted = true;
          continue;
        }
        if (id !== generation) return;
        // A repeated cursor or offset would otherwise request duplicate-only pages forever.
        if ((last && result.offset < offset) || (result.hasNext && (!Number.isFinite(result.limit) || result.limit <= 0 || (result.nextCursor && state.cursors.includes(result.nextCursor))))) {
          throw new Error("pagination_stalled");
        }
        const previousPhase = state.phase;
        const added = accept(result);
        state.error = "";
        if (state.done || (refreshing
          ? previousPhase !== state.phase || result.offset >= refreshThrough
          : added && previousPhase === state.phase)) break;
        // Duplicate-only pages may span many cursors. Yield regularly and recheck visibility.
        if (++reads % 3 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      } while (id === generation && active());
    } catch (err) {
      if (id === generation && !refreshing) state.error = err instanceof Error ? err.message : "load_failed";
    } finally {
      if (id === generation) state.loading = state.refreshing = false;
    }
  }
  return { state, reset, restore, snapshot, seed, next: () => load(), refreshIfStale, invalidate };
}
