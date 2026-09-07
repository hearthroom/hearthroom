/**
 * 部署前守門的判定規則（純函式，沒有 I/O）。
 *
 * 部署出去的 Worker 必須是 origin/main 上那棵樹，一個字都不多：
 *   - 工作樹髒（含未追蹤檔）→ 同事的半成品會跟著上線（2026-09-06、09-07 各發生一次）
 *   - HEAD ≠ origin/main → 用陳舊代碼蓋掉別人已上線的改動，或部署別人拉不到的東西
 *   - stage 子模組的檢出 ≠ HEAD 釘的 commit → 舞台套件用錯版本打包（09-06 把線上舞台回退過）
 *   - fetch 失敗 → 證明不了同步，一樣不放行
 * DEPLOY_FORCE=1 只給 origin 連不上的搶修：放行但理由照列、標 forced，事後必須立刻對齊。
 */

/**
 * @param {{porcelain: string, submoduleStatus: string, head: string, originMain: string,
 *          stagePinned: string, stageHead: string, fetchOk: boolean, force: boolean}} s
 * @returns {{ok: boolean, forced: boolean, reasons: string[]}}
 */
export function assess(s) {
  const reasons = [];
  const dirty = s.porcelain.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  if (dirty.length) reasons.push(`工作樹有未提交的改動（deploy 會把它們一起打包）：\n  ${dirty.slice(0, 12).join("\n  ")}${dirty.length > 12 ? `\n  …共 ${dirty.length} 筆` : ""}`);
  const badSub = s.submoduleStatus.split("\n").filter((l) => /^[+\-U]/.test(l));
  if (badSub.length) reasons.push(`子模組檢出跟 HEAD 釘的不同：\n  ${badSub.join("\n  ")}\n  先 git submodule update stage`);
  if (!s.fetchOk) reasons.push("git fetch origin 失敗，證明不了本地跟 origin/main 同步");
  else if (s.head !== s.originMain) reasons.push(`HEAD ${s.head.slice(0, 9)} ≠ origin/main ${s.originMain.slice(0, 9)}：先 git pull --rebase、重跑驗證、git push`);
  if (s.stagePinned && s.stageHead && s.stagePinned !== s.stageHead) reasons.push(`stage 檢出 ${s.stageHead.slice(0, 9)} ≠ HEAD 釘的 ${s.stagePinned.slice(0, 9)}：舞台套件會用錯版本打包`);
  const ok = reasons.length === 0 || s.force;
  return { ok, forced: s.force && reasons.length > 0, reasons };
}
