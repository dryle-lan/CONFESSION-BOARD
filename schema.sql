-- =============================================
-- CONFESSIONAL — D1 Schema
-- =============================================

CREATE TABLE IF NOT EXISTS confessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  upvotes    INTEGER NOT NULL DEFAULT 0,
  downvotes  INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS votes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  confession_id INTEGER NOT NULL,
  ip_hash       TEXT    NOT NULL,
  vote_type     TEXT    NOT NULL CHECK(vote_type IN ('up', 'down')),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(confession_id, ip_hash),
  FOREIGN KEY (confession_id) REFERENCES confessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_confessions_created_at ON confessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_confessions_score      ON confessions((upvotes - downvotes) DESC);
CREATE INDEX IF NOT EXISTS idx_votes_confession_id    ON votes(confession_id);
CREATE INDEX IF NOT EXISTS idx_votes_ip_hash          ON votes(ip_hash);
