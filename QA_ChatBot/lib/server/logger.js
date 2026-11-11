// Minimal structured logger. Never pass secrets or document contents here.
const write = (level, msg, data) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data || {}) });
  (level === "error" ? console.error : console.log)(line);
};

export const logger = {
  info: (m, d) => write("info", m, d),
  warn: (m, d) => write("warn", m, d),
  error: (m, d) => write("error", m, d),
};
