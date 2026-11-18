const { randomUUID } = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { login, api } = require('./helpers');

test('R03 待办改名、取消修改、完成与撤销，并核对刷新恢复', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  const unique = '待办回归-' + randomUUID();
  const renamed = unique + '（已改名）';
  const stored = async (title, done) => {
    const res = await api(page, 'GET', '/api/me/todos');
    return res.status === 200 && res.data?.todos?.some(t => t.t === title && t.done === done);
  };
  const before = page.locator('#todoList li', { hasText: unique });
  let row = before;
  await login(page, baseURL);
  try {
    await test.step('新增待办，尝试改名后用 Escape 取消', async () => {
      await expect(page.locator('#todoList')).not.toContainText('正在读取');
      await page.locator('#todoInput').fill(unique);
      await page.locator('#todoInput').press('Enter');
      await expect(row.locator('.tt')).toHaveText(unique);
      const id = await before.getAttribute('data-id');
      expect(id).toMatch(/^[a-z0-9]+$/);
      row = page.locator('#todoList li[data-id=' + id + ']');
      await row.locator('.tt').tap();
      await row.locator('.tt-edit').fill('应当取消的临时文本');
      await row.locator('.tt-edit').press('Escape');
      await expect(row.locator('.tt')).toHaveText(unique);
    });
    await test.step('保存改名并标记完成，刷新后状态一致', async () => {
      await row.locator('.tt').tap();
      await row.locator('.tt-edit').fill(renamed);
      await row.locator('.tt-edit').press('Enter');
      await expect(row.locator('.tt')).toHaveText(renamed);
      await row.getByRole('button', { name: '标记完成', exact: true }).tap();
      await expect.poll(() => stored(renamed, true)).toBe(true);
      await page.reload();
      await expect(row.locator('.tt')).toHaveText(renamed);
      await expect(row.getByRole('button', { name: '标记未完成' })).toBeVisible();
    });
    await test.step('撤销完成，删除本轮待办并验证服务器状态', async () => {
      await row.getByRole('button', { name: '标记未完成' }).tap();
      await expect.poll(() => stored(renamed, false)).toBe(true);
      await row.locator('.rm').tap();
      await expect(row).toHaveCount(0);
      await expect.poll(async () => {
        const res = await api(page, 'GET', '/api/me/todos');
        return res.status === 200 && Array.isArray(res.data?.todos) && !res.data.todos.some(t => t.t === renamed);
      }).toBe(true);
    });
  } finally {
    if (await row.locator('.tt-edit').isVisible().catch(() => false)) {
      await row.locator('.tt-edit').press('Escape').catch(() => {});
    }
    if (await row.locator('.rm').isVisible().catch(() => false)) {
      await row.locator('.rm').click({ timeout: 3_000 }).catch(() => {});
    }
  }
});

test('R04 待办读取失败可重试，暂时断网后的保存可恢复（模拟网络）', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  let reads = 0;
  let saves = 0;
  let todos = [];
  const label = '模拟断网后保存的待办';
  await page.route('**/api/me/todos', async route => {
    const req = route.request();
    if (req.method() === 'GET') {
      reads++;
      if (reads === 1) {
        await route.fulfill({ status: 503, json: { ok: false, error: '测试用临时错误' } });
        return;
      }
    } else {
      saves++;
      if (saves === 1) {
        await route.abort('internetdisconnected');
        return;
      }
      todos = req.postDataJSON().todos;
    }
    await route.fulfill({ json: { ok: true, todos } });
  });

  await test.step('读取提示有重试按钮，重试后显示待办区域', async () => {
    await login(page, baseURL);
    await expect(page.locator('#todoRetry')).toBeVisible();
    await page.locator('#todoRetry').tap();
    await expect(page.locator('#todoRetry')).toBeHidden();
    await expect(page.locator('#todoList')).not.toContainText('正在读取');
  });
  await test.step('首次保存断网，待办保留并提示稍后再存', async () => {
    await page.locator('#todoInput').fill(label);
    await page.locator('#todoInput').press('Enter');
    await expect(page.locator('#todoList .tt', { hasText: label })).toBeVisible();
    await expect(page.locator('#toast')).toContainText('稍后会自动再存');
  });
  await test.step('自动重试成功，刷新后从模拟服务读回待办', async () => {
    await expect.poll(() => todos.some(t => t.t === label), { timeout: 30_000 }).toBe(true);
    expect(saves).toBe(2);
    await page.reload();
    await expect(page.locator('#todoList .tt', { hasText: label })).toBeVisible();
  });
});
