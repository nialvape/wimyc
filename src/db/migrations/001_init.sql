-- Teléfonos que ya mandaron la contraseña. Una vez acá, no se les pide más.
CREATE TABLE IF NOT EXISTS authorized_phones (
  wa_phone      TEXT PRIMARY KEY,
  display_name  TEXT,
  authorized_at TEXT NOT NULL
);

-- El auto es compartido: hay UN solo estacionamiento 'active' y UN solo
-- 'pending' en toda la base, no uno por usuario.
CREATE TABLE IF NOT EXISTS parkings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'active', 'archived', 'discarded')),
  description      TEXT,
  level            TEXT,
  spot             TEXT,
  lat              REAL,
  lng              REAL,
  source           TEXT NOT NULL CHECK (source IN ('text', 'audio', 'location')),
  transcript       TEXT,
  created_by_phone TEXT NOT NULL,
  created_by_name  TEXT,
  wa_message_id    TEXT,
  created_at       TEXT NOT NULL,
  confirmed_at     TEXT,
  archived_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_parkings_status ON parkings (status, created_at DESC);

-- Idempotencia: Kapso reintenta si no contestamos 200 a tiempo.
CREATE TABLE IF NOT EXISTS processed_events (
  key          TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_events_at ON processed_events (processed_at);
