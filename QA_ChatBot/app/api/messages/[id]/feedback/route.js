import { fail, handler, isId, json, readJson } from "@/lib/server/http";
import { setFeedback } from "@/lib/server/repo";

export const runtime = "nodejs";

export const POST = handler(async (req, { params }) => {
  const { id } = await params;
  const value = (await readJson(req))?.value;
  if (![1, -1, null].includes(value)) return fail("value must be 1, -1 or null.");
  if (!isId(id) || !setFeedback(id, value)) return fail("Message not found.", 404);
  return json({ ok: true });
});
