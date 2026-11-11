import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config";
import { uid } from "../server/db";
import { insertDocument, completeDocument, failDocument, getDocument } from "../server/repo";
import { logger } from "../server/logger";
import { parseFile, ParseError, extOf, ALLOWED_EXT } from "./parse";
import { chunkParsed } from "./chunk";

export class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateUpload(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new UploadError("No file was provided.");
  const name = String(file.name || "").trim();
  if (!name || name.length > 200) throw new UploadError("Invalid file name.");
  const ext = extOf(name);
  if (!ALLOWED_EXT.has(ext)) throw new UploadError(`Unsupported file type ".${ext || "?"}". Supported: ${[...ALLOWED_EXT].sort().join(", ")}.`, 415);
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > config.maxUploadBytes) {
    throw new UploadError(`File is too large (${(file.size / 1048576).toFixed(1)} MB). The limit is ${config.maxUploadBytes / 1048576} MB.`, 413);
  }
  return { name, ext };
}

// Stores the file, then parses, chunks and indexes it. Returns the final document record.
export async function ingestFile({ projectId, file }) {
  const { name, ext } = validateUpload(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const id = uid();
  const dir = path.join(config.dataDir, "uploads", projectId);
  fs.mkdirSync(dir, { recursive: true });
  const storagePath = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(storagePath, buffer);
  insertDocument({ id, projectId, fileName: name, fileType: ext, kind: "pending", mime: file.type, sizeBytes: buffer.length, storagePath });

  try {
    const parsed = await parseFile({ fileName: name, buffer });
    const chunks = chunkParsed(parsed, name);
    if (parsed.kind !== "image" && !chunks.length) throw new ParseError("No readable text was found in this file.");
    const charCount = chunks.reduce((a, c) => a + c.content.length, 0);
    completeDocument(id, projectId, { chunks, kind: parsed.kind, meta: parsed.meta || null, charCount });
  } catch (err) {
    const message = err instanceof ParseError ? err.message : "The file could not be processed.";
    if (!(err instanceof ParseError)) logger.error("ingest failed", { file: name, error: err.message });
    failDocument(id, message);
  }
  return getDocument(id);
}
