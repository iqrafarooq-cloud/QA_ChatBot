// Splits parsed units into retrieval chunks that keep an exact location
// (page, section heading, or file path with line range).

const TEXT_TARGET = 1400;
const TEXT_OVERLAP = 200;
const CODE_LINES = 70;
const CODE_OVERLAP = 10;

function chunkCode(text, path) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let start = 0; start < lines.length; start += CODE_LINES - CODE_OVERLAP) {
    const end = Math.min(lines.length, start + CODE_LINES);
    const body = lines.slice(start, end).join("\n");
    if (body.trim()) out.push({ location: `${path}, lines ${start + 1}-${end}`, content: body });
    if (end === lines.length) break;
  }
  return out;
}

const isHeading = (p, markdown) => {
  if (markdown) return p.match(/^#{1,6}\s+(.+)/)?.[1] || null;
  const words = p.split(/\s+/).length;
  return p.length < 90 && words <= 10 && !p.includes("\n") && /^([0-9]+(\.[0-9]+)*\.?\s+)?[A-Z][^.!?:]*$/.test(p) ? p : null;
};

function chunkProse(text, baseLocation, markdown) {
  // Split on blank lines and track the nearest heading for section-level citations.
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let buf = "";
  let heading = "";
  let bufHeading = "";
  const flush = (keepOverlap) => {
    if (!buf.trim()) return;
    const loc = [baseLocation, bufHeading && `section "${bufHeading}"`].filter(Boolean).join(", ");
    out.push({ location: loc || "document", content: buf.trim() });
    buf = keepOverlap && buf.length > TEXT_OVERLAP ? buf.slice(-TEXT_OVERLAP) : "";
  };
  for (const p of paras) {
    const h = isHeading(p, markdown);
    if (h) {
      flush(false);
      heading = h.trim();
    }
    if (!buf) bufHeading = heading;
    for (let i = 0; i < p.length; i += TEXT_TARGET) {
      buf += (buf ? "\n\n" : "") + p.slice(i, i + TEXT_TARGET);
      if (buf.length >= TEXT_TARGET) flush(true);
    }
  }
  // Only emit the tail if it holds more than the overlap carried from the previous chunk.
  if (buf.trim() && (out.length === 0 || !out[out.length - 1].content.endsWith(buf.trim()))) flush(false);
  return out;
}

export function chunkParsed(parsed, fileName) {
  const chunks = [];
  if (parsed.summary) chunks.push(...chunkProse(parsed.summary, "computed summary", false));
  for (const u of parsed.units) {
    if (!u.text?.trim()) continue;
    if (u.preChunked) chunks.push({ location: u.location, content: u.text });
    else if (u.code) chunks.push(...chunkCode(u.text, u.location || fileName));
    else chunks.push(...chunkProse(u.text, u.location, u.markdown));
  }
  return chunks;
}
