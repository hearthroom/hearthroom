-- Keep an unpublication tombstone so delayed events never restore an older release.
ALTER TABLE workshops ADD COLUMN publication_revision INTEGER NOT NULL DEFAULT 0;
