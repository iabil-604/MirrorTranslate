-- 镜译 · 音色工坊 —— D1 数据库结构
-- 执行：npx wrangler d1 execute jingyi-voice-workshop --remote --file=./schema.sql
-- 可以重复执行，已存在的表不会被动。

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,               -- Discord 用户 ID
  name        TEXT NOT NULL,                  -- Discord 显示名（global_name，没有就用 username）
  avatar      TEXT,                           -- Discord 头像 hash，可为空
  banned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- 登录凭证只存哈希：数据库泄露也拿不到能用的 token
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 一次登录的中转：插件拿 state 轮询，Discord 授权完成后 token 会短暂放在这里，被取走就删除
CREATE TABLE IF NOT EXISTS login_states (
  state       TEXT PRIMARY KEY,
  token       TEXT,
  user_json   TEXT,
  error       TEXT,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,                  -- 角色名
  src         TEXT NOT NULL DEFAULT '',       -- 出处 / 一句话介绍
  lang        TEXT NOT NULL,                  -- zh / ja / en / ko / … / other
  fish_id     TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- Fish 音色 ID，全站唯一
  fish_by     TEXT NOT NULL DEFAULT '',       -- Fish 上的原作者
  has_cover   INTEGER NOT NULL DEFAULT 0,
  copies      INTEGER NOT NULL DEFAULT 0,     -- 被多少个不同的人复制过
  status      TEXT NOT NULL DEFAULT 'ok',     -- ok / hidden
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voices_new  ON voices(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voices_hot  ON voices(status, copies DESC);
CREATE INDEX IF NOT EXISTS idx_voices_user ON voices(user_id, created_at DESC);

-- 头像图：压缩后的 webp/jpeg，base64 文本
CREATE TABLE IF NOT EXISTS covers (
  voice_id    TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL
);

-- 每人对每个音色只算一次复制
CREATE TABLE IF NOT EXISTS copies (
  voice_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (voice_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  voice_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (voice_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at);
