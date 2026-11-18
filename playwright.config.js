// 只用 WebKit（Safari 的内核），按 iPhone 的屏幕、触摸和 UA 来跑。
// 公开运行只输出用例状态，不采集截图、录像和 trace。
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['./tests/summary-reporter.js']],
  use: {
    ...devices['iPhone 15'],
    baseURL: 'https://tools.peiqi1.top/',
    serviceWorkers: 'block',
    trace: 'off', video: 'off', screenshot: 'off',
    locale: 'zh-CN', timezoneId: 'Asia/Singapore'
  },
  projects: [{ name: 'iphone-webkit', use: { browserName: 'webkit' } }]
});
