import fs from "node:fs";
import { getChunksForDocuments, getDocumentRow } from "../server/repo";
import { buildIndex, search } from "../rag/retrieval";
import { config } from "../server/config";

const HISTORY_MESSAGES = 24;

const escapeAttr = (s) => String(s).replace(/"/g, "'");

// Collects the passages for this turn from the files attached to this conversation:
// included in full when they fit the budget, otherwise the most relevant passages.
export function gatherSources({ question, previousQuestion, conversationDocIds }) {
  const query = `${question}\n${previousQuestion || ""}`;
  const picked = [];
  const seen = new Set();
  let used = 0;
  // Adds a passage while it fits the provider's context budget.
  const add = (c) => {
    if (seen.has(c.id) || used + c.content.length > config.contextChars) return;
    seen.add(c.id);
    used += c.content.length;
    picked.push(c);
  };

  if (conversationDocIds.length) {
    const chunks = getChunksForDocuments(conversationDocIds);
    const total = chunks.reduce((a, c) => a + c.content.length, 0);
    if (total <= config.contextChars) chunks.forEach(add);
    else {
      // Always keep computed report summaries, then the most relevant passages.
      chunks.filter((c) => c.location.startsWith("computed summary")).forEach(add);
      search(buildIndex(chunks), query, { limit: 14, minScore: 0.5 }).forEach((r) => add(r.chunk));
    }
  }

  return picked.map((c, i) => ({
    id: `S${i + 1}`,
    documentId: c.document_id,
    fileName: c.file_name,
    location: c.location,
    snippet: c.content.slice(0, 280),
    content: c.content,
  }));
}

export function buildUserContent({ question, sources, imageDocIds }) {
  const blocks = [];
  for (const id of imageDocIds) {
    const row = getDocumentRow(id);
    if (!row || row.status !== "ready") continue;
    const meta = row.meta_json ? JSON.parse(row.meta_json) : {};
    blocks.push({ type: "text", text: `Screenshot attached: ${row.file_name}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: meta.mime || "image/png", data: fs.readFileSync(row.storage_path).toString("base64") } });
  }

  const parts = [];
  if (sources.length) {
    parts.push(
      "<sources>\n" +
        sources.map((s) => `<source id="${s.id}" file="${escapeAttr(s.fileName)}" location="${escapeAttr(s.location)}">\n${s.content}\n</source>`).join("\n") +
        "\n</sources>"
    );
  }
  parts.push(`User message:\n${question}`);
  blocks.push({ type: "text", text: parts.join("\n\n") });
  return blocks;
}

// Most recent messages that fit the history budget (always at least the latest one).
export function buildHistory(messages) {
  const recent = messages.slice(-HISTORY_MESSAGES);
  let start = recent.length;
  for (let used = 0; start > 0; start--) {
    used += (recent[start - 1].content || "").length;
    if (used > config.historyChars && start < recent.length) break;
  }
  // The conversation must start with a user turn.
  while (start < recent.length - 1 && recent[start].role !== "user") start++;
  return recent.slice(start).map((m) => ({
    role: m.role,
    content:
      m.role === "user" && m.attachments?.length
        ? `${m.content}\n\n[Files attached to this message: ${m.attachments.map((a) => a.fileName).join(", ")}]`
        : m.content || "(empty)",
  }));
}
