-- Миграция v1 → v2
-- Запустите в Railway Query Console если БД уже существует

-- 1. Разрешаем org_id быть NULL (сотрудники без организации)
ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL;

-- 2. Добавляем личный invite_code сотрудника
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE;

-- 3. Таблица приглашений
CREATE TABLE IF NOT EXISTS invitations (
  id         SERIAL PRIMARY KEY,
  org_id     INTEGER     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
CREATE INDEX IF NOT EXISTS idx_invitations_user  ON invitations(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_org   ON invitations(org_id);
