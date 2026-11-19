import { describe, expect, it, vi } from "vitest";
import { createBoardStream } from "../src/lib/board-stream";
import type { CardPage, CommunityCard } from "../src/lib/types";

const card = (id: string) => ({ id, name: id }) as CommunityCard;
const page = (ids: string[], offset = 0, hasNext = false, nextCursor?: string): CardPage => ({
  items: ids.map(card), total: null, offset, limit: 2, hasNext, nextCursor, sort: "day", adult: false,
});

describe("continuous board stream", () => {
  it("finishes every day page before hot; preserves filters and deduplicates both segments", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["a", "b"], 0, true, "day2"))
      .mockResolvedValueOnce(page(["b", "c"], 2))
      .mockResolvedValueOnce(page(["a", "b"], 0, true, "hot2"))
      .mockResolvedValueOnce(page(["c", "d"], 2));
    const stream = createBoardStream(read);
    stream.reset({ sort: "day", zone: "en", lang: "en", tag: ["story"], rating: "PG12" });
    await stream.next();
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["a", "b"]);
    expect(stream.state.dayEnded).toBe(false);
    await stream.next();
    expect(read.mock.calls.map(([q]) => q.sort)).toEqual(["day", "day", "hot", "hot"]);
    expect(read.mock.calls[1][0]).toMatchObject({ cursor: "day2", offset: 2, rating: "PG12", tag: ["story"] });
    expect(read.mock.calls[2][0]).toMatchObject({ sort: "hot", offset: 0, zone: "en", lang: "en", rating: "PG12", tag: ["story"] });
    expect(read.mock.calls[2][0].cursor).toBeUndefined();
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["a", "b", "c"]);
    expect(stream.state.hot?.items.map(c => c.id)).toEqual(["d"]);
    expect(stream.state.done).toBe(true);
  });

  it("loads every default ranking segment in order with independent cursors and cross-segment deduplication", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["a", "b"], 0, true, "day2"))
      .mockResolvedValueOnce(page(["c"], 2))
      .mockResolvedValueOnce(page(["a", "d"], 0, true, "week2"))
      .mockResolvedValueOnce(page(["d", "e"], 2))
      .mockResolvedValueOnce(page(["b", "f"]))
      .mockResolvedValueOnce(page(["g"]));
    const stream = createBoardStream(read);
    stream.reset({ sort: "day", zone: "en", tag: ["story"], rating: "PG12" }, true);
    for (let i = 0; i < 5 && !stream.state.done; i++) await stream.next();
    expect(read.mock.calls.map(([q]) => q.sort)).toEqual(["day", "day", "week", "week", "month", "hot"]);
    expect(read.mock.calls[2][0]).toMatchObject({ offset: 0, cursor: undefined, zone: "en", tag: ["story"], rating: "PG12" });
    expect(read.mock.calls[3][0]).toMatchObject({ offset: 2, cursor: "week2" });
    expect(read.mock.calls[4][0]).toMatchObject({ offset: 0, cursor: undefined });
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["a", "b", "c"]);
    expect(stream.state.week?.items.map(c => c.id)).toEqual(["d", "e"]);
    expect(stream.state.month?.items.map(c => c.id)).toEqual(["f"]);
    expect(stream.state.hot?.items.map(c => c.id)).toEqual(["g"]);
    expect(stream.state.done).toBe(true);
  });

  it("restores a default week cursor and continues monthly then hot without replaying completed segments", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["a"]))
      .mockResolvedValueOnce(page(["b"], 0, true, "week2"))
      .mockResolvedValueOnce(page(["c"], 2))
      .mockResolvedValueOnce(page(["d"]))
      .mockResolvedValueOnce(page(["e"]));
    const stream = createBoardStream(read); stream.reset({ sort: "day" }, true); await stream.next();
    const saved = stream.snapshot();
    expect(saved.phase).toBe("week");
    stream.reset({ sort: "hot" }); stream.restore({ sort: "day" }, saved, true);
    await stream.next();
    expect(read.mock.calls.map(([q]) => q.sort)).toEqual(["day", "week", "week", "month", "hot"]);
    expect(read.mock.calls[2][0]).toMatchObject({ offset: 2, cursor: "week2" });
    expect(stream.state.week?.items.map(c => c.id)).toEqual(["b", "c"]);
    expect(stream.state.hot?.items.map(c => c.id)).toEqual(["e"]);
  });

  it("finishes empty and duplicate-only ranking segments without mistaking a duplicate page for the segment end", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["a"]))
      .mockResolvedValueOnce(page(["a"], 0, true, "next"))
      .mockResolvedValueOnce(page(["a"], 2))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page(["b"]));
    const stream = createBoardStream(read); stream.reset({ sort: "day" }, true); await stream.next();
    expect(read.mock.calls.map(([q]) => q.sort)).toEqual(["day", "week", "week", "month", "hot"]);
    expect(stream.state.week?.items).toEqual([]);
    expect(stream.state.month?.items).toEqual([]);
    expect(stream.state.hot?.items.map(c => c.id)).toEqual(["b"]);
    expect(stream.state.done).toBe(true);
  });

  it("keeps week and explicit hot pure, including an empty result", async () => {
    for (const sort of ["week", "hot", "new"] as const) {
      const read = vi.fn().mockResolvedValue(page([]));
      const stream = createBoardStream(read);
      stream.reset({ sort }); await stream.next();
      expect(read).toHaveBeenCalledTimes(1);
      expect(stream.state.dayEnded).toBe(false);
      expect(stream.state.done).toBe(true);
    }
  });

  it("retains cards on append failure and retries the same cursor once, without parallel reads", async () => {
    let resolve!: (p: CardPage) => void;
    const read = vi.fn().mockResolvedValueOnce(page(["a"], 0, true, "next"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise<CardPage>(r => { resolve = r; }));
    const stream = createBoardStream(read); stream.reset({ sort: "hot" });
    await stream.next(); await stream.next();
    expect(stream.state.error).toBe("offline");
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["a"]);
    const pending = stream.next(); await stream.next();
    expect(read).toHaveBeenCalledTimes(3);
    expect(read.mock.calls[2][0]).toEqual(read.mock.calls[1][0]);
    resolve(page(["b"], 2)); await pending;
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("reports a nonadvancing cursor as a retryable error instead of calling forever", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["a"], 0, true, "same"))
      .mockResolvedValueOnce(page(["a"], 2, true, "same"));
    const stream = createBoardStream(read); stream.reset({ sort: "hot" });
    await stream.next(); await stream.next();
    expect(read).toHaveBeenCalledTimes(2);
    expect(stream.state.error).toBeTruthy();
    expect(stream.state.done).toBe(false);
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["a"]);
  });

  it("ignores a previous viewer response after reset", async () => {
    let resolve!: (p: CardPage) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<CardPage>(r => { resolve = r; }))
      .mockResolvedValueOnce(page(["safe"]));
    const stream = createBoardStream(read); stream.reset({ sort: "hot" });
    const stale = stream.next(); stream.reset({ sort: "new" }); await stream.next();
    resolve(page(["private"])); await stale;
    expect(stream.state.first?.items.map(c => c.id)).toEqual(["safe"]);
    expect(stream.state.loading).toBe(false);
  });

  it("restores loaded segments and cursors without reordering or refetching them", async () => {
    const read = vi.fn().mockResolvedValueOnce(page(["a"]))
      .mockResolvedValueOnce(page(["a", "b"], 0, true, "next"))
      .mockResolvedValueOnce(page(["b", "c"], 2));
    const stream = createBoardStream(read); stream.reset({ sort: "day" }); await stream.next();
    const saved = stream.snapshot(); stream.reset({ sort: "week" });
    stream.restore({ sort: "day" }, saved);
    expect(read).toHaveBeenCalledTimes(2);
    await stream.next();
    expect(read.mock.calls[2][0]).toMatchObject({ sort: "hot", cursor: "next", offset: 2 });
    expect(stream.state.hot?.items.map(c => c.id)).toEqual(["b", "c"]);
  });

  it("pauses duplicate-only continuation while the document is inactive", async () => {
    let active = true;
    const read = vi.fn().mockResolvedValueOnce(page(["a"]))
      .mockImplementationOnce(async () => { active = false; return page(["a"], 0, true, "hot2"); })
      .mockResolvedValueOnce(page(["b"], 2));
    const stream = createBoardStream(read, () => active); stream.reset({ sort: "day" });
    await stream.next(); expect(read).toHaveBeenCalledTimes(2);
    active = true; await stream.next();
    expect(stream.state.hot?.items.map(c => c.id)).toEqual(["b"]);
  });
});
