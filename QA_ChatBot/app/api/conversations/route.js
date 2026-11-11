import { handler, json } from "@/lib/server/http";
import { listConversations } from "@/lib/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) || undefined;
  return json({ conversations: listConversations({ q }) });
});
