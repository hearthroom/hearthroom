-- One row owns both the default and all stable-work overrides: a save is atomic.
CREATE TABLE leaderboard_privacy (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 anonymous INTEGER NOT NULL DEFAULT 0 CHECK(anonymous IN(0,1)),
 overrides TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(overrides)),
 revision INTEGER NOT NULL DEFAULT 0,
 request_id TEXT,
 request_hash TEXT,
 result TEXT
);
CREATE TABLE leaderboard_privacy_operations (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 result TEXT NOT NULL CHECK(json_valid(result)),
 PRIMARY KEY(member_id,request_id)
);
CREATE TRIGGER leaderboard_privacy_receipt AFTER UPDATE ON leaderboard_privacy
WHEN NEW.request_id IS NOT NULL
BEGIN
 INSERT INTO leaderboard_privacy_operations(member_id,request_id,request_hash,result)
 VALUES(NEW.member_id,NEW.request_id,NEW.request_hash,NEW.result);
END;
