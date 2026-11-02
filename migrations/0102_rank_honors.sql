-- Preserve original publication even when a subsequent first-review path resets registered_at.
CREATE TABLE rank_publications (
 card_id INTEGER PRIMARY KEY,
 published_at INTEGER NOT NULL,
 captured_at INTEGER NOT NULL
);
CREATE INDEX rank_publications_at ON rank_publications(published_at,card_id);
-- The snapshot includes all entrants, their exact windows and tie breakers, including non-winners.
CREATE TABLE rank_settlements (
 zone TEXT NOT NULL CHECK(zone IN ('clean','all')),
 window TEXT NOT NULL CHECK(window IN ('day','week','month')),
 period TEXT NOT NULL,
 settled_at INTEGER NOT NULL,
 receipt TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 PRIMARY KEY(zone,window,period)
);
-- No cascading card/member FK: deleting a work does not erase the author's historical honor or a payment receipt.
CREATE TABLE rank_awards (
 id TEXT PRIMARY KEY,
 card_id INTEGER NOT NULL,
 zone TEXT NOT NULL CHECK(zone IN ('clean','all')),
 window TEXT NOT NULL CHECK(window IN ('day','week','month')),
 period TEXT NOT NULL,
 rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 10),
 band INTEGER NOT NULL CHECK(band IN (1,3,10)),
 member_id TEXT,
 account_no INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),
 awarded_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
 attempts INTEGER NOT NULL DEFAULT 0,
 attempted_at INTEGER,
 paid_at INTEGER,
 UNIQUE(card_id,zone,window),
 FOREIGN KEY(zone,window,period) REFERENCES rank_settlements(zone,window,period)
);
CREATE INDEX rank_awards_member ON rank_awards(member_id,zone,window,band,awarded_at DESC);
CREATE INDEX rank_awards_pending ON rank_awards(status,attempted_at);
CREATE TRIGGER rank_award_public_revision AFTER INSERT ON rank_awards BEGIN
 UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=NEW.member_id;
END;
