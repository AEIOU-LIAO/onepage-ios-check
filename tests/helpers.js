const { expect } = require('@playwright/test');
const USER = process.env.TEST_USER, PASS = process.env.TEST_PASS;

async function login(page, baseURL) {
  if (!USER || !PASS) throw new Error('缺少测试账号：请在仓库 Settings → Secrets 里设置 TEST_USER 和 TEST_PASS');
  await page.goto('./');
  expect(new URL(page.url()).origin === new URL(baseURL).origin, '登录页使用 OnePage 域名').toBe(true);
  await expect(page.locator('#loginForm [name=username], #app:not([hidden])').first()).toBeVisible({ timeout: 30_000 });
  if (await page.locator('#loginForm [name=username]').isVisible()) {
    await page.fill('#loginForm [name=username]', USER);
    await page.fill('#loginForm [name=password]', PASS);
    await page.click('#loginForm button[type=submit]');
  }
  await expect(page.locator('#app')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
}
// 页面状态：缩放倍数、横向溢出、16px 文字实际渲染出来的高度（被系统自动放大的话这里会变）
const state = page => page.evaluate(() => {
  const p = document.createElement('span'); p.textContent = '测'; p.style.cssText = 'position:fixed;left:-99px;top:0;font-size:16px;line-height:1;padding:0';
  document.body.appendChild(p); const h = p.getBoundingClientRect().height; p.remove();
  return { scale: Math.round(((window.visualViewport && window.visualViewport.scale) || 1) * 100) / 100, w: innerWidth, h: innerHeight,
    overflowX: document.documentElement.scrollWidth - innerWidth, px16: Math.round(h * 10) / 10 };
});
// 只统计页面错误数量，页面报错可能包含账户内容。
function watchErrors(page) {
  let count = 0;
  page.on('pageerror', () => { count++; });
  return () => count;
}
// 带着登录状态直接调接口（不经过界面）
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}, [method, path, body]);
module.exports = { login, state, watchErrors, api };
