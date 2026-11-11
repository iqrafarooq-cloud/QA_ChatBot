// Gemini / Groq provider via their OpenAI-compatible Chat Completions APIs.
// Messages arrive in the internal format (Anthropic-style content blocks) and are converted here.
import { apiKey, config } from "../server/config";
import { AiError } from "./errors";

const MAX_AUTO_RETRY_WAIT_S = 20;
// An overloaded model can accept a request and then hang. If it has not started responding in time,
// the request moves on to the next model; a stream that goes silent is cut off.
const STREAM_START_TIMEOUT_MS = 45_000;
const COMPLETE_TIMEOUT_MS = 120_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;

const hasImages = (messages) => messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image"));

function toOpenAiContent(content, allowImages) {
  if (typeof content === "string") return content;
  if (!allowImages) return content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
  return content.map((b) =>
    b.type === "image"
      ? { type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
      : { type: "text", text: b.text }
  );
}

function buildBody({ system, messages, maxTokens, stream }) {
  const vision = hasImages(messages);
  const model = vision && config.visionModel ? config.visionModel : config.model;
  const body = {
    model,
    messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: toOpenAiContent(m.content, vision) }))],
    max_completion_tokens: Math.min(maxTokens, vision && config.visionModel ? 16_384 : config.maxOutputTokens),
    stream,
  };
  const effort = ["low", "medium", "high"].includes(config.effort) ? config.effort : ["max", "xhigh"].includes(config.effort) ? "high" : "medium";
  if (model.startsWith("openai/gpt-oss")) {
    body.reasoning_effort = effort;
    body.include_reasoning = false;
  } else if (config.provider === "gemini" && /gemini-(2\.5|[3-9])/.test(model)) {
    body.reasoning_effort = effort;
  }
  return body;
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new AiError("Request cancelled.", 499, "aborted"))), { once: true });
  });

function errorFor(status, detail, retryAfter, model = config.model) {
  const name = config.provider === "gemini" ? "Gemini" : "Groq";
  if (status === 401 || (status === 400 && /api key not valid|api_key_invalid/i.test(detail)))
    return new AiError(`The ${name} API key was rejected. Check ${config.keyName} in .env.local.`, 503, "auth");
  if (status === 403) return new AiError(`This ${name} API key does not have access to the configured model.`, 503, "permission");
  if (status === 404) return new AiError(`The ${name} model "${model}" is not available. Set QA_BRAIN_MODEL to a model your key can use.`, 503, "model_not_found");
  if (status === 413 || /request too large|reduce your message size/i.test(detail))
    return new AiError(`This request is too large for your ${name} plan's token limit. Attach fewer or smaller files, or start a new chat, then try again.`, 413, "too_large");
  if (status === 429) {
    const wait = retryAfter ? ` Please wait about ${Math.ceil(retryAfter)} seconds and try again.` : " Please wait a minute and try again.";
    return new AiError(`${name}'s rate limit or quota for your plan was reached.${wait}`, 429, "rate_limited");
  }
  if (status === 400) return new AiError(`The AI provider rejected the request: ${detail}`, 400, "bad_request");
  if (status === 503) return new AiError(`${name} is overloaded right now (high demand). Please try again in a minute.`, 503, "overloaded");
  return new AiError("The AI provider returned an error. Please try again.", 502, "provider");
}

// Models to try in order: the configured one, then fallbacks for when it is overloaded or retired.
function modelChain(primary) {
  if (primary !== config.model) return [primary]; // vision model: no fallbacks
  return [...new Set([primary, ...config.fallbackModels])];
}

// POSTs to the provider. Overloaded or unavailable models fall through to the next model in the
// chain; short rate-limit waits and other transient 5xx errors are retried on the same model.
async function post(body, signal, startTimeoutMs) {
  let models = modelChain(body.model);
  let lastError;
  // Overload spikes are short, so the chain gets a second pass after a brief pause.
  for (let pass = 0; pass < 2 && models.length; pass++) {
    if (pass) await sleep(2000, signal);
    const retry = [];
    for (const model of models) {
      try {
        return await postOnce({ ...body, model }, signal, true, startTimeoutMs);
      } catch (err) {
        if (!(err instanceof AiError) || !["overloaded", "model_not_found"].includes(err.code)) throw err;
        if (err.code === "overloaded") retry.push(model);
        lastError = err;
      }
    }
    models = retry;
  }
  throw lastError;
}

// Resolves with the Response; res.abort() cancels it (used by the stream idle watchdog).
async function postOnce(body, signal, hasFallback, startTimeoutMs) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, startTimeoutMs);
    let res;
    try {
      res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      if (signal?.aborted) throw new AiError("Request cancelled.", 499, "aborted");
      if (timedOut) throw new AiError(`The model "${body.model}" did not respond in time. It may be overloaded; please try again.`, 503, "overloaded");
      throw new AiError("Could not reach the AI provider. Check your internet connection.", 502, "connection");
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      res.abort = () => ctrl.abort();
      return res;
    }
    signal?.removeEventListener("abort", onAbort);

    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message || text;
    } catch {}
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    // With a fallback model available, an overloaded model is skipped straight away.
    const overloaded = res.status === 503 && hasFallback;
    const retriable = (res.status === 429 && !/request too large|quota/i.test(detail) && retryAfter <= MAX_AUTO_RETRY_WAIT_S) || (res.status >= 500 && !overloaded);
    if (retriable && attempt < 2) {
      await sleep((res.status === 429 ? Math.max(retryAfter, 1) : 1 + attempt) * 1000, signal);
      continue;
    }
    throw errorFor(res.status, detail, retryAfter, body.model);
  }
}

const STOP_REASONS = { stop: "end_turn", length: "max_tokens", content_filter: "refusal" };

export async function compatStream({ system, messages, onText, signal, maxTokens }) {
  const res = await post(buildBody({ system, messages, maxTokens, stream: true }), signal, STREAM_START_TIMEOUT_MS);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finish = null;
  let idle = false;
  let watchdog;
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      idle = true;
      res.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };
  try {
    for (;;) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const evt = JSON.parse(data);
        if (evt.error) throw errorFor(evt.error.status_code || 502, evt.error.message || "stream error");
        const choice = evt.choices?.[0];
        if (choice?.delta?.content) onText(choice.delta.content);
        if (choice?.finish_reason) finish = choice.finish_reason;
      }
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (signal?.aborted) throw new AiError("Request cancelled.", 499, "aborted");
    if (idle) throw new AiError("The AI provider stopped responding mid-answer. Please try again.", 504, "timeout");
    throw new AiError("The connection to the AI provider was interrupted. Please try again.", 502, "connection");
  } finally {
    clearTimeout(watchdog);
  }
  return { stopReason: STOP_REASONS[finish] || finish || "end_turn" };
}

export async function compatComplete({ system, messages, maxTokens }) {
  const res = await post(buildBody({ system, messages, maxTokens, stream: false }), undefined, COMPLETE_TIMEOUT_MS);
  const json = await res.json();
  const choice = json.choices?.[0];
  if (choice?.finish_reason === "content_filter") throw new AiError("The model declined this request.", 422, "refusal");
  return choice?.message?.content || "";
}
