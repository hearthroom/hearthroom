-- Regional conversation filtering checks the exact historical revision, including
-- retired revisions. The approved-only 0115 index cannot serve this lookup.
CREATE INDEX hosting_versions_region_adult
 ON hosting_versions(provider,hosted_revision_id) WHERE rating='R';
