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

/**
 * 作者手寫 HTML 用 \n 換行的散文：只把「最外層的文字節點」裡的換行換成 <br>，標籤裡面的縮排換行不動
 * （對話頁對重 HTML 的訊息也是這樣做）。要在元件庫跑之前做，所以是一般 script、放在模組 script 前面。
 */
const BREAKS_SCRIPT = `
(function () {
  var host = document.getElementById("hc-welcome");
  if (!host) return;
  Array.prototype.slice.call(host.childNodes).forEach(function (n) {
    if (n.nodeType !== 3 || n.nodeValue.indexOf("\\n") < 0) return;
    var parts = n.nodeValue.split("\\n");
    var frag = document.createDocumentFragment();
    parts.forEach(function (t, i) { if (i) frag.appendChild(document.createElement("br")); frag.appendChild(document.createTextNode(t)); });
    host.replaceChild(frag, n);
  });
})();`;

export function buildSrcdoc(html: string, tokens: { color: string; font: string }, extra = ""): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${hcCss}</style>` +
    `<style>html,body{margin:0;background:transparent;color:${tokens.color};font:14px/1.7 ${tokens.font};word-break:break-word}` +
    `img,video{max-width:100%}</style></head><body><div id="hc-welcome">${html}</div>` +
    // 功能欄展開後的內容：作者把全域樣式與腳本放在這裡，樣式與腳本要生效、按鈕本身不用露出來
    (extra ? `<div id="hc-mount" hidden>${extra}</div>` : "") +
    `<script>${BREAKS_SCRIPT}${END}<script type="module">${hcJs}${END}<script>${SIZE_SCRIPT}${END}</body></html>`
  );
}
