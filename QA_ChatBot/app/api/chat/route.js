import { fail, handler, isId, rateLimit, readJson } from "@/lib/server/http";
import { config, isAiConfigured, notConfiguredMessage } from "@/lib/server/config";
import { logger } from "@/lib/server/logger";
import {
  addMessage,
  createConversation,
  deleteMessage,
  ensureDefaultProject,
  getConversation,
  getConversationDocumentIds,
  getDocument,
  linkConversationDocuments,
  listMessages,
} from "@/lib/server/repo";
import { SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { streamReply, toAiError } from "@/lib/ai/provider";
import { buildHistory, buildUserContent, gatherSources } from "@/lib/ai/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE = 30_000;

export const POST = handler(async (req) => {
  const limited = rateLimit(req, "chat", { limit: config.chatRatePerMinute, windowMs: 60_000 });
  if (limited) return limited;

  const body = await readJson(req);
  if (!body) return fail("Invalid JSON body.");
  const regenerate = body.regenerate === true;
  const attachmentIds = Array.isArray(body.attachmentIds) ? body.attachmentIds.filter(isId).slice(0, 10) : [];

  if (!isAiConfigured()) {
    return fail(notConfiguredMessage(), 503, { code: "not_configured" });
  }


  // ----- resolve the conversation and the user turn -----
  let conversation = isId(body.conversationId) ? getConversation(body.conversationId) : null;
  if (body.conversationId && !conversation) return fail("Conversation not found.", 404);

  let question;
  let turnAttachments;
  if (regenerate) {
    if (!conversation) return fail("Nothing to regenerate.", 400);
    const msgs = listMessages(conversation.id);
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") deleteMessage(last.id);
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUser) return fail("Nothing to regenerate.", 400);
    question = lastUser.content;
    turnAttachments = lastUser.attachments || [];
  } else {
    question = typeof body.message === "string" ? body.message.trim() : "";
    if (!question && !attachmentIds.length) return fail("Message cannot be empty.");
    if (question.length > MAX_MESSAGE) return fail(`Message is too long (max ${MAX_MESSAGE} characters).`);
    const docs = attachmentIds.map(getDocument).filter(Boolean);
    if (docs.length !== attachmentIds.length) return fail("One or more attachments were not found.", 404);
    const notReady = docs.find((d) => d.status !== "ready");
    if (notReady) return fail(`"${notReady.file_name}" could not be processed: ${notReady.error || "still processing"}`, 422);
    if (!question) question = "Please analyze the attached file(s).";
    turnAttachments = docs.map((d) => ({ id: d.id, fileName: d.file_name, kind: d.kind, meta: d.meta?.stats || d.meta?.overall ? d.meta : undefined }));
    if (!conversation) {
      conversation = createConversation({ title: question.replace(/\s+/g, " ").slice(0, 70), projectId: ensureDefaultProject().id });
    }
    addMessage({ conversationId: conversation.id, role: "user", content: question, attachments: turnAttachments });
    if (docs.length) linkConversationDocuments(conversation.id, docs.map((d) => d.id));
  }

  // ----- build model input -----
  const all = listMessages(conversation.id);
  const history = buildHistory(all.slice(0, -1));
  const previousQuestion = [...all.slice(0, -1)].reverse().find((m) => m.role === "user")?.content;
  const conversationDocIds = getConversationDocumentIds(conversation.id);
  const sources = gatherSources({ question, previousQuestion, conversationDocIds });
  const imageDocIds = turnAttachments.filter((a) => a.kind === "image").map((a) => a.id);
  const userContent = buildUserContent({ question, sources, imageDocIds });
  const messages = [...history, { role: "user", content: userContent }];
  const publicSources = sources.map(({ content: _content, ...s }) => s);

  // ----- stream NDJSON events back to the client -----
  const encoder = new TextEncoder();
  const conversationId = conversation.id;
  const stream = new ReadableStream({
    async start(controller) {
      // The client may disconnect mid-stream; writing to a closed stream must not crash the turn.
      const send = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {}
      };
      send({ type: "meta", conversationId, title: getConversation(conversationId).title, sources: publicSources });
      let text = "";
      try {
        const { stopReason } = await streamReply({
          system: SYSTEM_PROMPT,
          messages,
          signal: req.signal,
          onText: (t) => {
            text += t;
            send({ type: "delta", text: t });
          },
        });
        if (stopReason === "refusal") {
          const note = "\n\n_The model declined to continue this response. Try rephrasing the request._";
          text += note;
          send({ type: "delta", text: note });
        } else if (stopReason === "max_tokens") {
          const note = "\n\n_Response reached the length limit. Ask me to continue._";
          text += note;
          send({ type: "delta", text: note });
        }
        const cited = publicSources.filter((s) => new RegExp(`\\[${s.id}\\]`).test(text));
        const messageId = addMessage({ conversationId, role: "assistant", content: text, sources: cited });
        send({ type: "done", messageId, sources: cited });
      } catch (err) {
        const e = toAiError(err);
        if (e.code !== "aborted") logger.error("chat failed", { code: e.code, error: err.message });
        if (text) {
          const messageId = addMessage({ conversationId, role: "assistant", content: `${text}\n\n_Response interrupted: ${e.message}_`, sources: [] });
          send({ type: "error", message: e.message, code: e.code, messageId });
        } else {
          send({ type: "error", message: e.message, code: e.code });
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
});
