// Lexical BM25 retrieval over a project's chunks. Indexes are built lazily per project
// and invalidated whenever a document in that project changes.

const STOP = new Set(
  "a an and are as at be by for from has have how i in is it its of on or that the this to was were what when where which who why will with you your me my we our can do does should would could please kya hai ka ki ke ko mein me se aur ye yeh".split(" ")
);

export function tokenize(text) {
  const out = [];
  const words = text.match(/[A-Za-z][A-Za-z0-9_]*|[0-9]+/g) || [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (!STOP.has(lower) && lower.length > 1) out.push(lower);
    // Split camelCase / snake_case identifiers so code symbols match natural language.
    const parts = w.split(/_|(?<=[a-z0-9])(?=[A-Z])/).filter((p) => p.length > 1);
    if (parts.length > 1) parts.forEach((p) => !STOP.has(p.toLowerCase()) && out.push(p.toLowerCase()));
  }
  return out;
}

export function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const terms = tokenize(`${c.file_name} ${c.location} ${c.content}`);
    const tf = new Map();
    terms.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { chunk: c, tf, len: terms.length };
  });
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / (docs.length || 1);
  return { docs, df, avgLen, N: docs.length };
}

export function search(index, query, { limit = 8, minScore = 1.5 } = {}) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !index.N) return [];
  const k1 = 1.4;
  const b = 0.75;
  return index.docs
    .map((d) => {
      let s = 0;
      let matched = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        matched++;
        const df = index.df.get(t);
        const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
        s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgLen));
      }
      // Reward chunks that cover more of the query's distinct terms.
      return { chunk: d.chunk, score: s * (0.5 + matched / q.length / 2) };
    })
    .filter((x) => x.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
