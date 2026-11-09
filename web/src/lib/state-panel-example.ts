/**
 * 「用範例皮膚」插入的面板皮膚：逐項列出最外層的數值，不認得任何鍵名，所以哪張卡、哪種語言都能直接用。
 *
 * 皮膚畫在遊玩畫布裡，不跟站台的淺深色走，所以顏色只用半透明的灰與 currentColor：
 * 疊在淺底或深底上都讀得到，字色沿用畫布本身的字色。
 * 清單逐項排成小標籤；群組的子項寫「名稱 值」（@key 與 @index 相同時是清單，不寫名稱）。
 * 沒有項目的群組什麼都不寫：{{this}} 遇到物件會印出 [object Object]，所以只印數字、是否（比大小成立）與有字的文字。
 * 只用面板渲染器支援的 Handlebars 子集（#each、#if、#unless、eq、or、gte、lt、@key、@index）。
 */
export const EXAMPLE_PANEL_SKIN = `<style>
.board { display: grid; gap: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(128, 128, 128, .35); background: rgba(128, 128, 128, .12); font-size: 13px; line-height: 1.5; }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.name { opacity: .7; }
.value { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; font-weight: 600; text-align: right; }
.item { padding: 0 8px; border-radius: 999px; background: rgba(128, 128, 128, .18); font-weight: 500; }
</style>
<div class="board">
{{#each this}}
  <div class="row">
    <span class="name">{{@key}}</span>
    <span class="value">{{#each this}}<span class="item">{{#unless (eq @key @index)}}{{@key}} {{/unless}}{{this}}</span>{{else}}{{#if (or (gte this 0) (lt this 0) this.length)}}{{this}}{{/if}}{{/each}}</span>
  </div>
{{/each}}
</div>
`;
