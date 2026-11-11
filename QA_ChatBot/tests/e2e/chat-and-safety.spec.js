const { test, expect } = require("@playwright/test");
const { attach, clearModelRequests, lastPromptText, workspace, modelRequests, openChat, openChatList, openConversation, send } = require("./helpers");

test.beforeEach(async ({ request }) => clearModelRequests(request));

test.describe("conversations", () => {
  test("follow-up keeps context; chats can be renamed, searched and deleted", async ({ page, request }) => {
    const dialog = await openChat(page);
    await send(dialog, "What is regression testing?");
    await expect(dialog.getByTestId("chat-title")).toHaveText("What is regression testing?");
    await send(dialog, "Explain the previous answer with an example");

    // The follow-up request carried the earlier turn.
    const { body } = await lastPromptText(request);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].content).toBe("What is regression testing?");
    expect(body.messages[1].content).toContain("General QA answer to: What is regression testing?");

    // Rename
    const list = await openChatList(dialog);
    await list.getByRole("button", { name: "Rename What is regression testing?" }).click();
    await list.getByLabel("Conversation title").fill("Regression basics");
    await list.getByLabel("Conversation title").press("Enter");
    await expect(dialog.getByTestId("chat-title")).toHaveText("Regression basics");

    // Persisted after reload, reachable from the chat list
    await page.reload();
    const reopened = page.getByRole("main", { name: "QA ChatBot" });
    await openConversation(reopened, "Regression basics");
    await expect(reopened.getByTestId("user-message")).toHaveCount(2);

    // Search (matches message content too)
    await openChatList(reopened);
    await reopened.getByLabel("Search conversations").fill("previous answer");
    await expect(reopened.getByRole("navigation", { name: "Conversations" })).toContainText("Regression basics");
    await reopened.getByLabel("Search conversations").fill("zzz-no-match");
    await expect(reopened.getByRole("navigation", { name: "Conversations" })).toContainText("No matching chats");
    await reopened.getByLabel("Search conversations").fill("");

    // Delete
    const nav = reopened.getByRole("navigation", { name: "Conversations" });
    await nav.getByRole("button", { name: "Delete Regression basics" }).click();
    await nav.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(nav).not.toContainText("Regression basics");
    await expect(reopened.getByTestId("chat-title")).toHaveText("New chat");
  });

  test("regenerate replaces the last answer", async ({ page, request }) => {
    const dialog = await openChat(page);
    await send(dialog, "What is smoke testing?");
    await dialog.getByLabel("Regenerate response").click();
    await expect(dialog.getByTestId("assistant-message").last().getByLabel("Copy response")).toBeVisible();
    await expect(dialog.getByTestId("assistant-message")).toHaveCount(1);
    expect((await modelRequests(request)).length).toBe(2);
  });

  test("the chatbot is the whole app and is scoped to software QA", async ({ page, request }) => {
    const chat = await openChat(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(chat).toContainText("Your QA Learning Partner");
    await send(chat, "Give me a biryani recipe");
    const { body } = await lastPromptText(request);
    const system = body.system.map((b) => b.text).join("");
    expect(system).toContain("Scope: Software Quality Assurance only");
    expect(system).toContain("do not answer it");
    // Roman Urdu is understood, but answers are always in English.
    expect(system).toContain("ALWAYS reply in clear, simple English");
  });
});

test.describe("knowledge isolation", () => {
  test("files attached in one chat stay in that chat (including follow-ups)", async ({ page, request }) => {
    const chat = await openChat(page);
    await attach(chat, "MediCare_SRS.pdf");
    await send(chat, "Summarise the OTP requirements");
    await send(chat, "Which requirement covers the lockout?");
    expect((await lastPromptText(request)).text).toContain("REQ-AUTH-04");

    await openChatList(chat);
    await chat.getByRole("button", { name: "New chat" }).click();
    const answer = await send(chat, "When does the patient account become Active after OTP verification?");
    const { text } = await lastPromptText(request);
    expect(text).not.toContain("REQ-AUTH-01");
    expect(text).not.toContain("MediCare_SRS.pdf");
    await expect(answer.getByTestId("sources")).toHaveCount(0);
  });

  test("a plain question sends no document sources", async ({ page, request }) => {
    const dialog = await openChat(page);
    await send(dialog, "What is OTP verification testing?");
    const { text } = await lastPromptText(request);
    expect(text).not.toContain("<sources>");
  });
});

test.describe("validation and failure handling", () => {
  test("rejects unsupported, empty and oversized files in the chat", async ({ page }) => {
    const dialog = await openChat(page);
    const input = dialog.getByTestId("file-input");
    await input.setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await expect(dialog.getByTestId("attachments")).toContainText(".exe files are not supported");
    await dialog.getByLabel("Remove virus.exe").click();

    await input.setInputFiles({ name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(3 * 1024 * 1024, 97) });
    await expect(dialog.getByTestId("attachments")).toContainText("larger than the 2 MB limit");
    await dialog.getByLabel("Remove big.txt").click();

    await input.setInputFiles({ name: "empty.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) });
    await expect(dialog.getByTestId("attachments")).toContainText("The file is empty");
    await expect(dialog.getByLabel("Send message")).toBeDisabled();
  });

  test("server-side upload validation", async ({ request }) => {
    const p = await workspace(request);
    const exe = await request.post(`/api/projects/${p.id}/documents`, { multipart: { file: { name: "a.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") } } });
    expect(exe.status()).toBe(415);
    const big = await request.post(`/api/projects/${p.id}/documents`, { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.alloc(3 * 1024 * 1024, 97) } } });
    expect(big.status()).toBe(413);
    const bin = await request.post(`/api/projects/${p.id}/documents`, { multipart: { file: { name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") } } });
    expect(bin.status()).toBe(422);
    expect((await bin.json()).document).toMatchObject({ status: "failed", error: "This file is not a valid PDF or is damaged/password-protected." });
    const missing = await request.post(`/api/projects/00000000-0000-0000-0000-000000000000/documents`, { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") } } });
    expect(missing.status()).toBe(404);
  });

  test("chat API validates input", async ({ request }) => {
    expect((await request.post("/api/chat", { data: { message: "" } })).status()).toBe(400);
    expect((await request.post("/api/chat", { data: { message: "hi", conversationId: "00000000-0000-0000-0000-000000000000" } })).status()).toBe(404);
    expect((await request.post("/api/chat", { data: { message: "x".repeat(30_001) } })).status()).toBe(400);
    expect((await request.post("/api/chat", { headers: { "content-type": "application/json" }, data: "{bad json" })).status()).toBe(400);
    expect((await request.delete("/api/conversations/not-a-uuid")).status()).toBe(404);
  });

  test("AI provider failure shows a clear error and keeps the chat usable", async ({ page }) => {
    const dialog = await openChat(page);
    await dialog.getByLabel("Message QA ChatBot").fill("SIMULATE_PROVIDER_ERROR please");
    await dialog.getByLabel("Message QA ChatBot").press("Enter");
    await expect(dialog.getByRole("alert")).toContainText("The AI provider returned an error", { timeout: 30_000 });
    const answer = await send(dialog, "What is sanity testing?");
    await expect(answer).toContainText("General QA answer");
  });
});

test.describe("responsive layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("chatbot fits phone browsers and the chat list is a drawer", async ({ page }) => {
    const dialog = await openChat(page);
    const box = await dialog.boundingBox();
    expect(box.width).toBe(390 - 24); // calc(100% - 24px) on phones, centered
    expect(box.x).toBe(12);
    const list = dialog.getByRole("navigation", { name: "Conversations" });
    await expect(list).not.toBeInViewport();
    await dialog.getByLabel("Open chat list").click();
    await expect(list).toBeInViewport();
    await dialog.getByLabel("Close chat list").click();
    const answer = await send(dialog, "What is UAT?");
    await expect(answer).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

});
