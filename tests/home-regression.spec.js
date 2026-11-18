const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

// Public DOM checked against index.html, app.js and layout.js on 2026-11-18.
// These cases never submit a question, save settings, or visit an external link.
// No account text, prompt content, screenshots or network bodies are reported.

async function openAccountPanel(page, action, dialog) {
  await page.locator('#accBtn').click();
  await expect(page.locator('#accMenu')).toBeVisible();
  await page.locator(`#accMenu [data-act="${action}"]`).click();
  await expect(page.locator(dialog)).toBeVisible();
  await expect(page.locator('#accMenu')).toBeHidden();
  await expect(page.locator('#accBtn')).toHaveAttribute('aria-expanded', 'false');
}

async function closeDialog(page, selector) {
  if (await page.locator(selector).isVisible()) {
    await page.locator(`${selector} .dlg-head [data-close]`).click();
    await expect(page.locator(selector)).toBeHidden();
  }
}

// A cancellation regression must not accidentally persist a preview to the account.
// Block only settings writes; count them as a failure instead of faking a success.
async function guardSettings(page) {
  let attempts = 0;
  await page.route('**/api/me/settings', async route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      return route.continue();
    }
    attempts++;
    return route.abort('blockedbyclient');
  });
  return async () => {
    await page.waitForTimeout(800); // app.js normally debounces settings saves by 600 ms.
    expect(attempts, '未提交任何账号设置变更').toBe(0);
  };
}

async function layoutState(page) {
  return page.evaluate(() => JSON.stringify(Array.from(document.querySelectorAll('#app [data-widget]'), el => ({
    kind: el.dataset.widget,
    hidden: el.hidden,
    display: getComputedStyle(el).display,
    parent: el.parentElement.className
  }))));
}

async function artState(page) {
  return page.evaluate(() => JSON.stringify({
    card: document.querySelector('#cards .card.on')?.dataset.id || '',
    thumb: document.querySelector('#cards .card.on img')?.getAttribute('src') || '',
    background: document.querySelector('#bgA.on, #bgB.on')?.style.backgroundImage || '',
    dark: document.body.classList.contains('bg-dark'),
    position: document.body.style.position
  }));
}

async function promptFingerprint(page) {
  // Hash within the page: existing prompt text never leaves the browser context.
  return page.evaluate(async () => {
    const rows = Array.from(document.querySelectorAll('#promptRows .prompt-row'), row => [
      row.querySelector('.pt').value,
      row.querySelector('.pp').value
    ]);
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
  });
}

test('R06 首页账号菜单开关与点击空白关闭', { tag: ['@release', '@p2'] }, async ({ page, baseURL }) => {
  await login(page, baseURL);
  const unchangedSettings = await guardSettings(page);

  await test.step('点击账号按钮打开和关闭菜单', async () => {
    await expect(page.locator('#accMenu')).toBeHidden();
    await expect(page.locator('#accBtn')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#accBtn').click();
    await expect(page.locator('#accMenu')).toBeVisible();
    await expect(page.locator('#accBtn')).toHaveAttribute('aria-expanded', 'true');
    for (const action of ['layout', 'skin', 'security', 'logout']) {
      await expect(page.locator(`#accMenu [data-act="${action}"]`)).toBeVisible();
    }
    await page.locator('#accBtn').click();
    await expect(page.locator('#accMenu')).toBeHidden();
    await expect(page.locator('#accBtn')).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('再次打开后点击页面边缘关闭', async () => {
    await page.locator('#accBtn').click();
    await expect(page.locator('#accMenu')).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(page.locator('#accMenu')).toBeHidden();
    await expect(page.locator('#accBtn')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#app')).toBeVisible();
  });
  await unchangedSettings();
});

test('R07 首页布局面板开关不改变现有排版', { tag: ['@release', '@p2'] }, async ({ page, baseURL }) => {
  await login(page, baseURL);
  const unchangedSettings = await guardSettings(page);
  const before = await layoutState(page);
  try {
    await test.step('布局预设可见，窄屏提示使用电脑自定义', async () => {
      await openAccountPanel(page, 'layout', '#layoutDlg');
      expect(await page.locator('#layoutPresets [data-preset]').count(), '存在可用布局预设').toBeGreaterThan(0);
      await expect(page.locator('#layoutCustom')).toBeDisabled();
      await expect(page.locator('#layoutCustomTip')).toContainText('电脑');
      await closeDialog(page, '#layoutDlg');
      expect(await layoutState(page) === before, '关闭面板后组件顺序和显示状态不变').toBe(true);
    });
    await test.step('再次进入和关闭布局面板仍保持原排版', async () => {
      await openAccountPanel(page, 'layout', '#layoutDlg');
      await closeDialog(page, '#layoutDlg');
      expect(await layoutState(page) === before, '重复打开不改变布局').toBe(true);
    });
  } finally {
    await closeDialog(page, '#layoutDlg');
  }
  await unchangedSettings();
});

test('R08 首页皮肤预览取消恢复，或正确显示无备选皮肤', { tag: ['@release', '@p2'] }, async ({ page, baseURL }) => {
  await login(page, baseURL);
  const unchangedSettings = await guardSettings(page);
  const before = await artState(page);
  let selected;
  try {
    await openAccountPanel(page, 'skin', '#skinDlg');
    const choices = page.locator('#skinGrid [data-skin]');
    if (await choices.count() > 1) {
      selected = await page.locator('#skinGrid [aria-pressed="true"]').getAttribute('data-skin');
      expect(Boolean(selected), '原皮肤处于选中状态').toBe(true);
      await test.step('备选皮肤可预览并可取消', async () => {
        const alternative = page.locator('#skinGrid [data-skin][aria-pressed="false"]').first();
        const target = await alternative.getAttribute('data-skin');
        const beforePreview = await artState(page);
        await alternative.click();
        expect(await page.locator('#skinGrid [aria-pressed="true"]').getAttribute('data-skin') === target,
          '预览项成为唯一选中的皮肤').toBe(true);
        await expect(page.locator('#skinGrid [aria-pressed="true"]')).toHaveCount(1);
        await expect.poll(async () => await artState(page) !== beforePreview,
          { message: '预览实际改变卡牌或背景' }).toBe(true);
        await page.locator('#skinDlg .skin-foot [data-close]').click();
        await expect(page.locator('#skinDlg')).toBeHidden();
        await expect.poll(async () => await artState(page) === before,
          { message: '取消后原卡牌、背景和页面滚动锁状态恢复' }).toBe(true);
      });
      await test.step('重新打开显示原皮肤而非未保存预览', async () => {
        await openAccountPanel(page, 'skin', '#skinDlg');
        expect(await page.locator('#skinGrid [aria-pressed="true"]').getAttribute('data-skin') === selected,
          '未保存预览未变成正式选择').toBe(true);
      });
    } else {
      await test.step('没有备选时显示说明并隐藏使用按钮', async () => {
        await expect(page.locator('#skinGrid .skin-none')).toBeVisible();
        await expect(page.locator('#skinUse')).toBeHidden();
      });
    }
  } finally {
    await closeDialog(page, '#skinDlg');
  }
  await expect.poll(async () => await artState(page) === before,
    { message: '退出皮肤面板后恢复原页面状态' }).toBe(true);
  await unchangedSettings();
});

test('R09 首页提示词草稿关闭后不保存', { tag: ['@release', '@p2'] }, async ({ page, baseURL }) => {
  await login(page, baseURL);
  test.skip(!(await page.locator('#prompts [data-manage]').isVisible()), '当前布局隐藏提示词管理入口，未覆盖此项');
  const unchangedSettings = await guardSettings(page);
  try {
    await page.locator('#prompts [data-manage]').click();
    await expect(page.locator('#promptDlg')).toBeVisible();
    const originalCount = await page.locator('#promptRows .prompt-row').count();
    const original = await promptFingerprint(page);

    await test.step('仅在未保存面板内编辑测试草稿', async () => {
      if (originalCount < 30) {
        await page.locator('#promptAdd').click();
        await expect(page.locator('#promptRows .prompt-row')).toHaveCount(originalCount + 1);
      }
      const draft = page.locator('#promptRows .prompt-row').last();
      await draft.locator('.pt').fill('体验测试未保存');
      await draft.locator('.pp').fill('体验测试草稿，不提交、不保存。');
      await expect(draft.locator('.pt')).toHaveValue('体验测试未保存');
      await expect(draft.locator('.pp')).toHaveValue('体验测试草稿，不提交、不保存。');
      await closeDialog(page, '#promptDlg');
    });

    await test.step('重新打开后提示词数量和内容仍为原值', async () => {
      await page.locator('#prompts [data-manage]').click();
      await expect(page.locator('#promptDlg')).toBeVisible();
      await expect(page.locator('#promptRows .prompt-row')).toHaveCount(originalCount);
      expect(await promptFingerprint(page) === original, '原提示词未被草稿覆盖').toBe(true);
    });
  } finally {
    await closeDialog(page, '#promptDlg');
  }
  await unchangedSettings();
});
