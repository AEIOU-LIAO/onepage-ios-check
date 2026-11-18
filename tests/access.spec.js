const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('S01 登录失败提示、用户名保留和登录页布局（模拟 401）', { tag: ['@smoke', '@p0'] }, async ({ page }) => {
  const name = 'qa-fixture';
  let loginAttempts = 0;
  await page.route('**/api/auth/login', async route => {
    loginAttempts++;
    await route.fulfill({ status: 401, json: { ok: false, error: '用户名或密码错误' } });
  });

  await test.step('登录表单在 320px 宽的窗口内可操作', async () => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('./');
    const nameInput = page.locator('#loginForm [name=username]');
    await expect(nameInput).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#loginForm button[type=submit]')).toBeInViewport();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  await test.step('模拟错误密码返回，验证提示和再次提交条件', async () => {
    await page.locator('#loginForm [name=username]').fill(name);
    await page.locator('#loginForm [name=password]').fill('fixture-only-password');
    await page.locator('#loginForm button[type=submit]').click();
    await expect(page.locator('#loginForm .err')).toContainText('用户名或密码错误');
    await expect(page.locator('#loginForm [name=username]')).toHaveValue(name);
    await expect(page.locator('#loginForm button[type=submit]')).toBeEnabled();
    await expect(page.locator('#app')).toBeHidden();
    expect(loginAttempts).toBe(1);
  });
});

test('R01 退出登录后，刷新保持退出，草稿不出现在登录页', { tag: ['@release', '@p0'] }, async ({ page, baseURL }) => {
  await test.step('正常登录后，在首页输入未提交草稿', async () => {
    await login(page, baseURL);
    await page.locator('#askInput').fill('自动检查用草稿');
  });
  await test.step('退出登录并确认刷新后仍在登录页', async () => {
    await page.locator('#accBtn').click();
    await page.locator('#accMenu [data-act=logout]').click();
    await expect(page.locator('#loginForm [name=username]')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await page.reload();
    await expect(page.locator('#loginForm [name=username]')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('#askInput')).toBeHidden();
  });
});

test('R02 会话失效时关闭聊天并清理首页输入（模拟 401）', { tag: ['@release', '@p0'] }, async ({ page, baseURL }) => {
  let saveStarted = false;
  let releaseResponse;
  const responseReady = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/api/me/todos', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { ok: true, todos: [] } });
    } else {
      saveStarted = true;
      await responseReady;
      await route.fulfill({ status: 401, json: { ok: false, error: '登录已失效' } });
    }
  });

  try {
    await test.step('已有登录，聊天打开时让一条待办保存请求返回 401', async () => {
      await login(page, baseURL);
      await expect(page.locator('#todoList')).not.toContainText('正在读取');
      await page.locator('#askInput').fill('自动检查用过期草稿');
      await page.locator('#todoInput').fill('自动检查用模拟待办');
      await page.locator('#todoInput').press('Enter');
      await expect.poll(() => saveStarted).toBe(true);
      await page.locator('#cards .card .cg').first().click();
      await expect(page.locator('#chat')).toBeVisible();
      releaseResponse();
    });
    await test.step('回到登录页，聊天关闭，首页草稿清空', async () => {
      await expect(page.locator('#loginForm [name=username]')).toBeVisible();
      await expect(page.locator('#chat')).toBeHidden();
      await expect(page.locator('#app')).toBeHidden();
      await expect(page.locator('#askInput')).toHaveValue('');
    });
  } finally {
    releaseResponse();
  }
});
