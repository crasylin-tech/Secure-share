-- SecureShare Database Schema
-- Запустите этот файл один раз для создания таблиц
-- psql -U postgres -d secureshare -f schema.sql

-- Таблица организаций
CREATE TABLE IF NOT EXISTS organizations (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(255) NOT NULL UNIQUE,
  code      VARCHAR(20)  NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица чатов
CREATE TABLE IF NOT EXISTS chats (
  id           SERIAL PRIMARY KEY,
  is_inter_org BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица участников чата
CREATE TABLE IF NOT EXISTS chat_members (
  id      SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (chat_id, user_id)
);

-- Таблица сообщений / файлов в чатах
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  file_name   VARCHAR(500) NOT NULL,
  file_size   BIGINT NOT NULL,
  file_uuid   VARCHAR(36)  NOT NULL UNIQUE,
  mime_type   VARCHAR(255),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица файлов организации (общие документы)
CREATE TABLE IF NOT EXISTS org_files (
  id          SERIAL PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  size        BIGINT NOT NULL,
  file_uuid   VARCHAR(36)  NOT NULL UNIQUE,
  mime_type   VARCHAR(255),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_users_org    ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_chat_members_chat ON chat_members(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_org_files_org ON org_files(org_id);
