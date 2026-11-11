import fs from "node:fs";
import { getDb, now, uid, tx } from "./db";

const parseJson = (s, fallback = null) => {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

// ---------- projects ----------

export function ensureDefaultProject() {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM projects WHERE is_default = 1").get();
  if (existing) return existing;
  const t = now();
  const p = { id: uid(), name: "General Workspace", description: "Files attached in chat without a specific project", is_default: 1, created_at: t, updated_at: t };
  db.prepare("INSERT INTO projects (id,name,description,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(p.id, p.name, p.description, 1, t, t);
  return p;
}

export function listProjects() {
  ensureDefaultProject();
  return getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS document_count
       FROM projects p ORDER BY p.is_default DESC, p.updated_at DESC`
    )
    .all();
}

export function getProject(id) {
  return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) || null;
}

// ---------- documents ----------

const mapDoc = (d) => d && { ...d, meta: parseJson(d.meta_json), meta_json: undefined, storage_path: undefined };

export function getDocumentRow(id) {
  return getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) || null;
}

export function getDocument(id) {
  return mapDoc(getDocumentRow(id));
}

export function insertDocument(doc) {
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO documents (id,project_id,file_name,file_type,kind,mime,size_bytes,storage_path,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(doc.id, doc.projectId, doc.fileName, doc.fileType, doc.kind, doc.mime || "", doc.sizeBytes, doc.storagePath, "processing", t, t);
}

export function completeDocument(id, projectId, { chunks, kind, meta, charCount }) {
  tx((db) => {
    db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(id);
    const ins = db.prepare("INSERT INTO document_chunks (id,document_id,project_id,chunk_index,location,content) VALUES (?,?,?,?,?,?)");
    chunks.forEach((c, i) => ins.run(uid(), id, projectId, i, c.location, c.content));
    db.prepare("UPDATE documents SET status='ready', error=NULL, kind=?, chunk_count=?, char_count=?, meta_json=?, updated_at=? WHERE id=?").run(
      kind,
      chunks.length,
      charCount,
      meta ? JSON.stringify(meta) : null,
      now(),
      id
    );
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
  });
}

export function failDocument(id, message) {
  getDb().prepare("UPDATE documents SET status='failed', error=?, updated_at=? WHERE id=?").run(message, now(), id);
}

export function deleteDocument(id) {
  const row = getDocumentRow(id);
  if (!row) return false;
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
  fs.rmSync(row.storage_path, { force: true });
  return true;
}

export function getChunksForDocuments(documentIds) {
  if (!documentIds.length) return [];
  const qs = documentIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT c.id, c.document_id, c.chunk_index, c.location, c.content, d.file_name
       FROM document_chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.document_id IN (${qs}) AND d.status = 'ready' ORDER BY d.created_at, c.chunk_index`
    )
    .all(...documentIds);
}

// ---------- conversations & messages ----------

export function listConversations({ q } = {}) {
  const db = getDb();
  if (q) {
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT DISTINCT c.* FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ? ORDER BY c.updated_at DESC LIMIT 100`
      )
      .all(like, like);
  }
  return db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100").all();
}

export function getConversation(id) {
  return getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) || null;
}

export function createConversation({ title, projectId }) {
  const t = now();
  const id = uid();
  getDb()
    .prepare("INSERT INTO conversations (id,title,project_id,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(id, title, projectId || null, t, t);
  return getConversation(id);
}

export function updateConversation(id, { title }) {
  const c = getConversation(id);
  if (!c) return null;
  getDb().prepare("UPDATE conversations SET title=?, updated_at=? WHERE id=?").run(title ?? c.title, now(), id);
  return getConversation(id);
}

export function deleteConversation(id) {
  return getDb().prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
}

const mapMessage = (m) =>
  m && {
    id: m.id,
    role: m.role,
    content: m.content,
    sources: parseJson(m.sources_json, []),
    attachments: parseJson(m.attachments_json, []),
    feedback: m.feedback,
    createdAt: m.created_at,
  };

export function listMessages(conversationId) {
  const db = getDb();
  const msgs = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conversationId).map(mapMessage);
  const arts = db
    .prepare("SELECT a.* FROM artifacts a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = ?")
    .all(conversationId);
  for (const a of arts) {
    const m = msgs.find((x) => x.id === a.message_id);
    if (m) (m.artifacts ||= {})[a.block_index] = parseJson(a.data_json);
  }
  return msgs;
}

export function addMessage({ conversationId, role, content, sources, attachments }) {
  const id = uid();
  const t = now();
  getDb()
    .prepare("INSERT INTO messages (id,conversation_id,role,content,sources_json,attachments_json,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, conversationId, role, content, sources?.length ? JSON.stringify(sources) : null, attachments?.length ? JSON.stringify(attachments) : null, t);
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conversationId);
  return id;
}

export function deleteMessage(id) {
  getDb().prepare("DELETE FROM messages WHERE id = ?").run(id);
}

export function getMessage(id) {
  return mapMessage(getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

export function setFeedback(messageId, value) {
  return getDb().prepare("UPDATE messages SET feedback = ? WHERE id = ? AND role = 'assistant'").run(value, messageId).changes > 0;
}

export function linkConversationDocuments(conversationId, documentIds) {
  const ins = getDb().prepare("INSERT OR IGNORE INTO conversation_documents (conversation_id, document_id) VALUES (?, ?)");
  documentIds.forEach((d) => ins.run(conversationId, d));
}

export function getConversationDocumentIds(conversationId) {
  return getDb()
    .prepare("SELECT document_id FROM conversation_documents WHERE conversation_id = ?")
    .all(conversationId)
    .map((r) => r.document_id);
}

export function saveArtifact(messageId, blockIndex, kind, data) {
  getDb()
    .prepare(
      `INSERT INTO artifacts (message_id, block_index, kind, data_json, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(message_id, block_index) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
    )
    .run(messageId, blockIndex, kind, JSON.stringify(data), now());
}
