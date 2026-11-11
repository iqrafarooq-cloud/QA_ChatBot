import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

// Ordered migrations. Each runs once; the applied version is stored in PRAGMA user_version.
const MIGRATIONS = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    meta_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_documents_project ON documents(project_id);
  CREATE TABLE document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    location TEXT NOT NULL,
    content TEXT NOT NULL
  );
  CREATE INDEX idx_chunks_document ON document_chunks(document_id);
  CREATE INDEX idx_chunks_project ON document_chunks(project_id);
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    knowledge_mode TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_conversations_updated ON conversations(updated_at);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    sources_json TEXT,
    attachments_json TEXT,
    feedback INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
  CREATE TABLE conversation_documents (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, document_id)
  );
  CREATE TABLE artifacts (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    block_index INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (message_id, block_index)
  );
  `,
];

function open() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, "qa-brain.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const current = db.prepare("PRAGMA user_version").get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

// Reuse one connection across hot reloads in development.
export function getDb() {
  if (!globalThis.__qaBrainDb) globalThis.__qaBrainDb = open();
  return globalThis.__qaBrainDb;
}

export function tx(fn) {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
