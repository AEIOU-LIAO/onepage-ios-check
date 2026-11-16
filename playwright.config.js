// 只用 WebKit（Safari 的内核），按 iPhone 的屏幕、触摸和 UA 来跑。
// 不录像、不留 trace（trace 里会有输入的账号密码）；只保留脚本里主动截的图（截图时会把用户名盖住）。
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./tests/summary-reporter.js']],
  use: {
    ...devices['iPhone 15'],
    baseURL: process.env.SITE || 'https://tools.peiqi1.top/',
    serviceWorkers: 'block',
    trace: 'off', video: 'off', screenshot: 'off',
    locale: 'zh-CN', timezoneId: 'Asia/Singapore'
  },
  projects: [{ name: 'iphone-webkit', use: { browserName: 'webkit' } }]
});
