class LoginPage {
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
