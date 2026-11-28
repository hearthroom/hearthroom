-- The quality feed is cumulative and mutable. Keep its first observation on day seven.
CREATE TABLE review_publication_day7 (
  version_id TEXT PRIMARY KEY REFERENCES hosting_versions(version_id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  rate_percent INTEGER CHECK (rate_percent BETWEEN 0 AND 100)
);

CREATE INDEX review_publication_outcome_window ON hosting_versions(published_at) WHERE published_at IS NOT NULL;

-- Private D1 report. Only completed UTC publication weeks whose entire day-seven
-- observation window has closed are eligible. Attribute enforcement to its version.
CREATE VIEW review_publication_outcomes_weekly AS
WITH clock AS (
  SELECT CAST(unixepoch('now') * 1000 AS INTEGER) AS now_ms,
    86400000 AS day_ms, 604800000 AS week_ms, 4 * 86400000 AS first_monday
), bounds AS (
  SELECT now_ms, week_ms, first_monday, ((now_ms - 8 * day_ms - first_monday) / week_ms) * week_ms + first_monday AS week_end
  FROM clock
), outcomes AS (
  SELECT v.card_id, ((v.published_at - b.first_monday) / b.week_ms) * b.week_ms + b.first_monday AS week_start, s.kind,
    CASE
      WHEN EXISTS(SELECT 1 FROM review_events a WHERE a.submission_id=s.id AND a.action='approve'
        AND a.final_source='ai_fast_track') THEN 'ai'
      WHEN EXISTS(SELECT 1 FROM review_events a WHERE a.submission_id=s.id AND a.action='approve'
        AND a.actor_kind='reviewer') THEN 'human'
      ELSE 'unattributed'
    END AS approval_source,
    q.observed_at, q.rate_percent,
    (SELECT MIN(at) FROM (
      SELECT CASE WHEN m.action='suspend' THEN m.created_at ELSE m.decided_at END AS at
      FROM moderation_cases m WHERE m.provider=v.provider AND m.source_role_id=v.source_role_id AND m.version_id=v.version_id
        AND (m.action='suspend' OR (m.action='delist' AND m.status='confirmed'))
      UNION ALL
      SELECT x.completed_at FROM review_corrections x WHERE x.submission_id=s.id AND x.state='complete'
        AND x.public_state IN ('previous_version','unpublished')
    ) WHERE at>=v.published_at AND at<=b.now_ms) - v.published_at AS time_to_removal
  FROM bounds b CROSS JOIN hosting_versions v JOIN review_submissions s ON s.id=v.submission_id
  JOIN review_events e ON e.event_key='first:'||s.id AND e.action='first_decision' AND e.to_state='approved'
  LEFT JOIN review_publication_day7 q ON q.version_id=v.version_id
  WHERE v.provider='harbor' AND v.published_at>=b.week_end-12*b.week_ms AND v.published_at<b.week_end
)
SELECT week_start, kind, approval_source, COUNT(*) AS publications, COUNT(DISTINCT card_id) AS cards,
  COUNT(DISTINCT CASE WHEN time_to_removal<604800000 THEN card_id END) AS removed_within_7d,
  COUNT(DISTINCT CASE WHEN time_to_removal IS NOT NULL THEN card_id END) AS removed_as_of,
  COUNT(observed_at) AS observed,
  COUNT(CASE WHEN observed_at IS NOT NULL AND rate_percent IS NULL THEN 1 END) AS underpowered,
  COUNT(CASE WHEN observed_at IS NULL THEN 1 END) AS missing,
  COUNT(CASE WHEN rate_percent BETWEEN 0 AND 19 THEN 1 END) AS rate_00_19,
  COUNT(CASE WHEN rate_percent BETWEEN 20 AND 39 THEN 1 END) AS rate_20_39,
  COUNT(CASE WHEN rate_percent BETWEEN 40 AND 59 THEN 1 END) AS rate_40_59,
  COUNT(CASE WHEN rate_percent BETWEEN 60 AND 79 THEN 1 END) AS rate_60_79,
  COUNT(CASE WHEN rate_percent BETWEEN 80 AND 100 THEN 1 END) AS rate_80_100
FROM outcomes
GROUP BY week_start, kind, approval_source;
