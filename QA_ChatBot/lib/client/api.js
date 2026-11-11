"use client";

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json", ...options.headers } : options.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, code: data.code });
  return data;
}

export const api = {
  stats: () => request("/api/stats"),
  projects: () => request("/api/projects").then((d) => d.projects),
  deleteDocument: (id) => request(`/api/documents/${id}`, { method: "DELETE" }),
  conversations: (q) => request(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((d) => d.conversations),
  conversation: (id) => request(`/api/conversations/${id}`),
  renameConversation: (id, title) => request(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteConversation: (id) => request(`/api/conversations/${id}`, { method: "DELETE" }),
  feedback: (messageId, value) => request(`/api/messages/${messageId}/feedback`, { method: "POST", body: JSON.stringify({ value }) }),
  saveArtifact: (messageId, blockIndex, rows) => request(`/api/messages/${messageId}/artifact`, { method: "PUT", body: JSON.stringify({ blockIndex, rows }) }),
  regenerateCase: (testCase, instruction) =>
    request("/api/testcases/regenerate", { method: "POST", body: JSON.stringify({ testCase, instruction }) }).then((d) => d.testCase),
};

// Uploads with progress reporting (fetch has no upload progress events).
export function uploadFile(projectId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/documents`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (data.document) resolve(data.document);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

// Sends a chat turn and calls onEvent for each NDJSON event from the server.
export async function streamChat(payload, onEvent, signal) {
  const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Chat request failed (${res.status})`), { code: data.code });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}
