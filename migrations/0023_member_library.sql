CREATE TABLE member_favorites (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(member_id, card_id)
);
CREATE INDEX member_favorites_recent ON member_favorites(member_id, created_at DESC);
CREATE INDEX member_favorites_card ON member_favorites(card_id);
CREATE TABLE member_follows (
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(member_id, author_id)
);
CREATE INDEX member_follows_recent ON member_follows(member_id, created_at DESC);
CREATE INDEX member_follows_author ON member_follows(author_id);
CREATE TABLE library_metrics (
 operation TEXT NOT NULL, outcome TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(operation, outcome)
);
