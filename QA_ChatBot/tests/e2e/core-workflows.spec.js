// The four workflows that prove the heart of QA Brain works end to end:
// real upload -> real parsing/indexing -> real retrieval -> prompt to the model -> streamed,
// cited answer -> artifacts/exports. The model itself is a local mock (see tests/mock-anthropic.mjs),
// so each test also asserts what QA Brain actually sent to it.
const fs = require("node:fs");
const XLSX = require("xlsx");
const { test, expect } = require("@playwright/test");
const { attach, clearModelRequests, lastPromptText, openChat, openConversation, send, uploadToWorkspace } = require("./helpers");

test.beforeEach(async ({ request }) => clearModelRequests(request));

test("1. upload PDF -> ask a question -> answer cites the exact page", async ({ page, request }) => {
  const dialog = await openChat(page);
  await attach(dialog, "MediCare_SRS.pdf");
  const answer = await send(dialog, "When does a patient account become Active?");

  // Retrieval sent the right passage to the model, tagged with its location.
  const { text, body } = await lastPromptText(request);
  expect(text).toContain('file="MediCare_SRS.pdf" location="page 2"');
  expect(text).toContain("REQ-AUTH-01: Patient accounts become Active after successful OTP verification.");
  expect(body.model).toBe("claude-opus-5-5");

  // The answer shows a citation chip and a source list pointing to the real file and page.
  const pageTwo = text.match(/<source id="(S\d+)" file="MediCare_SRS.pdf" location="page 2">/)[1];
  await expect(answer.getByRole("button", { name: pageTwo, exact: true })).toBeVisible();
  const sources = answer.getByTestId("sources");
  await expect(sources).toContainText("MediCare_SRS.pdf");
  await expect(sources).toContainText("page 2");
  await sources.getByRole("button", { name: new RegExp(pageTwo) }).click();
  await expect(sources).toContainText("REQ-AUTH-01");
});

test("2. upload requirement -> generate test cases -> edit -> export Excel and CSV", async ({ page, request }) => {
  const dialog = await openChat(page);
  await attach(dialog, "MediCare_SRS.pdf");
  const answer = await send(dialog, "Generate test cases for the account activation requirements");

  // The full requirement document was given to the model.
  const { text } = await lastPromptText(request);
  expect(text).toContain("REQ-AUTH-04: After 3 consecutive invalid OTP attempts the account is locked for 15 minutes.");

  const table = answer.getByTestId("testcase-table");
  await expect(table).toContainText("4 test cases");
  await expect(table.getByLabel("Requirement ID for TC-001")).toHaveValue(/REQ-/);

  // Edit a cell, add a row, regenerate one case with AI.
  await table.getByLabel("Expected Result for TC-001").fill("Account status changes to Active and login succeeds");
  await table.getByRole("button", { name: "Add row" }).click();
  await expect(table).toContainText("5 test cases");
  await table.getByLabel("Test Case Title for TC-005").fill("Resend OTP invalidates previous OTP");
  await table.getByRole("button", { name: "Regenerate TC-002" }).click();
  await expect(table.getByLabel("Test Case Title for TC-002")).toHaveValue(/\(refined\)$/);

  // Excel export contains the real, edited data.
  const [xlsx] = await Promise.all([page.waitForEvent("download"), table.getByRole("button", { name: "Excel" }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^test-cases-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = XLSX.read(fs.readFileSync(await xlsx.path()));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Test Cases"]);
  expect(rows).toHaveLength(5);
  expect(Object.keys(rows[0])).toEqual(["Test Case ID", "Module", "Test Scenario", "Test Case Title", "Preconditions", "Test Steps", "Test Data", "Expected Result", "Priority", "Test Type", "Requirement ID"]);
  expect(rows[0]["Expected Result"]).toBe("Account status changes to Active and login succeeds");
  expect(rows[4]["Test Case Title"]).toBe("Resend OTP invalidates previous OTP");

  const [csv] = await Promise.all([page.waitForEvent("download"), table.getByRole("button", { name: "CSV" }).click()]);
  const csvText = fs.readFileSync(await csv.path(), "utf8");
  expect(csvText.split("\r\n")).toHaveLength(6);
  expect(csvText).toContain("Resend OTP invalidates previous OTP");

  // Edits are persisted: reopen the conversation after a reload.
  // Wait until the debounced save has reached the server rather than sleeping a fixed time.
  await expect
    .poll(async () => {
      const { conversations } = await (await request.get("/api/conversations")).json();
      const conv = conversations.find((c) => c.title === "Generate test cases for the account activation requirements");
      const { messages } = await (await request.get(`/api/conversations/${conv.id}`)).json();
      const rows = Object.values(messages.find((m) => m.artifacts)?.artifacts || {})[0] || [];
      return rows.length === 5 && rows[0].expected;
    })
    .toBe("Account status changes to Active and login succeeds");
  await page.reload();
  await openConversation(page.getByRole("main", { name: "QA ChatBot" }), "Generate test cases for the account activation requirements");
  const reopened = page.getByRole("main", { name: "QA ChatBot" }).getByTestId("testcase-table");
  await expect(reopened).toContainText("5 test cases");
  await expect(reopened.getByLabel("Expected Result for TC-001")).toHaveValue("Account status changes to Active and login succeeds");
});

test("3. upload Playwright code -> debugging suggestions cite the file", async ({ page, request }) => {
  const dialog = await openChat(page);
  await attach(dialog, "login.spec.js", "LoginPage.js");
  const answer = await send(dialog, "Why is my login test failing?");

  const { text } = await lastPromptText(request);
  expect(text).toContain('file="LoginPage.js" location="LoginPage.js, lines 1-21"');
  expect(text).toContain("this.submit.click();");
  expect(text).toContain("await page.waitForTimeout(5000);");

  await expect(answer.locator("pre")).toContainText("await this.submit.click();");
  await expect(answer.getByTestId("sources")).toContainText("LoginPage.js");
  await expect(answer.getByTestId("sources")).toContainText("lines 1-21");
  // Code blocks offer copy and download.
  await expect(answer.getByRole("button", { name: "Download as .js" })).toBeVisible();
});

test("4. upload execution report -> measured stats and failure analysis", async ({ page, request }) => {
  const dialog = await openChat(page);
  await attach(dialog, "playwright-report.json");
  const answer = await send(dialog, "Analyze this execution report");

  // The report card shows numbers parsed from the file, not model output.
  const card = dialog.getByTestId("report-card");
  await expect(card).toContainText("Playwright JSON");
  await expect(card).toContainText("Total 7");
  await expect(card).toContainText("Passed 2");
  await expect(card).toContainText("Failed 3");
  await expect(card).toContainText("Flaky 1");

  const { text } = await lastPromptText(request);
  expect(text).toContain("Total tests: 7 | Passed: 2 | Failed: 3 | Skipped: 1 | Flaky (passed on retry): 1");
  expect(text).toContain("(2x) Error: locator.click: Error: strict mode violation");
  await expect(answer.getByTestId("sources")).toContainText("computed summary");
});

test("performance report (JMeter CSV) is summarised with exact percentiles", async ({ page, request }) => {
  const dialog = await openChat(page);
  await attach(dialog, "jmeter-results.csv");
  await send(dialog, "Analyze the performance results");
  const card = dialog.getByTestId("report-card");
  await expect(card).toContainText("JMeter CSV");
  await expect(card).toContainText("p95");
  await expect(card).toContainText("GET /appointments");
  const { text } = await lastPromptText(request);
  expect(text).toMatch(/TOTAL: samples=200, avg=\d+ms, median=\d+ms, p90=\d+ms, p95=\d+ms/);
});

test("cucumber and JUnit reports are parsed", async ({ request }) => {
  const cuc = await uploadToWorkspace(request, "cucumber-report.json");
  expect(cuc.body.document.meta.stats).toMatchObject({ total: 2, passed: 1, failed: 1 });
  const junit = await uploadToWorkspace(request, "junit-results.xml");
  expect(junit.body.document.meta.stats).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
});
