# OnePage iPhone 尺寸 WebKit 检查

在 GitHub 标准 macOS 上用 Playwright 的 WebKit 和 iPhone 15 参数检查 https://tools.peiqi1.top/。在 [Actions](https://github.com/AEIOU-LIAO/onepage-ios-check/actions/workflows/ios.yml) 点 **Run workflow**，选择档位后手动运行。

| 档位 | 使用时机 | 执行范围 |
| --- | --- | --- |
| 小版本 `smoke` | 日常修补、上线前快速确认 | `@smoke` 标记的核心流程 |
| 大版本 `release` | 跨模块改动、发大版本 | 核心流程及所有扩展回归 |

[用例分级与覆盖矩阵](./COVERAGE.md)列出各模块的验证方式和剩余的真机项目。P0 是登录、数据保留和主要对话流程，P1 是常用功能和异常恢复，P2 是额外样式、配置和兼容性。

登录通过仓库 Secrets 的 TEST_USER、TEST_PASS 读取专用普通账号。两档均使用同一账号串行运行。线上待办和历史用例使用本轮合成条目并清理。模型和异常流程由浏览器拦截提供合成响应。公开日志只有固定用例标题、步骤和状态，没有截图、录像、trace 或登录状态文件。

GitHub Actions 的桌面 WebKit 用于网页层回归。主屏幕启动、真实键盘、Safari 边缘手势、后台切换、锁屏、真实录音由 iPhone 另验。
