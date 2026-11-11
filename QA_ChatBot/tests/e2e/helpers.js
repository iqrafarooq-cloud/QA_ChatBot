const path = require("node:path");
const { expect } = require("@playwright/test");

const MOCK = "http://127.0.0.1:4010";
const fixture = (name) => path.join(__dirname, "..", "fixtures", name);

async function clearModelRequests(request) {
  await request.delete(`${MOCK}/__requests`);
}

async function modelRequests(request) {
  return (await request.get(`${MOCK}/__requests`)).json();
}

// The full text QA Brain sent to the model in its most recent call.
async function lastPromptText(request) {
  const reqs = await modelRequests(request);
  const body = reqs[reqs.length - 1];
  const textOf = (c) => (typeof c === "string" ? c : c.map((b) => b.text || "").join("\n"));
  return { body, text: body.messages.map((m) => textOf(m.content)).join("\n---\n") };
}

// The built-in workspace that chat uploads go to.
async function workspace(request) {
  const res = await request.get("/api/projects");
  expect(res.status()).toBe(200);
  return (await res.json()).projects.find((p) => p.is_default);
}

async function uploadToWorkspace(request, fileName) {
  const { id: projectId } = await workspace(request);
  const fs = require("node:fs");
  const res = await request.post(`/api/projects/${projectId}/documents`, {
    multipart: { file: { name: fileName, mimeType: "application/octet-stream", buffer: fs.readFileSync(fixture(fileName)) } },
  });
  return { status: res.status(), body: await res.json() };
}

// The app is the chatbot itself: it fills the page at "/".
async function openChat(page) {
  await page.goto("/");
  const chat = page.getByRole("main", { name: "QA ChatBot" });
  await expect(chat.getByLabel("Message QA ChatBot")).toBeVisible();
  return chat;
}

// The chat list is a drawer behind the menu button.
async function openChatList(chat) {
  await chat.getByLabel("Open chat list").click();
  const list = chat.getByRole("navigation", { name: "Conversations" });
  await expect(list).toBeInViewport();
  return list;
}

async function openConversation(chat, title) {
  const list = await openChatList(chat);
  await list.getByRole("button", { name: title }).first().click();
}

async function attach(dialog, ...names) {
  await dialog.getByTestId("file-input").setInputFiles(names.map(fixture));
  for (const n of names) {
    await expect(dialog.getByTestId("attachments").getByText(n)).toBeVisible();
  }
  await expect(dialog.getByTestId("attachments").getByLabel("Indexed")).toHaveCount(names.length);
}

async function send(dialog, text) {
  await dialog.getByLabel("Message QA ChatBot").fill(text);
  await dialog.getByLabel("Message QA ChatBot").press("Enter");
  // Wait for the stream to finish: the action bar appears only on completed answers.
  await expect(dialog.getByTestId("assistant-message").last().getByLabel("Copy response")).toBeVisible();
  return dialog.getByTestId("assistant-message").last();
}

module.exports = { fixture, clearModelRequests, modelRequests, lastPromptText, workspace, uploadToWorkspace, openChat, openChatList, openConversation, attach, send };
