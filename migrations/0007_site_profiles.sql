CREATE TABLE IF NOT EXISTS site_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  label TEXT NOT NULL,
  location_code INTEGER NOT NULL DEFAULT 2840,
  location_name TEXT NOT NULL DEFAULT 'United States',
  country_iso_code TEXT NOT NULL DEFAULT 'US',
  language_code TEXT NOT NULL DEFAULT 'en',
  language_name TEXT NOT NULL DEFAULT 'English',
  include_subdomains INTEGER NOT NULL DEFAULT 0 CHECK (include_subdomains IN (0,1)),
  competitors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain)
);
