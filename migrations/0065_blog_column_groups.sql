-- 部落格欄目兩級（HearthroomBlogColumnsEditor_TechnicalDesign_20261016_V0.1.md §2）。
-- parent_id 是 NULL 的是分組，其餘是欄目；文章只能掛欄目。0063、0064 給了分享活動的分支。
ALTER TABLE blog_columns ADD COLUMN parent_id TEXT REFERENCES blog_columns(id);
CREATE INDEX idx_blog_columns_parent ON blog_columns (parent_id, sort);

-- 上級一定要是分組；分組與欄目不能互換身分（互換會讓底下的欄目變成三級，或讓文章掛到分組上）
CREATE TRIGGER blog_columns_parent_insert BEFORE INSERT ON blog_columns
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM blog_columns g WHERE g.id = NEW.parent_id AND g.parent_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'blog_column_parent_invalid'); END;

CREATE TRIGGER blog_columns_parent_update BEFORE UPDATE OF parent_id ON blog_columns
WHEN (OLD.parent_id IS NULL) <> (NEW.parent_id IS NULL)
  OR (NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM blog_columns g WHERE g.id = NEW.parent_id AND g.parent_id IS NULL))
BEGIN SELECT RAISE(ABORT, 'blog_column_parent_invalid'); END;

CREATE TRIGGER blog_posts_column_insert BEFORE INSERT ON blog_posts
WHEN NOT EXISTS (SELECT 1 FROM blog_columns c WHERE c.id = NEW.column_id AND c.parent_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'blog_post_column_invalid'); END;

CREATE TRIGGER blog_posts_column_update BEFORE UPDATE OF column_id ON blog_posts
WHEN NOT EXISTS (SELECT 1 FROM blog_columns c WHERE c.id = NEW.column_id AND c.parent_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'blog_post_column_invalid'); END;
