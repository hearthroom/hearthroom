-- 新版沙箱卡的存檔（sdk.save.*）。
--
-- 沙箱殼跑在跨源 iframe 裡、不發任何請求；作者腳本寫的存檔由宿主（本站前端）代辦落到這裡，
-- 換裝置還在。每個成員、每張卡、每個 key 一列；key 由殼驗過（[A-Za-z0-9_-]{1,64}），
-- value 是 JSON 文字（單值上限 64 KB、每張卡最多 10 個 key，在程式裡擋）。
CREATE TABLE card_saves (
  member_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, role_id, key)
);
