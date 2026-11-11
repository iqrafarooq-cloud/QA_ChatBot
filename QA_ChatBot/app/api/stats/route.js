import { handler, json } from "@/lib/server/http";
import { config, isAiConfigured } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  return json({ ai: { configured: isAiConfigured(), model: config.model, provider: config.provider, keyName: config.keyName }, maxUploadMb: config.maxUploadBytes / 1048576 });
});
