/**
 * 卡片頁的開場白：照對話頁的方式畫。
 *
 * 對話頁畫一則訊息的步驟（stage/src/pages/canvas/canvas.vue 的 renderMessage）：
 *   1. 作者的正則規則（顯示層替換）——酒館／MMD 卡靠它把 <zzt>、【开局配置】 這類標記換成版面；
 *   2. 酒館來源的卡把裸 <style> 加上訊息層前綴；
 *   3. 拿掉非標準名字的標籤、留內文；
 *   4. 開頭就是 HTML 的整段照 HTML 畫，否則走 markdown（單換行成 <br>）。
 * 這裡用同一份規則引擎原始檔（stage/src/pages/canvas/*），步驟一樣，只少了串流快取與隱藏資料的
 * stash（開場白一次到位，用不著）。
 *
 * 規則來自玩家面的作者資產；沒有資產（遊客、或作者沒設）就只走 3、4。
 */
import MarkdownIt from "markdown-it";
import { applyTavernRules } from "stage-canvas/rule-engine";
import { normalizeCardFormat, scopeCardHtml } from "stage-canvas/style-scope";
import { stripUnknownTags } from "stage-canvas/platform-defaults";
import type { PlayerAsset } from "@/lib/api";

// 跟 stage/src/utils/rich-text-renderer.js 的 isHeavyHtml 同一個判準：開頭就是區塊級 HTML 或 hc-* 元件才算重 HTML。
const HEAVY_HTML_TAGS = /<\s*(div|section|article|header|footer|nav|main|aside|h[1-6]|p|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|td|th|form|fieldset|figure|hr|body|html|pre|blockquote|code|details|summary|audio|video|canvas|iframe)(\s|>|\/)/i;
const CUSTOM_HC_TAGS = /<\s*hc-[a-z]/i;

export function isHeavyHtml(content: string): boolean {
  const trimmed = content.replace(/^[\s\n]+/, "");
  if (!trimmed.startsWith("<")) return false;
  const head = trimmed.substring(0, 200);
  return HEAVY_HTML_TAGS.test(head) || CUSTOM_HC_TAGS.test(head);
}

/** 有任何一個真正的標籤就算 HTML（<b>、<section>、<hc-stat>…）；純文字裡的 < 不算。 */
export function hasHtml(s: string): boolean {
  return /<[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(s);
}

let md: MarkdownIt | null = null;
function markdown(): MarkdownIt {
  // 跟對話頁同一組選項：允許 inline HTML、單換行成 <br>、自動連結、不做排版替換
  md ??= new MarkdownIt({ html: true, breaks: true, linkify: true, typographer: false });
  return md;
}

export interface RenderedWelcome {
  /** 要畫的 HTML；純文字開場白時是空字串（呼叫端走純文字那條路） */
  html: string;
  /** 功能欄展開後的 HTML（作者常把全域樣式與腳本放在這裡）；沒有就是空字串 */
  mountHtml: string;
}

export function renderWelcome(raw: string, opts: { charName: string; userName: string; asset: PlayerAsset | null }): RenderedWelcome {
  const macros = { char: opts.charName, user: opts.userName };
  const rules = opts.asset?.rules ?? [];
  const format = normalizeCardFormat(opts.asset?.cardFormat);
  const ruleOptions = { macros, variants: opts.asset?.variants ?? undefined };

  let text = raw.replace(/\{\{\s*char\s*\}\}/gi, opts.charName).replace(/\{\{\s*user\s*\}\}/gi, opts.userName);
  if (rules.length) {
    text = applyTavernRules(text, rules, ruleOptions).html;
    text = scopeCardHtml(text, format);
  }
  text = stripUnknownTags(text);

  let mountHtml = "";
  if (rules.length && opts.asset?.mountTrigger) {
    mountHtml = scopeCardHtml(applyTavernRules(opts.asset.mountTrigger, rules, ruleOptions).html, format);
  }

  if (!hasHtml(text) && !mountHtml) return { html: "", mountHtml: "" };
  const html = isHeavyHtml(text) ? text : markdown().render(text);
  return { html, mountHtml };
}
