const { test, expect } = require('@playwright/test');

test('R15 主屏幕安装入口、图标和 Service Worker 资源可访问', { tag: ['@release', '@p2'] }, async ({ page, request, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const get = async url => {
    expect(url.origin === origin, '安装资源和站点同源').toBe(true);
    const response = await request.get(url.toString(), { maxRedirects: 0, timeout: 15_000 });
    expect(response.ok()).toBe(true);
    return response;
  };
  await page.goto('./');
  const manifestLink = page.locator('link[rel=manifest]');
  await expect(manifestLink).toHaveCount(1);

  await test.step('清单指向同源的独立窗口启动入口', async () => {
    const pathname = await manifestLink.getAttribute('href');
    const file = new URL(pathname, baseURL);
    const response = await get(file);
    const manifest = await response.json();
    expect(manifest.display).toBe('standalone');
    const launch = new URL(manifest.start_url, file);
    const scope = new URL(manifest.scope, file);
    expect(launch.origin === origin && scope.origin === origin).toBe(true);
    expect(launch.pathname.startsWith(scope.pathname)).toBe(true);
    await get(launch);
  });

  await test.step('Apple 主屏幕图标和 Service Worker 脚本可获取', async () => {
    const icon = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
    expect(Boolean(icon)).toBe(true);
    const image = await get(new URL(icon, baseURL));
    expect(image.headers()['content-type'] || '').toContain('image/');
    const worker = await get(new URL('/sw.js', baseURL));
    expect(worker.headers()['content-type'] || '').toMatch(/javascript/);
  });
});
