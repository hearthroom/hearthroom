-- A versioned snapshot makes the source correction a one-time site-wide job.
-- No referral credits or payment rows are written by this job.
CREATE TABLE IF NOT EXISTS badge_stats_backfill_runs (
 job_key TEXT PRIMARY KEY,
 seeded_at INTEGER,
 completed_at INTEGER,
 outcome TEXT NOT NULL DEFAULT 'running' CHECK(outcome IN('running','complete','incomplete'))
);
CREATE TABLE IF NOT EXISTS badge_stats_backfill_members (
 job_key TEXT NOT NULL REFERENCES badge_stats_backfill_runs(job_key),
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 account_no INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','done','identity_changed','unavailable')),
 incomplete_reads INTEGER NOT NULL DEFAULT 0 CHECK(incomplete_reads>=0),
 attempted_at INTEGER,
 applied_at INTEGER,
 effective_invites INTEGER,
 last_error TEXT CHECK(last_error IS NULL OR last_error IN('unavailable','incomplete','retry')),
 PRIMARY KEY(job_key,member_id)
);
CREATE INDEX IF NOT EXISTS badge_stats_backfill_pending ON badge_stats_backfill_members(job_key,status,attempted_at,account_no);
INSERT OR IGNORE INTO badge_stats_backfill_runs(job_key) VALUES('invite-source-v2');
INSERT OR IGNORE INTO badge_stats_backfill_members(job_key,member_id,account_no)
SELECT 'invite-source-v2',member_id,account_no FROM (
 SELECT m.id member_id,CAST(i.external_id AS INTEGER) account_no,
 ROW_NUMBER() OVER(PARTITION BY m.id ORDER BY i.linked_at DESC,i.external_id) n
 FROM member_identities i LEFT JOIN member_connections c ON c.provider=i.provider AND c.external_id=i.external_id
 JOIN members m ON m.id=COALESCE(c.owner_member_id,i.member_id)
 WHERE i.provider='harbor' AND m.account_class='normal'
 AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)
) WHERE n=1 AND account_no>0
AND EXISTS(SELECT 1 FROM badge_stats_backfill_runs WHERE job_key='invite-source-v2' AND seeded_at IS NULL);
UPDATE badge_stats_backfill_runs SET seeded_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE job_key='invite-source-v2' AND seeded_at IS NULL;
