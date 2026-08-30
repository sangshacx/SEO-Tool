ALTER TABLE backlink_opportunities ADD COLUMN quality_score INTEGER CHECK (
  quality_score IS NULL OR quality_score BETWEEN 0 AND 100
);
ALTER TABLE backlink_opportunities ADD COLUMN relevance_score INTEGER CHECK (
  relevance_score IS NULL OR relevance_score BETWEEN 0 AND 100
);
ALTER TABLE backlink_opportunities ADD COLUMN outreach_recommendation TEXT CHECK (
  outreach_recommendation IS NULL
  OR outreach_recommendation IN ('research_first', 'possible', 'low_value', 'skip')
);
ALTER TABLE backlink_opportunities ADD COLUMN outreach_confidence INTEGER CHECK (
  outreach_confidence IS NULL OR outreach_confidence BETWEEN 0 AND 100
);
ALTER TABLE backlink_opportunities ADD COLUMN outreach_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE backlink_opportunities ADD COLUMN outreach_risk_types_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE backlink_opportunities ADD COLUMN relevance_checked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_backlink_opportunities_owner_recommendation
  ON backlink_opportunities(own_domain, outreach_recommendation, updated_at DESC);
