# PLAY-STARTUP-01：遊玩頁啟動與原存檔

適用：PlayPage、stage-host、繁簡轉換、模型偏好請求排程。

準備：本機合成登入服務、沙箱卡、非空存檔（例如 checkpoint=7）；可控制 profile／卡片／saves 延遲。不能使用正式憑證或複製正式卡片內容。測試站須正確提供 `/sandbox/` 殼頁與 API CORS。

1. 從 `/play/:roleId?provider=harbor` 經正常登入返回。播放器 JS 應在 profile 完成前請求；私人播放器安裝仍在授權完成後。
2. 量測父頁 Resource Timing 和沙箱 FCP，使用沙箱 timeOrigin 換算相對主文件時間。完整冷／暖條件各自記錄，不把外框 FCP 當作卡片出現。
3. 確認 saves 在沙箱 ready-shell 前開始，只有一次正常初始讀取。初始作者腳本須取得既有 checkpoint，不能先讀空資料。
4. 沙箱初始顯示後確認繁體名稱／開場白、人名及同形字不被誤改。由單元測試補 HTML script/style/verbatim 與反向轉換。
5. 不打開模型選單時 agent-mode 只有畫布的一次。自然點擊打開模型設定應再更新一次；切模型仍更新支援度；關閉時不額外讀取。
6. 桌面與手機寬度檢查卡片、存檔、輸入區及選單，最後恢復 viewport。不要為載入測試發出模型生成。
7. 存檔失敗／帳號變更／換卡／修改後失效由回歸測試驗證；確認沒有跨帳號共享私人 cache。

結果與限制記錄於 [play-startup.md](../../play-startup.md)。正式改善必須在發布後另跑同條件 profile；本機合成結果不能替代正式驗收。

第二輪補驗：同平台 models 授權與 profile 重疊；跨平台先等 profile 才查綁定 token；拒絕／離頁不安裝。快取驗收包含雜湊資源 immutable、沙箱相同 ETag 回 304 且保留 CSP、舊 ETag 回 200。紀錄見 [play-followup.md](../../play-followup.md)。

靜態資源補驗：用正式建置檢查模型圖示網址與實際顯示，重新整理時字典／五語命中快取；一般、沉浸及 Sandbox 卡片維持顯示。建置測試另驗證播放器改版不改變資料 chunk 雜湊，完整 OpenCC preset 比對保護兩方向轉換。紀錄見 [play-assets.md](../../play-assets.md)。
