-- 上線預設（owner 2026-11-19 授權上線，PM 裁定①，任務 2026-11-19-profile-visibility）：
-- 改版前他人看不到任何關注與粉絲資訊。遷移當下已存在的帳號，關注設成「隱藏」維持現況；
-- 粉絲數依需求原話不能隱藏，維持欄位預設「僅數量」。之後新註冊的帳號照欄位預設（兩者都是 count）。
-- 0134 只加欄位（DDL），回填獨立一個檔。正式量級約七千列，members 上沒有針對這個欄位的觸發器。
UPDATE members SET following_visibility = 'hidden';
