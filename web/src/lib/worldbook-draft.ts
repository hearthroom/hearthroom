/**
 * 一本世界書在編輯器裡的完整生命週期：從「還沒有」到建立、挑既有的、匯入、改條目、改書名、
 * 存檔（分段送、失敗可重試不重建）、讀回。原本住在建卡頁裡，只服務那張卡綁的那一本；
 * 世界卡的每個角色也各有一本私有世界書，走的是一模一樣的流程，所以搬出來共用——
 * 一本書一個實例，頁面只負責把實例接到 WorldbookEditor 上。
 *
 * 綁定是可選的：卡綁的那本存檔時順手綁到卡上（binding），角色的私有書不綁卡，
 * 只把 worldbookId 記進成員設定。
 */
import { reactive } from "vue";
import {
  createWorldbook,
  fetchMyWorldbooks,
  fetchRoleWorldbooks,
  fetchWorldbookEntries,
  patchWorldbookDocument,
  reorderWorldbookEntries,
  type WorldbookDocumentEntry,
  type WorldbookMetadataPatch,
  type WorldbookSummary,
} from "./api";
import type { WorldbookEntryDraft } from "./role-draft";

export interface WorldbookDraftDeps {
  /** 未命名條目的預設名。 */
  untitled: () => string;
  /** 建新書時的預設書名（通常是角色名）。 */
  fallbackName: () => string;
  /** 建新書的語區。 */
  language: () => string;
  /** 分段送出時的進度（null＝結束）。 */
  onProgress?: (progress: { done: number; total: number } | null) => void;
}

/** 一個要送出去的操作，連同它對應的本地條目（delete 沒有），送成功後拿來對齊本地狀態。 */
interface WorldbookOp { op: WorldbookDocumentEntry; entry?: WorldbookEntryDraft }

/**
 * 一次送多少個操作。幾百條的匯入切成幾段送：每段幾秒內完成，不會撞到反向代理的逾時；
 * 每段成功就把本地狀態對齊伺服器，中途斷線再按一次儲存只會送剩下的，不會重建已經建好的條目。
 */
const OPS_PER_REQUEST = 100;

export interface StoredWorldbookDraft { name: string; format?: "tavern"; entries: WorldbookEntryDraft[] }

export function useWorldbookDraft(deps: WorldbookDraftDeps) {
  const book = reactive({
    id: "",
    name: "",
    desc: "",
    /**
     * 這本書在上游現在長什麼樣。改書名或描述時，其餘欄位要照這份原樣送回去——
     * 上游的更新是整份覆蓋。拿不到就不送 metadata：寧可改名沒生效，也不要把別處
     * （站內 App、寫卡助手）填好的圖示、標籤、可見性清成空的。
     */
    meta: null as WorldbookSummary | null,
    /** 匯入酒館／MMD 世界書時是 "tavern"：上游會讓這本書先走酒館自己的關鍵字規則。 */
    format: undefined as "tavern" | undefined,
    entries: [] as WorldbookEntryDraft[],
    original: [] as WorldbookEntryDraft[],
    /** 剛匯入、還沒送出去的那本。儲存時要先建再寫。 */
    pending: false,
    /** 挑了作者已經有的一本：書已存在，缺的只有「綁到這張卡」那一步。 */
    bindPending: false,

    reset() {
      book.id = ""; book.name = ""; book.desc = ""; book.meta = null; book.format = undefined;
      book.entries = []; book.original = []; book.pending = false; book.bindPending = false;
    },
    /** 有沒有沒存的改動。 */
    dirty(): boolean {
      return JSON.stringify(book.entries) !== JSON.stringify(book.original) || book.pending || book.bindPending || book.metadataChanged();
    },
    hasContent(): boolean {
      return book.entries.some((e) => e.content.trim());
    },
    /** 本機草稿要記的那份（只有還沒送出去的書才記）。 */
    stored(): StoredWorldbookDraft | null {
      return book.pending ? { name: book.name, format: book.format, entries: book.entries } : null;
    },
    restore(stored: StoredWorldbookDraft | null | undefined) {
      if (!stored?.entries?.length) return;
      book.pending = true;
      book.name = stored.name;
      book.format = stored.format;
      book.entries = stored.entries;
    },

    createDraft() {
      book.pending = true;
      book.name = book.name || deps.fallbackName();
      if (!book.entries.length) {
        book.entries = [{ name: "", content: "", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "custom" }];
      }
    },
    /**
     * 挑了作者已經有的一本：先把條目讀進來再認這本書。
     * 讀不出來就整個放掉，不留一個「已綁定但看起來是空的」狀態——作者會照著那個空清單重打一遍，
     * 存下去就在原本那本書裡多出一整份重複的條目。
     */
    async pick(bookSummary: WorldbookSummary, token: string) {
      const entries = await fetchWorldbookEntries(bookSummary.worldbookId, token);
      book.id = bookSummary.worldbookId;
      book.name = bookSummary.name;
      book.entries = entries;
      book.original = JSON.parse(JSON.stringify(entries));
      book.bindPending = true;
      book.format = undefined;
      book.meta = bookSummary;
      book.desc = bookSummary.description ?? "";
    },
    /**
     * 放掉手上這本，回到空狀態重挑。original 一定要一起清空：留著的話，下一本書的差分會拿舊書的
     * 條目去算，送出去就是往新書裡刪一批根本不存在的條目。
     */
    release() {
      book.reset();
    },
    /** 從酒館世界書檔匯入的條目。還沒綁書就先把書建起來，名字用檔裡的、沒有就用預設名。 */
    imported(payload: { name: string; entries: WorldbookEntryDraft[]; format?: "tavern" }) {
      if (!book.id && !book.pending) {
        book.pending = true;
        book.name = payload.name || deps.fallbackName();
      }
      if (payload.format) book.format = payload.format;
      // 匯入的條目一律沒有 entryId：它們在上游還不存在，儲存時要走 create。
      book.entries = payload.entries.map((entry) => ({ ...entry, entryId: undefined }));
    },

    /** 這張卡綁著的世界書。只取第一本：介面一次只編一本，而上游允許綁多本。 */
    async loadBound(token: string, roleId: string) {
      const bound = await fetchRoleWorldbooks(roleId, token).catch(() => []);
      const first = bound[0];
      if (!first) return;
      await book.load(token, first.worldbookId, first.name);
    },
    /** 用 id 讀一本（角色的私有書）。讀不到條目就當空書，讀不到元資訊就鎖住書名。 */
    async load(token: string, bookId: string, name = "") {
      book.id = bookId;
      book.name = name;
      book.entries = await fetchWorldbookEntries(bookId, token).catch(() => []);
      book.original = JSON.parse(JSON.stringify(book.entries));
      try {
        const mine = await fetchMyWorldbooks(token);
        const meta = mine.find((b) => b.worldbookId === bookId) ?? null;
        book.meta = meta;
        if (meta) {
          book.name = meta.name;
          book.desc = meta.description ?? "";
        }
      } catch {
        book.meta = null;
      }
    },

    /** 條目順序跟上游存的不一樣。 */
    orderChanged(): boolean {
      const now = book.entries.map((entry) => entry.entryId).filter(Boolean).join(",");
      const before = book.original.map((entry) => entry.entryId).filter(Boolean).join(",");
      return now !== before;
    },
    /** 書名或描述跟上游現在的值不一樣。拿不到上游那份就一律當沒改——沒有基準就沒有差分。 */
    metadataChanged(): boolean {
      const meta = book.meta;
      if (!meta || !meta.visibility) return false;
      return book.name.trim() !== meta.name || book.desc !== meta.description;
    },
    /** 草稿與上次存下的樣子比對，算出要 create / update / delete 哪些條目。 */
    ops(): WorldbookOp[] {
      const ops: WorldbookOp[] = [];
      const keptIds = new Set(book.entries.map((e) => e.entryId).filter(Boolean) as string[]);
      for (const before of book.original) {
        if (before.entryId && !keptIds.has(before.entryId)) ops.push({ op: { op: "delete", entryId: before.entryId } });
      }
      for (const entry of book.entries) {
        // 空條目不送：作者按了「新增」又沒填，那不是一條要存的資料。
        if (!entry.content.trim()) continue;
        const payload = {
          name: entry.name.trim() || entry.keywords[0] || deps.untitled(),
          content: entry.content,
          keywords: entry.keywords,
          secondaryKeywords: entry.secondaryKeywords ?? [],
          ...(entry.matchOptions ? { matchOptions: entry.matchOptions } : {}),
          isEnabled: entry.isEnabled,
          isConstant: entry.isConstant,
          ...(entry.category ? { category: entry.category } : {}),
          ...(entry.triggerRegion ? { triggerRegion: entry.triggerRegion } : {}),
        };
        if (!entry.entryId) ops.push({ op: { op: "create", ...payload }, entry });
        else if (JSON.stringify(entry) !== JSON.stringify(book.original.find((e) => e.entryId === entry.entryId))) {
          ops.push({ op: { op: "update", entryId: entry.entryId, ...payload }, entry });
        }
      }
      return ops;
    },

    /**
     * 存這本書。回傳書的 id（沒有東西可存、也沒有書時回空字串）。
     * bindRoleId：存檔時順手綁到這張卡（卡綁的那本才給；角色的私有書不給）。
     */
    async save(token: string, options: { bindRoleId?: string } = {}): Promise<string> {
      const ops = book.ops();
      const needsBook = book.pending || Boolean(book.id);
      const metaDirty = book.metadataChanged();
      const orderDirty = book.orderChanged();
      if (!needsBook || (!ops.length && book.id && !book.bindPending && !metaDirty && !orderDirty)) return book.id;

      let bookId = book.id;
      let firstBind = book.bindPending && Boolean(options.bindRoleId);
      if (!bookId) {
        if (!ops.length) {
          // 按了「建一本」卻一條都沒填：不建空書。旗標與那幾條空條目要一起放掉，
          // 否則空條目跟（空的）原始清單永遠對不上，這張卡永遠算「有未儲存的修改」。
          book.pending = false;
          book.entries = [];
          book.original = [];
          return "";
        }
        const createdName = book.name.trim() || deps.fallbackName();
        bookId = await createWorldbook(
          {
            name: createdName,
            ...(book.desc.trim() ? { description: book.desc.trim() } : {}),
            language: deps.language(),
            ...(book.format ? { format: book.format } : {}),
          },
          token,
        );
        // 新建的書上游一律落成 private；寫進基準，作者剛建完就能改名，不必先重新整理
        book.meta = { worldbookId: bookId, name: createdName, description: book.desc.trim(), entryCount: 0, iconUrl: "", visibility: "private", tags: "" };
        // 書建好就記住：之後任何一段失敗，重試都寫同一本，不會每按一次就多一本孤兒書。
        book.id = bookId;
        book.pending = false;
        firstBind = Boolean(options.bindRoleId);
      }
      const binding = options.bindRoleId ? { binding: { roleId: options.bindRoleId } } : {};
      // 挑了一本現成的、或只改了書名：條目一個字沒動也還是得送一次
      if (!ops.length) {
        const metadata = metaDirty ? book.metadataPatch() : undefined;
        if (firstBind || metadata) {
          await patchWorldbookDocument(bookId, { ...(metadata ? { metadata } : {}), ...(firstBind ? binding : {}) }, token);
          book.bindPending = false;
          if (metadata) book.acceptMetadata(metadata);
        }
        await book.saveOrder(bookId, token);
        book.original = JSON.parse(JSON.stringify(book.entries));
        return bookId;
      }
      const metadata = metaDirty ? book.metadataPatch() : undefined;
      deps.onProgress?.({ done: 0, total: ops.length });
      try {
        for (let i = 0; i < ops.length; i += OPS_PER_REQUEST) {
          const chunk = ops.slice(i, i + OPS_PER_REQUEST);
          // 綁定與書名跟第一段一起送；上游的綁定是覆蓋式的，重送也不會出事
          const result = await patchWorldbookDocument(
            bookId,
            { ...(i === 0 && metadata ? { metadata } : {}), entries: chunk.map((c) => c.op), ...(firstBind ? binding : {}) },
            token,
          );
          if (i === 0 && metadata) book.acceptMetadata(metadata);
          firstBind = false;
          book.bindPending = false;
          book.reconcileChunk(chunk, result?.createdEntryIds ?? []);
          deps.onProgress?.({ done: Math.min(i + chunk.length, ops.length), total: ops.length });
        }
      } finally {
        deps.onProgress?.(null);
      }
      await book.saveOrder(bookId, token);
      // 全部送完再讀一次：順序與 id 以伺服器為準（舊版伺服器不回 createdEntryIds 時也靠這一步補上）。
      book.entries = await fetchWorldbookEntries(bookId, token).catch(() => book.entries);
      book.original = JSON.parse(JSON.stringify(book.entries));
      return bookId;
    },

    /**
     * 條目順序。上游那邊常駐條目每輪有上限，擠不下時留的是排在前面的幾條——
     * 不送這一趟，順序在上游全是 0，實際留誰退到按條目 id 比大小。
     * 排在條目增刪改之後：剛建的條目要先拿到 id 才排得進去。順序沒動就不送。
     */
    async saveOrder(bookId: string, token: string) {
      const ids = book.entries.map((entry) => entry.entryId).filter(Boolean) as string[];
      if (ids.length < 2) return;
      const before = book.original.map((entry) => entry.entryId).filter(Boolean) as string[];
      if (before.join(",") === ids.join(",")) return;
      await reorderWorldbookEntries(bookId, ids, token);
    },
    /** 一段送成功之後：刪掉的從原始清單移除、改過的更新原始清單、新建的拿到 id 並加進原始清單。 */
    reconcileChunk(chunk: WorldbookOp[], createdIds: string[]) {
      let k = 0;
      for (const { op, entry } of chunk) {
        if (op.op === "delete") {
          book.original = book.original.filter((e) => e.entryId !== op.entryId);
        } else if (op.op === "update" && entry) {
          book.original = book.original.map((e) => (e.entryId === entry.entryId ? JSON.parse(JSON.stringify(entry)) : e));
        } else if (op.op === "create" && entry) {
          const id = createdIds[k++];
          if (!id) continue;
          entry.entryId = id;
          book.original.push(JSON.parse(JSON.stringify(entry)));
        }
      }
    },
    /**
     * 改書名／描述要送的那一份。上游是整份覆蓋，所以圖示、標籤、可見性照上游現況原樣帶回去。
     * 可見性缺值時上游會把它正規化成 private——那等於偷偷把一本公開的書收起來，所以讀不到現況就不送。
     */
    metadataPatch(): WorldbookMetadataPatch | undefined {
      const base = book.meta;
      if (!base || !base.visibility) return undefined;
      return {
        name: book.name.trim() || base.name,
        description: book.desc,
        iconUrl: base.iconUrl ?? "",
        visibility: base.visibility,
        tags: (base.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      };
    },
    /** 送成功了：基準跟著往前走，同一份不會在下次儲存又送一遍。 */
    acceptMetadata(metadata: WorldbookMetadataPatch) {
      if (!book.meta) return;
      book.meta = { ...book.meta, name: metadata.name, description: metadata.description };
    },
  });
  return book;
}

export type WorldbookDraft = ReturnType<typeof useWorldbookDraft>;
