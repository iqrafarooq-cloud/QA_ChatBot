import { fail, handler, isId, json, readJson } from "@/lib/server/http";
import { getMessage, saveArtifact } from "@/lib/server/repo";
import { normalizeTestCases } from "@/lib/testcases";

export const runtime = "nodejs";

// Persists user edits to a generated test case table inside an assistant message.
export const PUT = handler(async (req, { params }) => {
  const { id } = await params;
  const msg = isId(id) && getMessage(id);
  if (!msg || msg.role !== "assistant") return fail("Message not found.", 404);
  const body = await readJson(req);
  const blockIndex = Number(body?.blockIndex);
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 50) return fail("Invalid blockIndex.");
  if (!Array.isArray(body.rows) || body.rows.length > 1000) return fail("rows must be an array (max 1000).");
  saveArtifact(id, blockIndex, "testcases", normalizeTestCases(body.rows));
  return json({ ok: true });
});
