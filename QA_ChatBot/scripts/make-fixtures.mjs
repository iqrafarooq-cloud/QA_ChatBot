// Generates the sample QA files used by the E2E tests and for manual demos.
// Run: node scripts/make-fixtures.mjs
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const dir = path.resolve("tests/fixtures");
fs.mkdirSync(dir, { recursive: true });

// ---------- SRS PDF (3 pages) ----------
const pages = [
  [
    "MediCare Patient Portal - Software Requirements Specification",
    "Version 1.2",
    "",
    "1. Introduction",
    "This document defines the functional requirements of the MediCare patient portal.",
    "",
    "REQ-REG-01: A patient registers with full name, email, mobile number and password.",
    "REQ-REG-02: Passwords must be 8 to 64 characters and include one digit and one symbol.",
  ],
  [
    "2. Account Activation",
    "",
    "REQ-AUTH-01: Patient accounts become Active after successful OTP verification.",
    "REQ-AUTH-02: The OTP is 6 digits and expires 5 minutes after it is sent.",
    "REQ-AUTH-03: An OTP can be used only once.",
    "REQ-AUTH-04: After 3 consecutive invalid OTP attempts the account is locked for 15 minutes.",
    "REQ-AUTH-05: Until activation, the account status is Pending and login is rejected.",
  ],
  [
    "3. Appointments",
    "",
    "REQ-APT-01: Active patients can book appointments up to 30 days in advance.",
    "REQ-APT-02: A patient can hold at most 3 upcoming appointments.",
    "REQ-APT-03: Cancellation is allowed until 2 hours before the appointment time.",
  ],
];
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const lines of pages) {
  const page = pdf.addPage([612, 792]);
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 740 - i * 22, size: 11, font }));
}
fs.writeFileSync(path.join(dir, "MediCare_SRS.pdf"), await pdf.save());

// ---------- Playwright spec with real bugs ----------
fs.writeFileSync(
  path.join(dir, "login.spec.js"),
  `const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');

test.describe('Login', () => {
  test('valid user can log in', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(process.env.USER_EMAIL, process.env.USER_PASSWORD);
    await page.waitForTimeout(5000);
    expect(page.locator('.dashboard-title')).toHaveText('Welcome');
  });

  test('shows error for wrong password', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login('user@example.com', 'wrong');
    await expect(page.locator('#error-msg')).toBeVisible();
  });
});
`
);

fs.writeFileSync(
  path.join(dir, "LoginPage.js"),
  `class LoginPage {
  constructor(page) {
    this.page = page;
    this.email = page.locator('#email');
    this.password = page.locator('#password');
    this.submit = page.locator('button');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email, password) {
    await this.email.fill(email);
    await this.password.fill(password);
    this.submit.click();
  }
}

module.exports = { LoginPage };
`
);

// ---------- Playwright JSON report ----------
const spec = (title, line, status, duration, error) => ({
  title,
  ok: status !== "unexpected",
  file: "tests/login.spec.js",
  line,
  tests: [
    {
      projectName: "chromium",
      status,
      results: [{ status: status === "unexpected" ? "failed" : status === "skipped" ? "skipped" : "passed", duration, ...(error ? { error: { message: error } } : {}) }],
    },
  ],
});
fs.writeFileSync(
  path.join(dir, "playwright-report.json"),
  JSON.stringify(
    {
      config: { version: "1.56.0" },
      suites: [
        {
          title: "login.spec.js",
          file: "tests/login.spec.js",
          specs: [],
          suites: [
            {
              title: "Login",
              file: "tests/login.spec.js",
              specs: [
                spec("valid user can log in", 5, "unexpected", 30500, "Error: Timed out 5000ms waiting for expect(locator).toHaveText(expected)\n\nLocator: locator('.dashboard-title')\nExpected string: \"Welcome\"\nReceived: <element(s) not found>"),
                spec("shows error for wrong password", 13, "unexpected", 6200, "Error: locator.click: Error: strict mode violation: locator('button') resolved to 3 elements"),
                spec("remember me keeps session", 20, "expected", 2100),
                spec("logout clears session", 28, "expected", 1800),
                spec("SSO login", 36, "skipped", 0),
              ],
            },
          ],
        },
        {
          title: "checkout.spec.js",
          file: "tests/checkout.spec.js",
          specs: [
            { ...spec("pay with saved card", 9, "flaky", 4100), file: "tests/checkout.spec.js" },
            { ...spec("apply coupon", 22, "unexpected", 7300, "Error: locator.click: Error: strict mode violation: locator('button') resolved to 3 elements"), file: "tests/checkout.spec.js" },
          ],
        },
      ],
      stats: { duration: 52000, expected: 2, unexpected: 3, flaky: 1, skipped: 1 },
    },
    null,
    2
  )
);

// ---------- Cucumber JSON ----------
fs.writeFileSync(
  path.join(dir, "cucumber-report.json"),
  JSON.stringify(
    [
      {
        name: "OTP activation",
        uri: "features/otp.feature",
        elements: [
          {
            name: "Valid OTP activates the account",
            type: "scenario",
            line: 5,
            steps: [
              { keyword: "Given ", name: "a pending patient account", result: { status: "passed", duration: 120000000 } },
              { keyword: "When ", name: "the patient enters a valid OTP", result: { status: "passed", duration: 340000000 } },
              { keyword: "Then ", name: "the account status is Active", result: { status: "passed", duration: 90000000 } },
            ],
          },
          {
            name: "Expired OTP is rejected",
            type: "scenario",
            line: 12,
            steps: [
              { keyword: "Given ", name: "an OTP sent 6 minutes ago", result: { status: "passed", duration: 100000000 } },
              { keyword: "When ", name: "the patient enters the OTP", result: { status: "passed", duration: 200000000 } },
              { keyword: "Then ", name: "the error \"OTP expired\" is shown", result: { status: "failed", duration: 5000000000, error_message: "AssertionError: expected 'Invalid OTP' to equal 'OTP expired'" } },
            ],
          },
        ],
      },
    ],
    null,
    2
  )
);

// ---------- JUnit XML ----------
fs.writeFileSync(
  path.join(dir, "junit-results.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="api" tests="3" failures="1" time="2.4">
  <testsuite name="Users API" tests="3" failures="1">
    <testcase classname="UsersApi" name="GET /users returns 200" time="0.31"/>
    <testcase classname="UsersApi" name="POST /users rejects duplicate email" time="0.52">
      <failure message="expected 409 but got 500">AssertionError: expected 409 but got 500 at users.test.js:42</failure>
    </testcase>
    <testcase classname="UsersApi" name="DELETE /users/:id requires admin" time="0.12"><skipped/></testcase>
  </testsuite>
</testsuites>
`
);

// ---------- JMeter CSV ----------
const rows = ["timeStamp,elapsed,label,responseCode,responseMessage,success,bytes,allThreads"];
let ts = 1731240000000;
for (let i = 0; i < 200; i++) {
  ts += 100;
  const login = i % 2 === 0;
  const elapsed = login ? 180 + ((i * 37) % 220) : 420 + ((i * 53) % 900);
  const ok = !(login === false && i % 25 === 1);
  rows.push(`${ts},${elapsed},${login ? "POST /login" : "GET /appointments"},${ok ? 200 : 503},${ok ? "OK" : "Service Unavailable"},${ok},1532,50`);
}
fs.writeFileSync(path.join(dir, "jmeter-results.csv"), rows.join("\n"));

// ---------- negative-test fixtures ----------
fs.writeFileSync(path.join(dir, "empty.txt"), "");
fs.writeFileSync(path.join(dir, "malware.exe"), "MZ fake binary");

console.log("fixtures written to", dir);
