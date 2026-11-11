// Text extraction per file type. Returns { kind, units, meta, summary } where each unit is
// { text, location, code } and `location` names the page, sheet, section or file path
// so that citations point to a real place in the source.

import { unzipSync, strFromU8 } from "fflate";
import { analyzeJson, parseJMeterRows, parseJUnitXml, parsePlaywrightHtml } from "./reports";

export const CODE_EXT = new Set(["js", "mjs", "cjs", "jsx", "ts", "tsx", "java", "py", "feature", "cs", "rb", "go", "kt", "sql", "sh", "yaml", "yml", "properties", "gradle", "env"]);
export const TEXT_EXT = new Set(["txt", "md", "log", "csv", "json", "xml", "html", "htm"]);
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
export const BINARY_DOC_EXT = new Set(["pdf", "docx", "xlsx", "xls", "zip"]);
export const ALLOWED_EXT = new Set([...CODE_EXT, ...TEXT_EXT, ...IMAGE_EXT, ...BINARY_DOC_EXT]);

export const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export const extOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

export class ParseError extends Error {}

const clean = (s) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

function looksBinary(buf) {
  const n = Math.min(buf.length, 4000);
  let zeros = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) zeros++;
  return zeros > 0;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]{2,}/g, " ");
}

async function parsePdf(buf) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const units = text.map((t, i) => ({ text: clean(t), location: `page ${i + 1}` })).filter((u) => u.text);
  if (!units.length) throw new ParseError("This PDF has no extractable text (it may be a scanned image). Upload a text-based PDF, or attach page screenshots in chat so QA Brain can read them with vision.");
  return { kind: "pdf", units, meta: { pages: text.length } };
}

async function parseDocx(buf) {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return { kind: "document", units: [{ text: clean(value), location: "" }] };
}

async function parseSheet(buf, ext) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer", dense: true });
  const units = [];
  let jmeter = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", raw: false });
    if (!rows.length) continue;
    if (!jmeter) jmeter = parseJMeterRows(rows);
    // Group rows so each chunk keeps its header context and an exact row range.
    const GROUP = 25;
    for (let i = 0; i < rows.length; i += GROUP) {
      const slice = rows.slice(i, i + GROUP);
      const text = slice
        .map((r, j) => `Row ${i + j + 2}: ` + Object.entries(r).filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v}`).join(" | "))
        .join("\n");
      units.push({ text, location: `${ext === "csv" ? "" : `sheet "${name}", `}rows ${i + 2}-${i + slice.length + 1}`, preChunked: true });
    }
  }
  if (jmeter) return { kind: "report", units, meta: jmeter.meta, summary: jmeter.summary };
  return { kind: "spreadsheet", units, meta: { sheets: wb.SheetNames } };
}

function parseTextual(name, ext, text) {
  if (ext === "json") {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: "code", units: [{ text, location: name, code: true }] };
    }
    const analyzed = analyzeJson(json);
    const units = [{ text: JSON.stringify(json, null, 2), location: name, code: true }];
    if (analyzed) return { kind: analyzed.meta.reportType === "api-spec" ? "api-spec" : "report", units, meta: analyzed.meta, summary: analyzed.summary };
    return { kind: "code", units };
  }
  if (ext === "xml") {
    const junit = parseJUnitXml(text);
    if (junit) return { kind: "report", units: [{ text, location: name, code: true }], meta: junit.meta, summary: junit.summary };
    return { kind: "code", units: [{ text, location: name, code: true }] };
  }
  if (ext === "html" || ext === "htm") {
    const pw = parsePlaywrightHtml(text);
    if (pw) return { kind: "report", units: [], meta: pw.meta, summary: pw.summary };
    return { kind: "document", units: [{ text: clean(htmlToText(text)), location: "" }] };
  }
  if ((ext === "yaml" || ext === "yml") && /^\s*(openapi|swagger)\s*:/m.test(text)) {
    return { kind: "api-spec", units: [{ text, location: name, code: true }], meta: { reportType: "api-spec", format: "OpenAPI YAML" } };
  }
  if (CODE_EXT.has(ext)) return { kind: "code", units: [{ text, location: name, code: true }] };
  return { kind: ext === "md" ? "document" : "text", units: [{ text: clean(text), location: "", markdown: ext === "md" }] };
}

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|test-results|playwright-report|allure-results|target|__pycache__|\.venv)\//;

function parseZip(buf) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(buf), {
      filter: (f) => !f.name.endsWith("/") && !SKIP_DIRS.test(f.name) && f.originalSize < 1_000_000 && ALLOWED_EXT.has(extOf(f.name)) && !IMAGE_EXT.has(extOf(f.name)) && !BINARY_DOC_EXT.has(extOf(f.name)),
    });
  } catch {
    throw new ParseError("The ZIP archive could not be read. Make sure it is a valid, unencrypted .zip file.");
  }
  const units = [];
  const summaries = [];
  const files = [];
  for (const [path, data] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    if (looksBinary(data)) continue;
    if (/package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/.test(path)) continue;
    const parsed = parseTextual(path, extOf(path), strFromU8(data));
    files.push(path);
    if (parsed.summary) summaries.push(`${path}:\n${parsed.summary}`);
    for (const u of parsed.units) units.push({ ...u, location: u.code ? path : `${path}${u.location ? ", " + u.location : ""}`, code: u.code ?? CODE_EXT.has(extOf(path)) });
  }
  if (!units.length && !summaries.length) throw new ParseError("The ZIP archive contains no supported text or code files (node_modules, build output and binaries are skipped).");
  const tree = `ARCHIVE FILE LIST (${files.length} files):\n${files.join("\n")}`;
  return { kind: "archive", units, meta: { files: files.length }, summary: [tree, ...summaries].join("\n\n") };
}

// Parser libraries throw their own errors on corrupt input; report those as user-facing ParseErrors.
async function guard(promise, message) {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof ParseError) throw err;
    throw new ParseError(message);
  }
}

export async function parseFile({ fileName, buffer }) {
  const ext = extOf(fileName);
  if (!ALLOWED_EXT.has(ext)) throw new ParseError(`Unsupported file type ".${ext || "?"}".`);
  if (!buffer.length) throw new ParseError("The file is empty.");
  if (IMAGE_EXT.has(ext)) return { kind: "image", units: [], meta: { mime: IMAGE_MIME[ext] } };
  if (ext === "pdf") return guard(parsePdf(buffer), "This file is not a valid PDF or is damaged/password-protected.");
  if (ext === "docx") return guard(parseDocx(buffer), "This file is not a valid .docx document.");
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return guard(parseSheet(buffer, ext), "This spreadsheet could not be read. Check that it is a valid, unprotected file.");
  if (ext === "zip") return parseZip(buffer);
  if (looksBinary(buffer)) throw new ParseError("The file looks binary, not text. Check the file type.");
  return parseTextual(fileName, ext, buffer.toString("utf8"));
}
