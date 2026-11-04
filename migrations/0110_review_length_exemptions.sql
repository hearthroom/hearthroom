-- A public card number exists before the first publication/submission.
-- Keep the exception attached to that identity across immutable versions.
CREATE TABLE review_length_exemptions (
 card_number INTEGER PRIMARY KEY REFERENCES card_numbers(num),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision > 0),
 actor_member_id TEXT NOT NULL REFERENCES members(id),
 reason TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
