// TEST-ONLY stand-in for the Anthropic Messages API, used by the Playwright suite via
// ANTHROPIC_BASE_URL. It records every request so tests can assert exactly what QA Brain
// sent to the model (retrieved sources, history, attachments), and replies with
// deterministic text derived from those sources. It is never used by the application.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 4010);
const requests = [];

const textOf = (content) => (typeof content === "string" ? content : content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));

function reply(body) {
  const system = textOf(body.system || []);
  const last = textOf(body.messages[body.messages.length - 1].content);
  const question = last.split("User message:\n").pop();
  const sourceIds = [...last.matchAll(/<source id="(S\d+)" file="([^"]+)" location="([^"]+)">/g)].map((m) => ({ id: m[1], file: m[2], location: m[3] }));
  const cite = (pred) => sourceIds.find(pred) || sourceIds[0];

  if (/rewrite a single software test case/i.test(system)) {
    const tc = JSON.parse(question.match(/\{[\s\S]*\}/)[0]);
    return JSON.stringify({ ...tc, title: `${tc.title} (refined)`, steps: "1. Open the page\n2. Perform the action\n3. Verify the outcome" });
  }
  if (/SIMULATE_PROVIDER_ERROR/.test(question)) return { error: 500 };

  if (/test cases/i.test(question)) {
    const reqIds = [...new Set(last.match(/REQ-[A-Z]+-\d+/g) || [])].slice(0, 4);
    const s = cite((x) => /SRS/.test(x.file));
    const cases = reqIds.map((r, i) => ({
      id: `TC-${String(i + 1).padStart(3, "0")}`,
      module: "Account Activation",
      scenario: `Verify ${r}`,
      title: `Validate behaviour defined in ${r}`,
      preconditions: "Patient account in Pending status",
      steps: "1. Request OTP\n2. Enter OTP\n3. Submit",
      testData: "OTP=123456",
      expected: "System behaves as specified",
      priority: i === 0 ? "High" : "Medium",
      type: i === 0 ? "Positive" : "Negative",
      requirementId: r,
    }));
    return `Here are test cases for the activation requirements${s ? ` [${s.id}]` : ""}.\n\n\`\`\`qa-testcases\n${JSON.stringify(cases, null, 2)}\n\`\`\`\n\nCoverage note: lockout timing needs confirmation.`;
  }
  if (/failing/i.test(question)) {
    const s = cite((x) => /LoginPage/.test(x.file));
    return `The \`login()\` method does not await the click${s ? ` [${s.id}]` : ""}.\n\n\`\`\`javascript\nawait this.submit.click();\n\`\`\``;
  }
  if (sourceIds.length) {
    const s = cite((x) => /page 2|computed summary/.test(x.location));
    return `According to your documents, here is the answer${s ? ` [${s.id}]` : ""}.`;
  }
  return `General QA answer to: ${question.slice(0, 80)}`;
}

function sse(res, text) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (let i = 0; i < text.length; i += 40) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(i, i + 40) } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
  ev("message_stop", {});
  res.end();
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/__requests") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(requests));
    }
    if (req.method === "DELETE" && req.url === "/__requests") {
      requests.length = 0;
      return res.end("ok");
    }
    if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        requests.push(body);
        const out = reply(body);
        if (out?.error) {
          res.writeHead(out.error, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock failure" } }));
        }
        if (body.stream) return sse(res, out);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", model: "mock", content: [{ type: "text", text: out }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock anthropic on ${PORT}`));
