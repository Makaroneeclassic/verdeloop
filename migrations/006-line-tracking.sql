CREATE TABLE IF NOT EXISTS line_login_sessions (
 id uuid PRIMARY KEY,
 state_hash text UNIQUE NOT NULL,
 encrypted text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 user_hash text,
 friend boolean,
 analytics_consent boolean NOT NULL DEFAULT false,
 ads_consent boolean NOT NULL DEFAULT false,
 attribution jsonb NOT NULL DEFAULT '{}',
 path text NOT NULL DEFAULT '/',
 placement text NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS line_login_user_idx ON line_login_sessions(user_hash, created_at);
CREATE TABLE IF NOT EXISTS line_follow_events (
 event_id text PRIMARY KEY,
 user_hash text NOT NULL,
 occurred_at timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('new_friend','unblocked','unknown','unfollow'))
);
CREATE INDEX IF NOT EXISTS line_follow_user_idx ON line_follow_events(user_hash, occurred_at);
CREATE TABLE IF NOT EXISTS line_friend_conversions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 session_id uuid NOT NULL UNIQUE REFERENCES line_login_sessions(id),
 user_hash text NOT NULL UNIQUE,
 event_id text NOT NULL UNIQUE REFERENCES line_follow_events(event_id),
 occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contact_events ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT '';
