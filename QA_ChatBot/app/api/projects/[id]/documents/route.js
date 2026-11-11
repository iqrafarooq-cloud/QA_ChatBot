import { fail, handler, isId, json, rateLimit } from "@/lib/server/http";
import { getProject } from "@/lib/server/repo";
import { config } from "@/lib/server/config";
import { ingestFile, UploadError } from "@/lib/rag/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req, { params }) => {
  const { id } = await params;
  if (!isId(id) || !getProject(id)) return fail("Project not found.", 404);
  const limited = rateLimit(req, "upload", { limit: config.uploadRatePerMinute, windowMs: 60_000 });
  if (limited) return limited;

  let form;
  try {
    form = await req.formData();
  } catch {
    return fail("Expected multipart/form-data with a 'file' field.");
  }
  const file = form.get("file");
  try {
    const document = await ingestFile({ projectId: id, file });
    return json({ document }, document.status === "ready" ? 201 : 422);
  } catch (err) {
    if (err instanceof UploadError) return fail(err.message, err.status);
    throw err;
  }
});
