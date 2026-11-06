CREATE TABLE IF NOT EXISTS article_drafts (
 id uuid PRIMARY KEY,
 title text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '',
 content text NOT NULL DEFAULT '',
 brief jsonb NOT NULL DEFAULT '{}'::jsonb,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS article_images (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES article_drafts(id),
 kind text NOT NULL CHECK(kind IN ('cover','inline')),
 pathname text NOT NULL UNIQUE,
 size integer NOT NULL,
 prompt text NOT NULL,
 alt text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS article_revisions (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES article_drafts(id),
 version integer NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(draft_id,version)
);
CREATE TABLE IF NOT EXISTS writer_jobs (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES article_drafts(id),
 actor text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('article','cover','inline')),
 status text NOT NULL CHECK(status IN ('running','done','failed')),
 result jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS article_images_draft_idx ON article_images(draft_id);
CREATE INDEX IF NOT EXISTS writer_jobs_created_idx ON writer_jobs(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS writer_one_running_job ON writer_jobs ((true)) WHERE status='running';
