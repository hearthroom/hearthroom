---
id: MODERATION-01
priority: P0
platforms: [desktop-web, mobile-web]
page: /review
preconditions:
  - Local isolated synthetic reviewer and manager sessions; never real moderation data
  - One pending suspension proposed by a different reviewer
  - One approved work with an immutable public version
states: [pending, evidence, confirmation, cancelled, confirmed, history, manager-compensation, empty]
mutating: true
critical_payloads: [card-number, reviewed-version, proposal-reason, public-evidence, peer-vote-reason, board-and-hours, persistent-history]
---

# 案件複核與補償

1. 從 HearthRoom 首頁或手機帳號選單的「社群管理」進入工作台，預設卡片審核；切到處置複核。
2. 確認卡片審核與處置複核各顯示自己的待辦數，再選擇另一位審核員提出的嚴重暫停案件。
3. 打開案件內容。
4. 填寫第二位的具體理由。
5. 按同意處置。
6. 在確認框取消。
7. 再次同意並確認。
8. 切到處理紀錄。
9. 開啟剛才的案件。
10. 切到作品管理並選取該作品。
11. 填補償理由並展開管理員工具。
12. 選日榜及 12 小時。
13. 按補償並確認。
14. 再次開啟作品歷史。

預期：卡號／版本、原始內容、立案理由與兩票理由可回訪；理由空白不能投票；取消沒有寫入；第二票後待辦減少；補償確認框與紀錄都明確顯示日榜 12 小時。頁面在 390px 寬度、繁中與英文可閱讀與操作；按鈕無裁切、確認框未被遮擋。登入切換與延遲回應不得復活舊選取（mounted component regression）。

本機場景可直接 seeded 至工作台，不需真實 OAuth。跨人投票、撤回、版本競爭、重新登記、來源同步、快取失效及公開 hosting 拒絕由 `test/moderation.test.ts` 的真實 D1 integration cases 驗證；UI 合成 API 結果不能替代這些檢查。

Probe 使用專案 `ui-visual-audit.mjs`：桌面 24px、觸控 44px。多行作品選取列採靠左對齊，不以文字水平居中判斷失敗；共用頁首／頁尾小目標另行紀錄，不混稱新增工作台控制項。

統一導覽回歸：四個功能與卡片審核詳情共用一個社群管理標題；手機兩欄導覽與英文窄桌面頁首可正常操作。重整／上一頁保留功能定位；舊 `/en/review/manage` 導向 `/en/review/cases`，全程保留英文。切換分頁中的遲到回應與待確認投票不能寫回舊選取。
