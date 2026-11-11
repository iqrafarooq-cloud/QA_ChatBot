import Anthropic from "@anthropic-ai/sdk";
import { config, isAiConfigured, notConfiguredMessage } from "../server/config";

import { AiError } from "./errors";
import { compatComplete, compatStream } from "./openai-compat";

export { AiError };

let client;
function getClient() {
  if (!isAiConfigured()) {
    throw new AiError(notConfiguredMessage(), 503, "not_configured");
  }
  client ||= new Anthropic({ maxRetries: 2 });
  return client;
}

export function toAiError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.", 503, "auth");
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError("This API key does not have access to the configured model or feature.", 503, "permission");
  if (err instanceof Anthropic.RateLimitError) return new AiError("The AI provider is rate-limiting requests. Please wait a moment and try again.", 429, "rate_limited");
  if (err instanceof Anthropic.BadRequestError) {
    const detail = err.error?.error?.message || err.message;
    if (/credit balance/i.test(detail)) {
      return new AiError("Your Anthropic account has no API credits left. Add credits at console.anthropic.com (Settings > Billing), then try again.", 402, "no_credits");
    }
    return new AiError(`The AI provider rejected the request: ${detail}`, 400, "bad_request");
  }
  if (err instanceof Anthropic.APIConnectionError) return new AiError("Could not reach the AI provider. Check your internet connection.", 502, "connection");
  if (err instanceof Anthropic.APIUserAbortError) return new AiError("Request cancelled.", 499, "aborted");
  if (err instanceof Anthropic.APIError) return new AiError("The AI provider returned an error. Please try again.", 502, "provider");
  return new AiError("Unexpected error while generating a response.", 500, "unknown");
}

function baseParams({ system, messages, maxTokens }) {
  const params = {
    model: config.model,
    max_tokens: maxTokens,
    output_config: { effort: config.effort },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  };
  if (config.refusalFallback) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

// Streams a reply, calling onText for every text delta. Resolves with the stop reason.
export async function streamReply({ system, messages, onText, signal, maxTokens = 32000 }) {
  if (config.provider !== "anthropic") {
    if (!isAiConfigured()) throw new AiError(notConfiguredMessage(), 503, "not_configured");
    return compatStream({ system, messages, onText, signal, maxTokens });
  }
  const c = getClient();
  const params = baseParams({ system, messages, maxTokens });
  const stream = config.refusalFallback ? c.beta.messages.stream(params, { signal }) : c.messages.stream(params, { signal });
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
    }
    const final = await stream.finalMessage();
    return { stopReason: final.stop_reason };
  } catch (err) {
    throw toAiError(err);
  }
}

// Single non-streaming completion that returns the concatenated text.
export async function complete({ system, messages, maxTokens = 4000 }) {
  if (config.provider !== "anthropic") {
    if (!isAiConfigured()) throw new AiError(notConfiguredMessage(), 503, "not_configured");
    return compatComplete({ system, messages, maxTokens });
  }
  const c = getClient();
  const params = baseParams({ system, messages, maxTokens });
  try {
    const res = config.refusalFallback ? await c.beta.messages.create(params) : await c.messages.create(params);
    if (res.stop_reason === "refusal") throw new AiError("The model declined this request.", 422, "refusal");
    return res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  } catch (err) {
    throw toAiError(err);
  }
}
