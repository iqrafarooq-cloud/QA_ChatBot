import { handler, json } from "@/lib/server/http";
import { ensureDefaultProject, listProjects } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The built-in workspace must exist before the chat uploads its first file.
export const GET = handler(async () => {
  ensureDefaultProject();
  return json({ projects: listProjects() });
});
