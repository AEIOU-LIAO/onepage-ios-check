const { expect } = require('@playwright/test');
const fs = require('fs');
const USER = process.env.TEST_USER, PASS = process.env.TEST_PASS;
fs.mkdirSync('shots', { recursive: true });

async function login(page) {
  if (!USER || !PASS) throw new Error('缺少测试账号：请在仓库 Settings → Secrets 里设置 TEST_USER 和 TEST_PASS');
  await page.goto('./');
  await expect(page.locator('#loginForm [name=username], #app:not([hidden])').first()).toBeVisible({ timeout: 30_000 });
  if (await page.locator('#loginForm [name=username]').isVisible()) {
    await page.fill('#loginForm [name=username]', USER);
    await page.fill('#loginForm [name=password]', PASS);
    await page.click('#loginForm button[type=submit]');
  }
  await expect(page.locator('#app')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
}
// 截图：把显示用户名的地方（问候语、右上角账号按钮）盖住；登录表单也盖住
let n = 0;
async function shot(page, name) {
  await page.screenshot({ path: `shots/${String(++n).padStart(2, '0')}-${name}.png`,
    mask: [page.locator('#greet'), page.locator('#accBtn'), page.locator('#accMenu'), page.locator('#loginForm input')], maskColor: '#888888' });
}
// 页面状态：缩放倍数、横向溢出、16px 文字实际渲染出来的高度（被系统自动放大的话这里会变）
const state = page => page.evaluate(() => {
  const p = document.createElement('span'); p.textContent = '测'; p.style.cssText = 'position:fixed;left:-99px;top:0;font-size:16px;line-height:1;padding:0';
  document.body.appendChild(p); const h = p.getBoundingClientRect().height; p.remove();
  return { scale: Math.round(((window.visualViewport && window.visualViewport.scale) || 1) * 100) / 100, w: innerWidth, h: innerHeight,
    overflowX: document.documentElement.scrollWidth - innerWidth, px16: Math.round(h * 10) / 10 };
});
// 记录页面脚本错误（错误文本里万一带上用户名，替换掉）
function watchErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).split(USER || '\u0000').join('***')));
  return errs;
}
// 带着登录状态直接调接口（不经过界面）
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}, [method, path, body]);
module.exports = { login, shot, state, watchErrors, api };
