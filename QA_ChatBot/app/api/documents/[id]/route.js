import { fail, handler, isId, json } from "@/lib/server/http";
import { deleteDocument, getDocument, getChunksForDocuments } from "@/lib/server/repo";

export const runtime = "nodejs";

export const GET = handler(async (_req, { params }) => {
  const { id } = await params;
  const document = isId(id) && getDocument(id);
  if (!document) return fail("Document not found.", 404);
  const chunks = getChunksForDocuments([id]).map((c) => ({ location: c.location, content: c.content }));
  return json({ document, chunks });
});

export const DELETE = handler(async (_req, { params }) => {
  const { id } = await params;
  if (!isId(id) || !deleteDocument(id)) return fail("Document not found.", 404);
  return json({ ok: true });
});
