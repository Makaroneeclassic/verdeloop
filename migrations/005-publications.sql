CREATE TABLE IF NOT EXISTS article_publications (
 draft_id uuid PRIMARY KEY REFERENCES article_drafts(id),
 slug text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL,
 media_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 draft_version integer NOT NULL,
 published boolean NOT NULL DEFAULT true,
 published_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS article_publications_live_idx ON article_publications(published,published_at DESC);
