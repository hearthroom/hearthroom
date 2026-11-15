-- Hold pre-launch credit payouts until explicitly authorized while recording permanent honors immediately.
ALTER TABLE rank_awards ADD COLUMN payout_hold INTEGER NOT NULL DEFAULT 0 CHECK(payout_hold IN (0,1));
CREATE INDEX rank_awards_payable ON rank_awards(status,payout_hold,attempted_at,awarded_at,id) WHERE status='pending' AND payout_hold=0;

-- Immutable audit trail when supplementing an already-settled boundary cohort without revoking existing awards.
CREATE TABLE rank_settlement_supplements (
 supplement_key TEXT NOT NULL,
 zone TEXT NOT NULL CHECK(zone IN ('clean','all')),
 window TEXT NOT NULL CHECK(window IN ('day','week','month')),
 period TEXT NOT NULL,
 settled_at INTEGER NOT NULL,
 receipt TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 PRIMARY KEY(supplement_key,zone,window,period),
 FOREIGN KEY(zone,window,period) REFERENCES rank_settlements(zone,window,period)
);

-- Durable idempotency receipt for releasing held historical rank payouts once authorized.
CREATE TABLE rank_payout_releases (
 release_key TEXT PRIMARY KEY,
 released_at INTEGER NOT NULL,
 award_count INTEGER NOT NULL CHECK(award_count>=0),
 total_amount INTEGER NOT NULL CHECK(total_amount>=0),
 receipt TEXT NOT NULL
);
