import { fail, handler, isId, json, readJson, str } from "@/lib/server/http";
import { deleteConversation, getConversation, listMessages, updateConversation } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const conversation = isId(id) && getConversation(id);
  if (!conversation) return fail("Conversation not found.", 404);
  return json({ conversation, messages: listMessages(id) });
});

export const PATCH = handler(async (req, { params }) => {
  const { id } = await params;
  if (!isId(id) || !getConversation(id)) return fail("Conversation not found.", 404);
  const title = str((await readJson(req))?.title, { max: 120 });
  if (!title) return fail("Title must be 1-120 characters.");
  return json({ conversation: updateConversation(id, { title }) });
});

export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  if (!isId(id) || !deleteConversation(id)) return fail("Conversation not found.", 404);
  return json({ ok: true });
});
