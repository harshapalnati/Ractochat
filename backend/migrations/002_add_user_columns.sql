ALTER TABLE conversations ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

ALTER TABLE messages ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
