// Provider-neutral error with an HTTP status and a stable code the UI can rely on.
export class AiError extends Error {
  constructor(message, status = 502, code = "ai_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
