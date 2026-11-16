// 只用测试账号、不提问（不消耗任何 AI 额度）。测试中建的待办和对话记录，结束时都会删掉。
const { test, expect, devices } = require('@playwright/test');
const { login, shot, state, watchErrors, api } = require('./helpers');
const TAG = 'iOS自动检查';

test('登录、刷新后恢复', async ({ page }) => {
  const errs = watchErrors(page);
  await test.step('打开网站', async () => { await page.goto('./'); await expect(page.locator('#loginForm [name=username], #app:not([hidden])').first()).toBeVisible({ timeout: 30_000 }); await shot(page, '登录页'); });
  await test.step('用测试账号登录，进入首页', async () => { await login(page); await shot(page, '首页'); });
  const todo = `${TAG}-${Date.now()}`;
  await test.step('加一条待办', async () => {
    await page.locator('#todoInput').scrollIntoViewIfNeeded();
    await page.fill('#todoInput', todo); await page.press('#todoInput', 'Enter');
    const row = page.locator('#todoList .tt', { hasText: todo });
    const added = await row.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
    if (!added) {
      // 没加上：把当时的情况记下来（提示条、待办区的文字、输入框里还剩什么），方便判断是页面的问题还是脚本的问题
      const info = await page.evaluate(() => ({ toast: (document.querySelector('#toast') || {}).innerText || '', list: document.querySelector('#todoList').innerText.slice(0, 80),
        inputLeft: document.querySelector('#todoInput').value.length, hasSubmit: !!document.querySelector('#todoAdd [type=submit], #todoAdd button:not([type=button])') }));
      await shot(page, '待办没加上');
      throw new Error('按回车后待办没有出现：' + JSON.stringify(info));
    }
    await page.waitForTimeout(1500);
  });
  await test.step('刷新页面：还是登录状态，待办还在', async () => {
    await page.reload();
    await expect(page.locator('#app')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#loginForm [name=username]')).toBeHidden();
    await expect(page.locator('#todoList .tt', { hasText: todo })).toBeVisible();
  });
  await test.step('删掉这条待办（清理）', async () => {
    await page.locator('#todoList li', { hasText: todo }).locator('.rm').click();
    await expect(page.locator('#todoList .tt', { hasText: todo })).toHaveCount(0);
    await page.waitForTimeout(1500);
  });
  await test.step('没有页面脚本错误', async () => { expect(errs).toEqual([]); });
});

test('页面操作：缩放设置、横竖屏、对话框', async ({ page }) => {
  const errs = watchErrors(page);
  await login(page);
  const p1 = await state(page);
  await test.step('整页不能放大（iPhone 上放大会导致页面重开）', async () => {
    expect(await page.getAttribute('meta[name=viewport]', 'content')).toContain('maximum-scale=1');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe('pan-x pan-y');
    expect(await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
  });
  await test.step('竖屏：没有放大、没有横向溢出', async () => { expect(p1.scale).toBe(1); expect(p1.overflowX).toBeLessThanOrEqual(1); });
  await test.step('转横屏：文字没有被自动放大，没有横向溢出', async () => {
    await page.setViewportSize({ width: p1.h, height: p1.w }); await page.waitForTimeout(800);
    const l = await state(page); await shot(page, '首页-横屏');
    expect(Math.abs(l.px16 - p1.px16)).toBeLessThan(0.6); expect(l.scale).toBe(1); expect(l.overflowX).toBeLessThanOrEqual(1);
  });
  await test.step('转回竖屏：恢复原样', async () => {
    await page.setViewportSize({ width: p1.w, height: p1.h }); await page.waitForTimeout(800);
    const p2 = await state(page);
    expect(p2.scale).toBe(1); expect(Math.abs(p2.px16 - p1.px16)).toBeLessThan(0.6); expect(p2.overflowX).toBeLessThanOrEqual(1);
  });
  await test.step('点卡牌上的对话按钮：对话框打开，关闭按钮在屏幕里', async () => {
    await page.locator('#cards .card .cg').first().click();
    await expect(page.locator('#chat')).toBeVisible();
    await page.waitForTimeout(800); await shot(page, '对话框');
    const box = await page.locator('#chatClose').boundingBox();
    expect(box && box.y >= 0 && box.x + box.width <= p1.w + 1).toBeTruthy();
    expect((await state(page)).overflowX).toBeLessThanOrEqual(1);
  });
  await test.step('对话框打开时，下面首页的毛玻璃关掉了（只剩对话框一层）', async () => {
    const layers = await page.evaluate(() => [...document.querySelectorAll('.glass')].filter(e => e.getClientRects().length && (getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter || 'none') !== 'none').length);
    expect(layers).toBeLessThanOrEqual(1);
  });
  await test.step('「···」菜单和「历史」不会叠在一起', async () => {
    const vis = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }, sel);
    if (await vis('#chatMore')) {
      await page.click('#chatMore'); expect(await vis('#morePop')).toBe(true);
      if (await vis('#chatHistoryBtn')) { await page.click('#chatHistoryBtn'); await page.waitForTimeout(300); expect(await vis('#morePop')).toBe(false); expect(await vis('#chatHistory')).toBe(true); await page.click('#chatHistoryBtn'); }
      else { await page.click('#chatMore'); expect(await vis('#morePop')).toBe(false); }
    }
  });
  await test.step('对话框横屏：文字没有变大；关掉对话框', async () => {
    await page.setViewportSize({ width: p1.h, height: p1.w }); await page.waitForTimeout(800);
    const l = await state(page); await shot(page, '对话框-横屏');
    expect(Math.abs(l.px16 - p1.px16)).toBeLessThan(0.6);
    await page.setViewportSize({ width: p1.w, height: p1.h }); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#chatClose').click());
    await expect(page.locator('#chat')).toBeHidden();
  });
  await test.step('没有页面脚本错误', async () => { expect(errs).toEqual([]); });
});

test('聊天记录在两台设备之间同步', async ({ page, browser }) => {
  // 设备 A = page；设备 B = 另一个独立的浏览器环境（同一个测试账号）
  const errs = watchErrors(page);
  await login(page);
  const ctxB = await browser.newContext({ ...devices['iPhone 15'], baseURL: process.env.SITE || 'https://tools.peiqi1.top/', serviceWorkers: 'block', locale: 'zh-CN', timezoneId: 'Asia/Singapore' });
  const pageB = await ctxB.newPage();
  const id = 'ioschk' + Date.now().toString(36), title = `${TAG}-${Date.now()}`, now = Date.now();
  const titles = p => p.evaluate(async () => { const r = await fetch('/api/me/chats?after=-1', { credentials: 'same-origin' }); const j = await r.json(); return (j.chats || []).filter(c => !c.deleted).map(c => (c.conv && c.conv.title) || ''); });
  const openHistory = async p => {
    await p.locator('#cards .card .cg').first().click(); await expect(p.locator('#chat')).toBeVisible();
    await p.evaluate(() => { const h = document.querySelector('#chatHistory'); if (h.hidden) document.querySelector('#chatHistoryBtn').click(); });
  };
  try {
    await test.step('设备 A 上存进一段对话记录（直接写入，不调用 AI）', async () => {
      const r = await api(page, 'PUT', '/api/me/chats/' + id, { base: 0, conv: { id, provider: 'qwen', mode: 'chat', title, at: now,
        msgs: [{ role: 'user', content: '这是自动检查写入的一条记录', at: now }, { role: 'assistant', content: '收到（自动检查）', model: 'check', at: now + 1 }] } });
      expect(r.status).toBe(200);
    });
    await test.step('设备 B 登录：云端能读到这一段', async () => { await login(pageB); expect(await titles(pageB)).toContain(title); });
    await test.step('设备 B 的历史记录里能看到这一段', async () => {
      await openHistory(pageB);
      await expect(pageB.locator('#chatHistory .h-item', { hasText: title })).toBeVisible({ timeout: 20_000 });
      await shot(pageB, '设备B-历史记录');
    });
    await test.step('设备 B 点开这一段：内容完整', async () => {
      await pageB.locator('#chatHistory .h-item', { hasText: title }).click();
      // 测试账号没有这家 AI 的 Key 时，界面显示的是填 Key 的页面（内容在后面）：按文字内容判断，不要求看得见
      await expect.poll(() => pageB.evaluate(() => document.querySelector('#chatBody').textContent), { timeout: 15_000 }).toContain('这是自动检查写入的一条记录');
      expect(await pageB.evaluate(() => document.querySelector('#chatBody').textContent)).toContain('收到（自动检查）');
    });
    await test.step('设备 B 删掉这一段（确认框点确定）', async () => {
      pageB.once('dialog', d => d.accept());
      await pageB.evaluate(() => { const h = document.querySelector('#chatHistory'); if (h.hidden) document.querySelector('#chatHistoryBtn').click(); });
      await pageB.locator('#chatHistory .h-item', { hasText: title }).locator('.h-del').click();
      await expect(pageB.locator('#chatHistory .h-item', { hasText: title })).toHaveCount(0);
      await expect.poll(() => titles(pageB), { timeout: 20_000 }).not.toContain(title);
    });
    await test.step('设备 A 打开历史记录：这一段也没有了', async () => {
      await openHistory(page);
      await page.waitForTimeout(3000);
      await expect(page.locator('#chatHistory .h-item', { hasText: title })).toHaveCount(0);
    });
    await test.step('没有页面脚本错误', async () => { expect(errs).toEqual([]); });
  } finally {
    await api(page, 'DELETE', '/api/me/chats/' + id).catch(() => {});      // 不管成不成，都把测试记录清掉
    await ctxB.close();
  }
});
