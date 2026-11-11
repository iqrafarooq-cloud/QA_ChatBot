import path from "node:path";

// Supported AI providers. Gemini and Groq are reached through their OpenAI-compatible endpoints.
const PROVIDERS = {
  gemini: {
    keyName: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    // Tried in order when the main model is overloaded (503) or retired for new keys (404).
    fallbackModels: ["gemini-3.5-flash", "gemini-3.7-flash"],
    visionModel: null, // the text model reads screenshots itself
    maxOutputTokens: 65_536,
    contextChars: 90_000,
    historyChars: 400_000,
  },
  groq: {
    keyName: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    visionModel: "qwen/qwen3.8-27b",
    maxOutputTokens: 32_768,
    // Groq's free tier allows ~8k tokens per minute, so requests are kept small.
    contextChars: 14_000,
    historyChars: 6_000,
  },
  anthropic: {
    keyName: "ANTHROPIC_API_KEY",
    model: "claude-opus-5-5",
    maxOutputTokens: 32_000,
    contextChars: 90_000,
    historyChars: 400_000,
  },
};

// Explicit QA_BRAIN_PROVIDER wins; otherwise the first provider whose key is present.
const provider = (
  process.env.QA_BRAIN_PROVIDER ||
  (process.env.GEMINI_API_KEY ? "gemini" : process.env.GROQ_API_KEY ? "groq" : "anthropic")
).toLowerCase();
const p = PROVIDERS[provider] || PROVIDERS.anthropic;

export const config = {
  provider: PROVIDERS[provider] ? provider : "anthropic",
  keyName: p.keyName,
  baseUrl: (process.env.QA_BRAIN_BASE_URL || p.baseUrl || "").replace(/\/$/, ""),
  model: process.env.QA_BRAIN_MODEL || p.model,
  visionModel: process.env.QA_BRAIN_VISION_MODEL || p.visionModel,
  fallbackModels: process.env.QA_BRAIN_FALLBACK_MODELS ? process.env.QA_BRAIN_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean) : p.fallbackModels || [],
  maxOutputTokens: p.maxOutputTokens,
  effort: process.env.QA_BRAIN_EFFORT || "medium",
  refusalFallback: (process.env.QA_BRAIN_REFUSAL_FALLBACK ?? "true") !== "false",
  // How much document text and chat history go into one request.
  contextChars: Number(process.env.QA_BRAIN_CONTEXT_CHARS || p.contextChars),
  historyChars: Number(process.env.QA_BRAIN_HISTORY_CHARS || p.historyChars),
  // Runtime data (database + uploads), never part of the build output.
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.env.QA_BRAIN_DATA_DIR || path.join(process.cwd(), "data")),
  chatRatePerMinute: Number(process.env.QA_BRAIN_CHAT_RATE_PER_MIN || 20),
  uploadRatePerMinute: Number(process.env.QA_BRAIN_UPLOAD_RATE_PER_MIN || 40),
  maxUploadBytes: Number(process.env.QA_BRAIN_MAX_UPLOAD_MB || 20) * 1024 * 1024,
};

export const apiKey = () =>
  (process.env[config.keyName] || (config.provider === "anthropic" ? process.env.ANTHROPIC_AUTH_TOKEN : "") || "").trim();

export const isAiConfigured = () => Boolean(apiKey());

export const notConfiguredMessage = () =>
  `The AI provider is not configured. Add ${config.keyName} to .env.local and restart the server.`;
