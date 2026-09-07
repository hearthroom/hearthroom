/**
 * HTML 卡開場白的 iframe 內容。
 *
 * 元件庫與樣式直接從舞台子模組的原始檔讀進來（?raw），跟對話頁是同一份；
 * 高度由 iframe 自己量了用 postMessage 報回來，頁面不用猜。
 * 字串裡不能出現「</script>」原文（SFC 解析器會把它當成區塊結尾），所以拆開寫。
 */
import hcCss from "../../../stage/src/common/html-card.css?raw";
import hcJs from "../../../stage/src/common/html-card-components.js?raw";

export const SIZE_MESSAGE = "hc-card-size";

const SIZE_SCRIPT = `
(function () {
  var last = 0;
  function report() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (h && h !== last) { last = h; parent.postMessage({ type: "${SIZE_MESSAGE}", height: h }, "*"); }
  }
  new ResizeObserver(report).observe(document.documentElement);
  window.addEventListener("load", report);
  report();
})();`;

const END = "</scr" + "ipt>";

export function buildSrcdoc(html: string, tokens: { color: string; font: string }): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${hcCss}</style>` +
    `<style>html,body{margin:0;background:transparent;color:${tokens.color};font:14px/1.7 ${tokens.font};word-break:break-word}` +
    `img,video{max-width:100%}</style></head><body>${html}` +
    `<script type="module">${hcJs}${END}<script>${SIZE_SCRIPT}${END}</body></html>`
  );
}
