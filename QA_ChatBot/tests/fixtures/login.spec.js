const { test, expect } = require('@playwright/test');
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
