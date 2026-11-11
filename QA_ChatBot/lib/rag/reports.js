// Structured parsers for QA artifacts. Each returns { meta, summary } where `summary` is
// human-readable text computed from the file (indexed as the first chunk) and `meta`
// holds the measured numbers used by the UI. Nothing here is inferred or estimated.

import { unzipSync, strFromU8 } from "fflate";

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const clip = (s, n = 600) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
const stripAnsi = (s) => (s || "").replace(/\u001b\[[0-9;]*m/g, "");

function buildTestSummary(format, tests, extra = {}) {
  const count = (st) => tests.filter((t) => t.status === st).length;
  const stats = {
    total: tests.length,
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    flaky: count("flaky"),
    durationMs: extra.durationMs ?? tests.reduce((a, t) => a + (t.durationMs || 0), 0),
  };
  const failures = tests.filter((t) => t.status === "failed" || t.status === "flaky");
  // Group identical first error lines to surface repeated failures.
  const groups = {};
  for (const f of failures.filter((x) => x.error)) {
    const key = stripAnsi(f.error || "No error message").split("\n")[0].slice(0, 160);
    (groups[key] ||= []).push(f.title);
  }
  const slowest = [...tests].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 5);

  const lines = [
    `EXECUTION REPORT SUMMARY (computed by QA ChatBot from the uploaded ${format} file)`,
    `Total tests: ${stats.total} | Passed: ${stats.passed} | Failed: ${stats.failed} | Skipped: ${stats.skipped} | Flaky (passed on retry): ${stats.flaky}`,
    `Total duration: ${fmtMs(stats.durationMs)}`,
    stats.total ? `Pass rate (passed / total): ${((stats.passed / stats.total) * 100).toFixed(1)}%` : "",
    "",
    failures.length ? "FAILED / FLAKY TESTS:" : "No failed tests in this report.",
    ...failures.map(
      (f, i) =>
        `${i + 1}. [${f.status.toUpperCase()}] ${f.title}${f.file ? ` (${f.file})` : ""} - ${fmtMs(f.durationMs || 0)}${
          f.error ? `\n   Error: ${clip(stripAnsi(f.error), 900).replace(/\n+/g, "\n   ")}` : f.status === "flaky" ? " (failed first, passed on retry)" : ""
        }`
    ),
    "",
    Object.keys(groups).length ? "REPEATED ERROR SIGNATURES:" : "",
    ...Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, v]) => `- (${v.length}x) ${k}`),
    "",
    "SLOWEST TESTS:",
    ...slowest.map((t) => `- ${t.title}: ${fmtMs(t.durationMs || 0)} [${t.status}]`),
  ];
  return {
    meta: {
      reportType: "test-execution",
      format,
      stats,
      failures: failures.slice(0, 50).map((f) => ({ title: f.title, file: f.file, status: f.status, error: clip(stripAnsi(f.error), 300) })),
    },
    summary: lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"),
  };
}

// ---------- Playwright JSON reporter ----------
function parsePlaywrightJson(json) {
  if (!json || !Array.isArray(json.suites) || !json.config) return null;
  const tests = [];
  const walk = (suite, prefix) => {
    const name = [prefix, suite.title].filter(Boolean).join(" › ");
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const last = results[results.length - 1] || {};
        let status = "passed";
        if (t.status === "skipped") status = "skipped";
        else if (t.status === "unexpected") status = "failed";
        else if (t.status === "flaky") status = "flaky";
        const err = results.map((r) => r.error?.message || (r.errors || []).map((e) => e.message).join("\n")).filter(Boolean)[0];
        tests.push({
          title: `${name} › ${spec.title}${t.projectName ? ` [${t.projectName}]` : ""}`,
          file: spec.file ? `${spec.file}:${spec.line}` : suite.file,
          status,
          durationMs: results.reduce((a, r) => a + (r.duration || 0), 0) || last.duration || 0,
          error: err,
        });
      }
    }
    for (const s of suite.suites || []) walk(s, name);
  };
  json.suites.forEach((s) => walk(s, ""));
  return buildTestSummary("Playwright JSON", tests, { durationMs: json.stats?.duration });
}

// ---------- Playwright HTML reporter (embedded zip) ----------
export function parsePlaywrightHtml(html) {
  const m = html.match(/playwrightReportBase64\s*=\s*"data:application\/zip;base64,([^"]+)"/);
  if (!m) return null;
  let files;
  try {
    files = unzipSync(Buffer.from(m[1], "base64"));
  } catch {
    return null;
  }
  const report = files["report.json"] ? JSON.parse(strFromU8(files["report.json"])) : null;
  if (!report) return null;
  const tests = [];
  for (const f of report.files || []) {
    const detail = files[`${f.fileId}.json`] ? JSON.parse(strFromU8(files[`${f.fileId}.json`])) : null;
    for (const t of f.tests || []) {
      const full = detail?.tests?.find((x) => x.testId === t.testId);
      const errs = (full?.results || []).flatMap((r) => (r.errors || []).map((e) => (typeof e === "string" ? e : e.message)));
      const status = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[t.outcome] || "passed";
      tests.push({
        title: `${[...(t.path || []), t.title].join(" › ")}${t.projectName ? ` [${t.projectName}]` : ""}`,
        file: t.location ? `${t.location.file}:${t.location.line}` : f.fileName,
        status,
        durationMs: t.duration || 0,
        error: errs[0],
      });
    }
  }
  return buildTestSummary("Playwright HTML", tests, { durationMs: report.duration });
}

// ---------- Cucumber JSON ----------
function parseCucumberJson(json) {
  if (!Array.isArray(json) || !json.length || !json.every((f) => f && Array.isArray(f.elements))) return null;
  const tests = [];
  for (const feature of json) {
    for (const el of feature.elements) {
      if (el.type === "background") continue;
      const steps = [...(el.before || []), ...(el.steps || []), ...(el.after || [])];
      const statuses = steps.map((s) => s.result?.status);
      let status = "passed";
      if (statuses.includes("failed")) status = "failed";
      else if (statuses.some((s) => ["skipped", "pending", "undefined"].includes(s)) && !statuses.includes("passed")) status = "skipped";
      else if (statuses.some((s) => ["pending", "undefined"].includes(s))) status = "failed";
      const failedStep = steps.find((s) => s.result?.status === "failed");
      const undefinedStep = steps.find((s) => s.result?.status === "undefined");
      tests.push({
        title: `${feature.name} › ${el.name}`,
        file: `${feature.uri}${el.line ? `:${el.line}` : ""}`,
        status,
        // Cucumber durations are nanoseconds.
        durationMs: steps.reduce((a, s) => a + (s.result?.duration || 0), 0) / 1e6,
        error: failedStep
          ? `Step "${failedStep.keyword || ""}${failedStep.name || ""}" failed: ${failedStep.result.error_message || ""}`
          : undefinedStep
            ? `Undefined step: "${undefinedStep.keyword || ""}${undefinedStep.name}" has no matching step definition`
            : undefined,
      });
    }
  }
  return buildTestSummary("Cucumber JSON", tests);
}

// ---------- JUnit XML ----------
const decodeXml = (s) => (s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, name) => decodeXml(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]);

export function parseJUnitXml(xml) {
  if (!/<testsuites?[\s>]/.test(xml)) return null;
  const tests = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const open = m[1];
    const body = m[3] || "";
    let status = "passed";
    let error;
    const fail = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
    if (fail) {
      status = "failed";
      error = [attr(fail[2], "message"), decodeXml((fail[3] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim())].filter(Boolean).join("\n");
    } else if (/<skipped\b/.test(body)) status = "skipped";
    tests.push({
      title: `${attr(open, "classname") ? attr(open, "classname") + " › " : ""}${attr(open, "name")}`,
      file: attr(open, "file") || undefined,
      status,
      durationMs: Number(attr(open, "time") || 0) * 1000,
      error,
    });
  }
  if (!tests.length) return null;
  return buildTestSummary("JUnit XML", tests);
}

// ---------- Performance: JMeter CSV (JTL) ----------
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

export function parseJMeterRows(rows) {
  if (!rows.length || !("elapsed" in rows[0]) || !("label" in rows[0]) || !("success" in rows[0])) return null;
  const by = {};
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const r of rows) {
    const label = String(r.label);
    (by[label] ||= []).push(r);
    const ts = Number(r.timeStamp);
    if (Number.isFinite(ts)) {
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts + Number(r.elapsed || 0));
    }
  }
  const windowSec = Number.isFinite(minTs) && maxTs > minTs ? (maxTs - minTs) / 1000 : null;
  const summarize = (label, list) => {
    const el = list.map((r) => Number(r.elapsed)).filter(Number.isFinite).sort((a, b) => a - b);
    const errors = list.filter((r) => String(r.success).toLowerCase() !== "true");
    const codes = {};
    errors.forEach((r) => (codes[`${r.responseCode} ${r.responseMessage || ""}`.trim()] = (codes[`${r.responseCode} ${r.responseMessage || ""}`.trim()] || 0) + 1));
    return {
      label,
      samples: list.length,
      avg: el.length ? Math.round(el.reduce((a, b) => a + b, 0) / el.length) : 0,
      median: pct(el, 50),
      p90: pct(el, 90),
      p95: pct(el, 95),
      p99: pct(el, 99),
      min: el[0] ?? 0,
      max: el[el.length - 1] ?? 0,
      errorPct: list.length ? +((errors.length / list.length) * 100).toFixed(2) : 0,
      throughput: windowSec ? +(list.length / windowSec).toFixed(2) : null,
      errorCodes: codes,
    };
  };
  const perLabel = Object.entries(by).map(([l, list]) => summarize(l, list));
  const overall = summarize("TOTAL", rows);
  const row = (s) =>
    `${s.label}: samples=${s.samples}, avg=${s.avg}ms, median=${s.median}ms, p90=${s.p90}ms, p95=${s.p95}ms, p99=${s.p99}ms, min=${s.min}ms, max=${s.max}ms, error=${s.errorPct}%${s.throughput != null ? `, throughput=${s.throughput}/s` : ""}${Object.keys(s.errorCodes).length ? `, errors by code: ${JSON.stringify(s.errorCodes)}` : ""}`;
  return {
    meta: { reportType: "performance", format: "JMeter CSV", overall, perLabel: perLabel.slice(0, 50), windowSec },
    summary: [
      "PERFORMANCE REPORT SUMMARY (computed by QA ChatBot from the uploaded JMeter results file; response times in milliseconds)",
      windowSec ? `Test window: ${windowSec.toFixed(1)}s` : "Test window: timestamps not available, throughput not computed",
      row(overall),
      "",
      "PER REQUEST LABEL:",
      ...perLabel.map(row),
    ].join("\n"),
  };
}

// ---------- Performance: k6 summary JSON ----------
function parseK6Json(json) {
  const m = json?.metrics;
  if (!m || !(m.http_req_duration || m.iterations)) return null;
  const val = (metric) => metric?.values || metric || {};
  const d = val(m.http_req_duration);
  const reqs = val(m.http_reqs);
  const failed = val(m.http_req_failed);
  const lines = ["PERFORMANCE REPORT SUMMARY (computed by QA ChatBot from the uploaded k6 summary; durations in milliseconds)"];
  const add = (k, v) => v !== undefined && v !== null && lines.push(`${k}: ${typeof v === "number" ? +v.toFixed(2) : v}`);
  add("http_req_duration avg", d.avg);
  add("http_req_duration median", d.med);
  add("http_req_duration p90", d["p(90)"]);
  add("http_req_duration p95", d["p(95)"]);
  add("http_req_duration p99", d["p(99)"]);
  add("http_req_duration min", d.min);
  add("http_req_duration max", d.max);
  add("http_reqs total", reqs.count);
  add("http_reqs rate (/s)", reqs.rate);
  const failRate = failed.rate ?? failed.value;
  if (failRate !== undefined) add("http_req_failed rate (%)", failRate * 100);
  add("max VUs", val(m.vus_max).max ?? val(m.vus_max).value);
  add("iterations", val(m.iterations).count);
  const thresholds = [];
  for (const [name, metric] of Object.entries(m)) {
    for (const [th, res] of Object.entries(metric.thresholds || {})) thresholds.push(`${name} ${th}: ${res.ok === false || res === false ? "FAILED" : "passed"}`);
  }
  if (thresholds.length) lines.push("", "THRESHOLDS:", ...thresholds);
  lines.push("", "ALL METRICS (raw):", ...Object.entries(m).map(([k, v]) => `${k}: ${JSON.stringify(val(v))}`));
  return {
    meta: {
      reportType: "performance",
      format: "k6 summary",
      overall: { avg: d.avg, median: d.med, p90: d["p(90)"], p95: d["p(95)"], p99: d["p(99)"], min: d.min, max: d.max, samples: reqs.count, throughput: reqs.rate, errorPct: failRate !== undefined ? failRate * 100 : undefined },
    },
    summary: lines.join("\n"),
  };
}

// ---------- API specs ----------
function parseOpenApi(json) {
  if (!json || !(json.openapi || json.swagger) || !json.paths) return null;
  const lines = [`API SPECIFICATION: ${json.info?.title || "Untitled"} ${json.info?.version || ""} (${json.openapi ? "OpenAPI " + json.openapi : "Swagger " + json.swagger})`];
  const servers = (json.servers || []).map((s) => s.url);
  if (servers.length) lines.push(`Servers: ${servers.join(", ")}`);
  if (json.components?.securitySchemes || json.securityDefinitions) lines.push(`Security schemes: ${JSON.stringify(json.components?.securitySchemes || json.securityDefinitions)}`);
  let count = 0;
  for (const [p, ops] of Object.entries(json.paths)) {
    for (const [method, op] of Object.entries(ops || {})) {
      if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) continue;
      count++;
      const params = (op.parameters || []).map((x) => `${x.name} (${x.in}${x.required ? ", required" : ""})`).join(", ");
      const responses = Object.keys(op.responses || {}).join(", ");
      lines.push(
        `${method.toUpperCase()} ${p}${op.summary ? ` - ${op.summary}` : ""}${params ? ` | params: ${params}` : ""}${op.requestBody ? " | has request body" : ""}${responses ? ` | responses: ${responses}` : ""}${op.security ? ` | security: ${JSON.stringify(op.security)}` : ""}`
      );
    }
  }
  lines.splice(1, 0, `Endpoint count: ${count}`);
  return { meta: { reportType: "api-spec", format: "OpenAPI", endpoints: count }, summary: lines.join("\n") };
}

function parsePostman(json) {
  if (!json?.info?.schema?.includes("postman") || !Array.isArray(json.item)) return null;
  const lines = [`POSTMAN COLLECTION: ${json.info.name}`];
  let count = 0;
  const walk = (items, prefix) => {
    for (const it of items) {
      if (it.item) walk(it.item, [prefix, it.name].filter(Boolean).join(" / "));
      else if (it.request) {
        count++;
        const url = typeof it.request.url === "string" ? it.request.url : it.request.url?.raw;
        const tests = (it.event || []).filter((e) => e.listen === "test").length;
        lines.push(`${[prefix, it.name].filter(Boolean).join(" / ")}: ${it.request.method} ${url}${tests ? " (has test scripts)" : " (no test scripts)"}`);
      }
    }
  };
  walk(json.item, "");
  lines.splice(1, 0, `Request count: ${count}`);
  return { meta: { reportType: "api-spec", format: "Postman", endpoints: count }, summary: lines.join("\n") };
}

export function analyzeJson(json) {
  return parsePlaywrightJson(json) || parseCucumberJson(json) || parseK6Json(json) || parseOpenApi(json) || parsePostman(json);
}
