/**
 * 編輯頁的開場網頁「檔案」那一半：太大、不放進文字框的頁面（任務 2026-11-25-opening-page-object-storage）。
 *
 * 文字框照舊編輯 OPENING_PAGE_EDIT_MAX_BYTES 以下的頁面（內容在 regexSet.openingPage）。超過的頁面——
 * 上游存著的、作者上傳的、貼上或打字撐大的、匯入帶進來的——留在這裡當 Blob，不轉成字串、不進響應式資料；
 * 畫面上換成檔案卡，只能上傳取代、下載、清除。
 *
 * 存檔怎麼送由 planSave 決定：頁面超過 512 KB 走原始上傳（先傳頁面，拿新版本再送其餘的作者資產），
 * 512 KB 以下照舊放在 JSON 裡。上游存著大頁面時，JSON 的空字串代表「不變」，要清掉得另帶 openingPageClear。
 */
import { markRaw, ref, shallowRef } from "vue";
import { fetchOpeningPage, uploadOpeningPage, type AuthorAsset } from "./api";
import { downloadBlob } from "./save-file";
import {
  isAbortError,
  isHtmlFile,
  OPENING_PAGE_EDIT_MAX_BYTES,
  OPENING_PAGE_FILENAME,
  OPENING_PAGE_INLINE_BYTES,
  utf8Length,
} from "./opening-page";

export interface OpeningFile {
  bytes: number;
  /** 內容：上傳、貼上、匯入的，或已經讀過的上游頁面。還沒讀過的上游頁面是 null。 */
  blob: Blob | null;
  /** 還沒存：作者換了檔案、貼上撐大或匯入。存成功後變成 false。 */
  pending: boolean;
  /** 舊的封存版本，頁面已不保留。 */
  expired?: boolean;
}

export type OpeningFileError = "" | "errFail" | "errDownload" | "errTooBig" | "errType";
export type OpeningFileNotice = "" | "pasted" | "picked" | "cleared";
export type OpeningTransfer = { kind: "upload" | "download" | "load" | "preview"; percent: number | null };

export interface OpeningSavePlan {
  /** 要先用原始上傳送出的頁面（超過 512 KB）；null＝不用。 */
  upload: Blob | null;
  /** JSON 裡的 openingPage：空字串在上游存著大頁面時代表不變。 */
  json: string;
  /** 帶 openingPageClear：上游存著大頁面、而作者要它沒有。 */
  clear: boolean;
}

export interface OpeningFileDeps {
  /** 文字框現在的內容。 */
  text(): string;
  /** 換文字框的內容；baseline 時連「上次存的」一起換（讀進來的不算改動）。 */
  setText(value: string, baseline: boolean): void;
  token(): Promise<string | null>;
  /** 清除前的確認（大頁面清掉就救不回來）。 */
  confirmClear(): Promise<boolean>;
  /** 已有內容時上傳新檔案前的確認。 */
  confirmReplace(): Promise<boolean>;
  maxBytes(): number;
}

const percentOf = (loaded: number, total: number) => (total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : null);

export function useOpeningFile(deps: OpeningFileDeps) {
  const file = shallowRef<OpeningFile | null>(null);
  /** 上游現在存著一份超過 512 KB 的頁面（JSON 的空字串會被當成不變）。 */
  const storedLarge = ref(false);
  let storedUrl = "";
  const cleared = ref(false);
  const transfer = ref<OpeningTransfer | null>(null);
  const error = ref<OpeningFileError>("");
  const notice = ref<OpeningFileNotice>("");
  let controller: AbortController | null = null;

  const setFile = (next: OpeningFile | null) => {
    file.value = next ? markRaw({ ...next, blob: next.blob ? markRaw(next.blob) : null }) : null;
  };

  function reset() {
    controller?.abort();
    controller = null;
    setFile(null);
    storedLarge.value = false;
    storedUrl = "";
    cleared.value = false;
    transfer.value = null;
    error.value = "";
    notice.value = "";
  }

  /** 只記上游的狀態，不動畫面（讀取時作者已經有本機改動的情況）。 */
  function adoptServer(asset: AuthorAsset) {
    const inline = asset.openingPage ?? "";
    const bytes = asset.openingPageBytes ?? (inline ? utf8Length(inline) : 0);
    storedLarge.value = !inline && bytes > OPENING_PAGE_INLINE_BYTES;
    storedUrl = asset.openingPageUrl ?? "";
  }

  /**
   * 讀到上游的作者資產：小頁面已經在文字框裡（ruleSetFromAuthorAsset），超過編輯門檻的移出來；
   * 上游沒內嵌的大頁面，門檻以下自動讀進文字框，以上只顯示檔案卡。
   */
  function adopt(asset: AuthorAsset) {
    reset();
    adoptServer(asset);
    const inline = asset.openingPage ?? "";
    const bytes = asset.openingPageBytes ?? 0;
    if (inline) {
      const size = utf8Length(inline);
      if (size > OPENING_PAGE_EDIT_MAX_BYTES) {
        setFile({ bytes: size, blob: new Blob([inline], { type: "text/html" }), pending: false });
        deps.setText("", true);
      }
      return;
    }
    if (bytes <= 0 || !storedUrl) return;
    setFile({ bytes, blob: null, pending: false, ...(asset.openingPageExpired ? { expired: true } : {}) });
    if (bytes <= OPENING_PAGE_EDIT_MAX_BYTES && !asset.openingPageExpired) void loadIntoEditor();
  }

  /** 上游的頁面不大：讀進文字框。中途作者換了檔案或清掉，就不蓋。失敗留在檔案卡上，下載可重試。 */
  async function loadIntoEditor() {
    const target = file.value;
    try {
      const blob = await contentOf("load");
      if (file.value !== target) return;
      const text = await blob.text();
      if (file.value !== target) return;
      setFile(null);
      deps.setText(text, true);
    } catch (err) {
      if (file.value === target && !isAbortError(err)) error.value = "errDownload";
    }
  }

  /** 頁面內容：檔案卡已有就直接用，沒有就從上游讀（顯示進度、可取消），讀到的留著下次用。 */
  async function contentOf(kind: OpeningTransfer["kind"]): Promise<Blob> {
    const current = file.value;
    if (!current) return new Blob([deps.text()], { type: "text/html" });
    if (current.blob) return current.blob;
    const token = await deps.token();
    if (!token) throw new Error("auth");
    controller?.abort();
    const own = new AbortController();
    controller = own;
    transfer.value = { kind, percent: 0 };
    error.value = "";
    try {
      const blob = await fetchOpeningPage(storedUrl, token, {
        total: current.bytes,
        signal: own.signal,
        onProgress: (loaded, total) => { if (controller === own) transfer.value = { kind, percent: percentOf(loaded, total) }; },
      });
      // 留著下次用；同一張卡片物件，讀取中的其他流程（讀進文字框）才認得出是同一份
      if (file.value === current) current.blob = markRaw(blob);
      return blob;
    } finally {
      if (controller === own) { controller = null; transfer.value = null; }
    }
  }

  async function download() {
    try {
      downloadBlob(await contentOf("download"), OPENING_PAGE_FILENAME);
    } catch (err) {
      if (!isAbortError(err)) error.value = "errDownload";
    }
  }

  /** 預覽要的頁面（Blob）；讀失敗回 null，錯誤顯示在卡上。 */
  async function previewContent(): Promise<Blob | null> {
    try {
      return await contentOf("preview");
    } catch (err) {
      if (!isAbortError(err)) error.value = "errDownload";
      return null;
    }
  }

  /**
   * 選了檔案：先在本機檢查，不合格原本的頁面不動；已有內容先確認要不要取代。
   * 門檻以下放進文字框（可繼續編輯），以上變成待存的檔案。回傳有沒有換掉。
   */
  async function pick(picked: File): Promise<boolean> {
    error.value = "";
    if (!isHtmlFile(picked)) { error.value = "errType"; return false; }
    if (picked.size > deps.maxBytes()) { error.value = "errTooBig"; return false; }
    if (hasPage() && !(await deps.confirmReplace())) return false;
    controller?.abort();
    cleared.value = false;
    notice.value = "picked";
    if (picked.size <= OPENING_PAGE_EDIT_MAX_BYTES) {
      const text = await picked.text();
      setFile(null);
      deps.setText(text, false);
      return true;
    }
    setFile({ bytes: picked.size, blob: picked, pending: true });
    deps.setText("", false);
    return true;
  }

  /**
   * 一次貼上就讓內容超過編輯門檻：整份收成待存的檔案，文字框換成檔案卡（內容保留、可存可下載）。
   * 逐字打字跨過門檻不切換（游標不能跳走），由編輯元件只在貼上時呼叫。
   */
  function paste(text: string) {
    controller?.abort();
    cleared.value = false;
    error.value = "";
    notice.value = "pasted";
    setFile({ bytes: utf8Length(text), blob: new Blob([text], { type: "text/html" }), pending: true });
    deps.setText("", false);
  }

  /** 匯入的卡帶著大頁面：跟貼上一樣收成待存的檔案，不放進文字框。 */
  function importText(text: string) {
    reset();
    if (utf8Length(text) > OPENING_PAGE_EDIT_MAX_BYTES) {
      setFile({ bytes: utf8Length(text), blob: new Blob([text], { type: "text/html" }), pending: true });
      return true;
    }
    return false;
  }

  /** 清除：先確認，確認後回到空白文字框，存檔時才真的清掉。 */
  async function clear(): Promise<boolean> {
    if (!(await deps.confirmClear())) return false;
    controller?.abort();
    setFile(null);
    deps.setText("", false);
    cleared.value = true;
    error.value = "";
    notice.value = "cleared";
    return true;
  }

  function cancel() {
    controller?.abort();
  }

  /** 開場網頁現在有沒有內容（檔案卡或文字框）。 */
  const hasPage = () => !!file.value || !!deps.text().trim();
  /** 開場網頁現在多大。 */
  const bytes = () => (file.value ? file.value.bytes : utf8Length(deps.text()));
  /** 有沒有還沒存的改動（文字框的改動另由作者資產比對）。 */
  const dirty = () => !!file.value?.pending || cleared.value;

  /**
   * 決定存檔怎麼送。original 是上次存下來的文字框內容；dropPage＝換成開場白、網頁要移除。
   */
  async function planSave(input: { text: string; original: string; dropPage: boolean }): Promise<OpeningSavePlan> {
    const keep = { upload: null, json: "", clear: false };
    if (input.dropPage) return { ...keep, clear: storedLarge.value };
    const current = file.value;
    if (current) {
      if (!current.pending && storedLarge.value) return keep;
      const blob = current.blob ?? (await contentOf("upload"));
      if (blob.size > OPENING_PAGE_INLINE_BYTES) return { ...keep, upload: blob };
      return { ...keep, json: await blob.text() };
    }
    const changed = cleared.value || input.text !== input.original;
    const size = utf8Length(input.text);
    if (!changed) return size > OPENING_PAGE_INLINE_BYTES ? keep : { ...keep, json: input.text };
    if (!input.text) return { ...keep, clear: storedLarge.value };
    if (size > OPENING_PAGE_INLINE_BYTES) return { ...keep, upload: new Blob([input.text], { type: "text/html" }) };
    return { ...keep, json: input.text };
  }

  /** 原始上傳：進度顯示在卡上、可取消；失敗原本的頁面不變，檔案留著等下次儲存。 */
  async function upload(roleId: string, page: Blob, version: number, token: string): Promise<AuthorAsset> {
    controller?.abort();
    const own = new AbortController();
    controller = own;
    transfer.value = { kind: "upload", percent: 0 };
    error.value = "";
    try {
      const saved = await uploadOpeningPage(roleId, page, version, token, {
        signal: own.signal,
        onProgress: (loaded, total) => { if (controller === own) transfer.value = { kind: "upload", percent: percentOf(loaded, total) }; },
      });
      storedLarge.value = true;
      storedUrl = saved.openingPageUrl ?? storedUrl;
      cleared.value = false;
      notice.value = "";
      const current = file.value;
      if (current?.pending && current.blob === page) setFile({ bytes: page.size, blob: page, pending: false });
      return saved;
    } catch (err) {
      if (!isAbortError(err)) error.value = "errFail";
      throw err;
    } finally {
      if (controller === own) { controller = null; transfer.value = null; }
    }
  }

  /** JSON 存完：照回應更新上游狀態。舊上游不回大小時，清掉的就當沒有了。 */
  function saved(asset: AuthorAsset, plan: Pick<OpeningSavePlan, "clear">) {
    if (typeof asset.openingPageBytes === "number") {
      storedLarge.value = !asset.openingPage && asset.openingPageBytes > OPENING_PAGE_INLINE_BYTES;
      storedUrl = asset.openingPageUrl ?? storedUrl;
    } else if (plan.clear) storedLarge.value = false;
    if (plan.clear && file.value && !file.value.pending) setFile(null);
    cleared.value = false;
    notice.value = "";
    if (error.value === "errFail") error.value = "";
  }

  return {
    file, storedLarge, cleared, transfer, error, notice,
    reset, adopt, adoptServer, pick, paste, importText, clear, cancel, download, previewContent,
    hasPage, bytes, dirty, planSave, upload, saved,
  };
}

export type OpeningFileControl = ReturnType<typeof useOpeningFile>;
