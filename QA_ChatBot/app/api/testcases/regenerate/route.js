import { fail, handler, json, rateLimit, readJson } from "@/lib/server/http";
import { complete, toAiError } from "@/lib/ai/provider";
import { REGENERATE_CASE_PROMPT } from "@/lib/ai/prompts";
import { normalizeTestCases } from "@/lib/testcases";

export const runtime = "nodejs";

export const POST = handler(async (req) => {
  const limited = rateLimit(req, "regen", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const body = await readJson(req);
  const [testCase] = normalizeTestCases([body?.testCase]);
  if (!testCase) return fail("testCase is required.");
  const instruction = typeof body.instruction === "string" ? body.instruction.slice(0, 1000) : "";
  try {
    const text = await complete({
      system: REGENERATE_CASE_PROMPT,
      messages: [{ role: "user", content: `Test case:\n${JSON.stringify(testCase, null, 2)}\n\nInstruction: ${instruction || "Improve this test case."}` }],
    });
    const match = text.match(/\{[\s\S]*\}/);
    const [result] = normalizeTestCases([match ? JSON.parse(match[0]) : null]);
    if (!result) return fail("The model returned an invalid test case. Please try again.", 502);
    return json({ testCase: { ...result, id: testCase.id, requirementId: testCase.requirementId } });
  } catch (err) {
    if (err instanceof SyntaxError) return fail("The model returned invalid JSON. Please try again.", 502);
    const e = toAiError(err);
    return fail(e.message, e.status, { code: e.code });
  }
});
