# QA ChatBot

An AI assistant for Software Quality Assurance. Ask testing and QA questions in English or Roman Urdu (answers are in English), and attach your requirements, automation code, API specs or test reports for answers based on them.

## Quick start

Requires Node.js 22.5 or newer.

```bash
npm install
cp .env.example .env.local      # then add your API key
npm run dev                     # open http://localhost:3000
```

## AI provider

Pick one provider in `.env.local`:

| Provider | Settings |
|---|---|
| Groq | `QA_BRAIN_PROVIDER=groq` and `GROQ_API_KEY=...` |
| Gemini | `QA_BRAIN_PROVIDER=gemini` and `GEMINI_API_KEY=...` |
| Anthropic | `QA_BRAIN_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=...` |

Restart the server after changing `.env.local`. If no key is set, the chat shows "Setup needed". Optional settings are listed in `.env.example`.

## Features

- **Chat** - streaming answers with follow-ups, chat history (rename, search, delete), regenerate, copy, print or save as PDF.
- **QA only** - questions outside software testing get a short, polite refusal.
- **Attachments** - PDF, Word, Excel, CSV, text, JSON, YAML, XML, HTML, code files, a ZIP of a test framework, and screenshots. Files stay available for the rest of the chat.
- **Citations** - answers point to the exact file and page, section or line, and you can view the quoted passage.
- **Test reports** - Playwright, Cucumber, JUnit, JMeter and k6 results are summarised into pass/fail/flaky counts, repeated errors and response-time percentiles.
- **Test cases** - generated as an editable table that you can update row by row and export to Excel or CSV.

Chats and uploaded files are stored locally in `./data`.

## Tests

```bash
npx playwright install chromium   # first time only
npm run test:e2e
```

Stop `npm run dev` before running the tests.

## Limitations

- Single local user, no login.
- Search inside attachments matches keywords, so it works best with exact terms such as requirement IDs and function names.
- Scanned PDFs are not read; attach screenshots of the pages instead.
- Groq's free tier has a low rate limit, so large files are trimmed and quick follow-ups may be rate limited.
