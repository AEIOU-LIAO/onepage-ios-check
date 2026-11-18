const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('R05 窄屏、大屏与横屏下聊天窗口可操作', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  const viewports = [
    { width: 320, height: 700 },
    { width: 430, height: 932 },
    { width: 852, height: 393 },
  ];
  await login(page, baseURL);
  const chat = page.locator('#chat');
  const close = page.locator('#chatClose');

  for (const { width, height } of viewports) {
    await test.step(width + ' × ' + height + ' 首页与聊天窗口', async () => {
      await page.setViewportSize({ width, height });
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await expect.poll(noOverflow).toBeLessThanOrEqual(1);
      await page.locator('#cards .card .cg').first().tap();
      await expect(chat).toBeVisible();
      await expect(close).toBeInViewport();
      await expect.poll(noOverflow).toBeLessThanOrEqual(1);
      await close.tap();
      await expect(chat).toBeHidden();
    });
  }
});
