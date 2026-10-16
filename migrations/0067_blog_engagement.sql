-- 部落格閱讀數與喜歡（HearthroomBlogEngagement_TechnicalDesign_20261016_V0.1.md §2）。
-- 計數不進修訂、不動 version／updated_at：不是內容，也不能讓編輯者撞版本衝突。
ALTER TABLE blog_posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE blog_posts ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;

-- 誰喜歡了哪一篇；主鍵擋住重複按。
CREATE TABLE blog_post_likes (
  post_id    TEXT    NOT NULL REFERENCES blog_posts(id),
  member_id  TEXT    NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, member_id)
);
CREATE INDEX idx_blog_post_likes_member ON blog_post_likes (member_id);
