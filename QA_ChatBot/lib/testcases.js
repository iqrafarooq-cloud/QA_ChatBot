// Shared (client + server) helpers for structured test cases.

export const TC_FIELDS = [
  { key: "id", label: "Test Case ID", width: 90 },
  { key: "module", label: "Module", width: 120 },
  { key: "scenario", label: "Test Scenario", width: 170 },
  { key: "title", label: "Test Case Title", width: 210 },
  { key: "preconditions", label: "Preconditions", width: 170 },
  { key: "steps", label: "Test Steps", width: 260 },
  { key: "testData", label: "Test Data", width: 150 },
  { key: "expected", label: "Expected Result", width: 230 },
  { key: "priority", label: "Priority", width: 80 },
  { key: "type", label: "Test Type", width: 100 },
  { key: "requirementId", label: "Requirement ID", width: 110 },
];

export function normalizeTestCases(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => Object.fromEntries(TC_FIELDS.map((f) => [f.key, r[f.key] == null ? "" : String(r[f.key]).slice(0, 5000)])));
}

// Parses a (possibly still streaming) qa-testcases block. Returns null while incomplete.
export function parseTestCaseBlock(text) {
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? normalizeTestCases(data) : null;
  } catch {
    return null;
  }
}
