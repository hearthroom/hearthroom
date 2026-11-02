-- NULL means this member has not initialized their one-time default yet.
ALTER TABLE members ADD COLUMN country_region TEXT CHECK(country_region IS NULL OR country_region IN ('HK','MO','TW','SG','MY','CN','JP','KR','US','OTHER'));
