-- Stop on incomplete/contradictory history. A lone schedule audit is not proof of exposure.
CREATE TABLE blog_translation_preflight(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO blog_translation_preflight SELECT 0 FROM blog_posts p WHERE p.first_published_at IS NOT NULL
 AND NOT(p.status='published' AND p.publish_at IS NOT NULL AND p.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 AND NOT (
  (SELECT COUNT(DISTINCT CAST(json_extract(a.after_json,'$.version') AS INTEGER)) FROM audit_log a
   WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND json_type(a.after_json,'$.version')='integer'
    AND json_extract(a.after_json,'$.version') BETWEEN 1 AND p.version)=p.version
  AND EXISTS(SELECT 1 FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action='publish')
  AND NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action IN('publish','unpublish')
    AND (json_type(a.after_json,'$.version') IS NOT 'integer' OR json_extract(a.after_json,'$.version') NOT BETWEEN 1 AND p.version
      OR json_extract(a.after_json,'$.status') IS NOT CASE a.action WHEN 'publish' THEN 'published' ELSE 'unpublished' END
      OR (a.action='publish' AND json_type(a.after_json,'$.publishAt') IS NOT 'integer')))
  AND (SELECT a.action FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action IN('publish','unpublish') ORDER BY CAST(json_extract(a.after_json,'$.version') AS INTEGER) DESC LIMIT 1)
    =CASE p.status WHEN 'published' THEN 'publish' WHEN 'unpublished' THEN 'unpublish' ELSE 'unknown' END
  AND (p.status<>'published' OR p.publish_at IS (SELECT json_extract(a.after_json,'$.publishAt') FROM audit_log a WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND a.action='publish' ORDER BY CAST(json_extract(a.after_json,'$.version') AS INTEGER) DESC LIMIT 1))
  AND NOT EXISTS(SELECT 1 FROM audit_log a JOIN audit_log b ON b.subject_kind=a.subject_kind AND b.subject_id=a.subject_id
    WHERE a.subject_kind='blog_post' AND a.subject_id=p.id AND CAST(json_extract(a.after_json,'$.version') AS INTEGER)<CAST(json_extract(b.after_json,'$.version') AS INTEGER) AND a.created_at>b.created_at)
 ) LIMIT 1;
DROP TABLE blog_translation_preflight;
-- Explicit language versions. NULL group IDs remain readable during the old-Worker window.
CREATE TABLE blog_translation_groups (
 id TEXT PRIMARY KEY,
 source_locale TEXT NOT NULL CHECK(source_locale IN ('zh-Hant','zh-Hans','en','ja','ko')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at INTEGER NOT NULL
);
ALTER TABLE blog_posts ADD COLUMN translation_group_id TEXT REFERENCES blog_translation_groups(id);
ALTER TABLE blog_posts ADD COLUMN was_public INTEGER NOT NULL DEFAULT 0 CHECK(was_public IN (0,1));
CREATE UNIQUE INDEX blog_translation_locale_unique ON blog_posts(translation_group_id,locale);

-- Install guards before backfill so old save/restore statements cannot corrupt grouped rows.
CREATE TRIGGER blog_translation_source_locked BEFORE UPDATE OF locale,translation_group_id ON blog_posts
WHEN OLD.translation_group_id IS NOT NULL
 AND OLD.locale = (SELECT source_locale FROM blog_translation_groups WHERE id=OLD.translation_group_id)
 AND (NEW.locale <> OLD.locale OR NEW.translation_group_id IS NOT OLD.translation_group_id)
 AND EXISTS(SELECT 1 FROM blog_posts q WHERE q.translation_group_id=OLD.translation_group_id AND q.id<>OLD.id)
BEGIN SELECT RAISE(ABORT,'blog_translation_source_locked'); END;

CREATE TRIGGER blog_permalink_locked BEFORE UPDATE OF locale,column_id,slug ON blog_posts
WHEN (NEW.locale<>OLD.locale OR NEW.column_id<>OLD.column_id OR NEW.slug<>OLD.slug)
 AND (OLD.was_public=1 OR (OLD.status='published' AND OLD.publish_at IS NOT NULL AND OLD.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))
BEGIN SELECT RAISE(ABORT,'blog_permalink_locked'); END;

CREATE TRIGGER blog_column_permalink_locked BEFORE UPDATE OF slug ON blog_columns
WHEN NEW.slug<>OLD.slug AND EXISTS(SELECT 1 FROM blog_posts p WHERE p.column_id=OLD.id
 AND (p.was_public=1 OR (p.status='published' AND p.publish_at IS NOT NULL AND p.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))))
BEGIN SELECT RAISE(ABORT,'blog_permalink_locked'); END;

CREATE TRIGGER blog_translation_column_insert BEFORE INSERT ON blog_posts
WHEN NEW.translation_group_id IS NOT NULL AND EXISTS(SELECT 1 FROM blog_posts q WHERE q.translation_group_id=NEW.translation_group_id AND q.column_id<>NEW.column_id)
BEGIN SELECT RAISE(ABORT,'blog_translation_column_mismatch'); END;
CREATE TRIGGER blog_translation_column_update BEFORE UPDATE OF column_id,translation_group_id ON blog_posts
WHEN NEW.translation_group_id IS NOT NULL AND EXISTS(SELECT 1 FROM blog_posts q WHERE q.translation_group_id=NEW.translation_group_id AND q.id<>OLD.id AND q.column_id<>NEW.column_id)
BEGIN SELECT RAISE(ABORT,'blog_translation_column_mismatch'); END;

CREATE TRIGGER blog_translation_source_locale_sync AFTER UPDATE OF locale ON blog_posts
WHEN OLD.locale<>NEW.locale AND OLD.translation_group_id IS NOT NULL AND OLD.translation_group_id=NEW.translation_group_id

BEGIN UPDATE blog_translation_groups SET source_locale=CASE WHEN source_locale=OLD.locale THEN NEW.locale ELSE source_locale END,version=version+1 WHERE id=NEW.translation_group_id; END;

CREATE TRIGGER blog_public_history_monotonic BEFORE UPDATE OF was_public ON blog_posts
WHEN OLD.was_public=1 AND NEW.was_public=0
BEGIN SELECT RAISE(ABORT,'blog_public_history_locked'); END;
CREATE TRIGGER blog_public_history_insert AFTER INSERT ON blog_posts
WHEN NEW.was_public=0 AND NEW.status='published' AND NEW.publish_at IS NOT NULL AND NEW.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
BEGIN UPDATE blog_posts SET was_public=1 WHERE id=NEW.id; END;
CREATE TRIGGER blog_public_history_update AFTER UPDATE OF status,publish_at ON blog_posts
WHEN NEW.was_public=0 AND (
 (NEW.status='published' AND NEW.publish_at IS NOT NULL AND NEW.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
 OR (OLD.status='published' AND OLD.publish_at IS NOT NULL AND OLD.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))
BEGIN UPDATE blog_posts SET was_public=1 WHERE id=NEW.id; END;

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
INSERT INTO blog_translation_groups(id,source_locale,version,created_at) SELECT id,locale,1,created_at FROM blog_posts;
UPDATE blog_posts SET translation_group_id=id WHERE translation_group_id IS NULL;
