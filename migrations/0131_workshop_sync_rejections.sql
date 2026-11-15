-- Isolate invalid publication receipts so later consent/takedown events still flow.
-- Retain the source event for diagnosis/replay; no private data enters metric labels.
CREATE TABLE workshop_sync_rejections (
 event_key TEXT PRIMARY KEY,
 provider TEXT NOT NULL,
 event_kind TEXT NOT NULL,
 reason TEXT NOT NULL,
 event_payload TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
