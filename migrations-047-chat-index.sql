-- Lets the chat's "which messages were deleted?" check find them directly instead of re-reading the open chat window on every poll.
CREATE INDEX IF NOT EXISTS idx_chat_deleted ON chat_messages (channel, id) WHERE deleted = 1;
