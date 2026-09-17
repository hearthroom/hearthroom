-- Keep remote resource creation receipts across failed cross-provider syncs.
ALTER TABLE work_copies ADD COLUMN transfer_state TEXT NOT NULL DEFAULT '{"books":{}}';
