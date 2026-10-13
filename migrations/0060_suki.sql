-- 蘇綺的照顧與召回（設定集「拓麻歌子與 QQ 寵物的枯れた技術水平思考」）。
-- state 是 shared/suki-care.ts 的 SukiState（JSON）；召回預設關閉，要本人打開。
CREATE TABLE suki_states (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  state TEXT NOT NULL,
  recall INTEGER NOT NULL DEFAULT 0,
  tz_offset INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  last_recall INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX suki_states_recall ON suki_states(recall,last_seen);
CREATE TABLE suki_metrics (
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(operation,outcome)
);
