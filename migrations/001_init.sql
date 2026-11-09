-- Схема за spec.md, розділ 5.

CREATE TABLE users (
  id           UUID PRIMARY KEY,
  role         VARCHAR(16)  NOT NULL CHECK (role IN ('client', 'therapist')),
  name         VARCHAR(200) NOT NULL,
  contacts     TEXT         NOT NULL,
  therapist_id UUID REFERENCES users (id),
  CONSTRAINT users_role_therapist_check CHECK (
    (role = 'client'    AND therapist_id IS NOT NULL) OR
    (role = 'therapist' AND therapist_id IS NULL)
  )
);

CREATE INDEX users_therapist_id_idx ON users (therapist_id);

CREATE TABLE entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID         NOT NULL REFERENCES users (id),
  situation         TEXT         NOT NULL,
  thought           TEXT         NOT NULL,
  emotion           VARCHAR(100) NOT NULL,
  emotion_intensity INTEGER      NOT NULL CHECK (emotion_intensity BETWEEN 0 AND 100),
  rational_response TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- Списки записів клієнта від нових до старих (spec §4).
CREATE INDEX entries_client_created_idx ON entries (client_id, created_at DESC);

CREATE TABLE therapist_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id     UUID        NOT NULL REFERENCES entries (id),
  therapist_id UUID        NOT NULL REFERENCES users (id),
  text         TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX therapist_notes_entry_created_idx ON therapist_notes (entry_id, created_at DESC);
