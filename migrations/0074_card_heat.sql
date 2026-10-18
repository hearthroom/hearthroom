-- 卡片熱度（2026-10-18）：作者以外的人在這張卡（作品各已發布版本合計）上扣掉的點數，由 Harbor 計算。
-- 每小時的熱度同步整批回寫（src/heat.ts）；日／週／月榜與最熱依它排序。新登記的卡在下一輪同步前是 0。
ALTER TABLE cards ADD COLUMN heat INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_cards_heat ON cards (heat DESC, talk_num DESC, registered_at DESC);
CREATE INDEX idx_cards_zone_heat ON cards (zone, heat DESC, talk_num DESC, registered_at DESC);
