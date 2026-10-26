-- Owner-approved cutover only. Execute atomically after old Worker writers have stopped.
-- Stop on incomplete/contradictory history. A lone schedule audit is not proof of exposure.
CREATE TABLE blog_translation_preflight(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO blog_translation_preflight SELECT 0 FROM blog_posts p WHERE p.first_published_at IS NOT NULL
 AND NOT(p.was_public=1 OR p.status='published' AND p.publish_at IS NOT NULL AND p.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 AND NOT (
  (SELECT COUNT(DISTINCT CAST(json_extract(a.after_json,'$.version') AS INTEGER)) FROM audit_log a
   WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND json_type(a.after_json,'$.version')='integer'
    AND json_extract(a.after_json,'$.version') BETWEEN 1 AND p.version)=p.version
  AND EXISTS(SELECT 1 FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action='publish')
  AND NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action IN('publish','unpublish')
    AND (json_type(a.after_json,'$.version') IS NOT 'integer' OR json_extract(a.after_json,'$.status') IS NOT CASE a.action WHEN 'publish' THEN 'published' ELSE 'unpublished' END
      OR (a.action='publish' AND json_type(a.after_json,'$.publishAt') IS NOT 'integer')))
  AND (SELECT a.action FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action IN('publish','unpublish') ORDER BY CAST(json_extract(a.after_json,'$.version') AS INTEGER) DESC LIMIT 1)
    =CASE p.status WHEN 'published' THEN 'publish' WHEN 'unpublished' THEN 'unpublish' ELSE 'unknown' END
  AND (p.status<>'published' OR p.publish_at IS (SELECT json_extract(a.after_json,'$.publishAt') FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action='publish' ORDER BY CAST(json_extract(a.after_json,'$.version') AS INTEGER) DESC LIMIT 1))
  AND NOT EXISTS(SELECT 1 FROM audit_log a JOIN audit_log b ON b.subject_kind=a.subject_kind AND b.subject_id=a.subject_id
    WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND CAST(json_extract(a.after_json,'$.version') AS INTEGER)<CAST(json_extract(b.after_json,'$.version') AS INTEGER) AND a.created_at>b.created_at)
 ) LIMIT 1;
DROP TABLE blog_translation_preflight;
-- Publication time alone is not history: a future schedule can be cancelled before it starts.
UPDATE blog_posts SET was_public=1 WHERE status='published' AND publish_at IS NOT NULL
 AND publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER);
UPDATE blog_posts SET was_public=1 WHERE was_public=0 AND EXISTS (
 SELECT 1 FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=blog_posts.id AND a.action='publish'
 AND json_extract(a.after_json,'$.status')='published'
 AND CAST(json_extract(a.after_json,'$.publishAt') AS INTEGER) <= COALESCE((
   SELECT MIN(n.created_at) FROM audit_log n WHERE n.subject_kind='blog_post' AND n.subject_id=a.subject_id
    AND n.action IN ('publish','unpublish') AND CAST(json_extract(n.after_json,'$.version') AS INTEGER)>CAST(json_extract(a.after_json,'$.version') AS INTEGER)
 ),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
);
INSERT INTO blog_translation_groups(id,source_locale,version,created_at)
 SELECT id,locale,1,created_at FROM blog_posts WHERE translation_group_id IS NULL ON CONFLICT(id) DO NOTHING;
UPDATE blog_posts SET translation_group_id=id WHERE translation_group_id IS NULL;
