const fs = require('node:fs');

class Summary {
  constructor() {
    this.rows = [];
    this.steps = 0;
  }

  onTestEnd(test, result) {
    this.rows.push(`- ${result.status === 'passed' ? '通过' : result.status === 'skipped' ? '跳过' : '未通过'} · ${test.title}`);
    for (const a of result.annotations || []) {
      if (a.type === 'fixture-status' && /^[1-5]\d{2}$/.test(a.description || '')) {
        this.rows.push('  - 测试记录写入 HTTP 状态 · ' + a.description);
      }
    }
    for (const step of result.steps) {
      if (step.category !== 'test.step') continue;
      if (!step.error) this.steps++;
      this.rows.push(`  - ${step.error ? '未通过' : '通过'} · ${step.title}`);
    }
  }

  onEnd(result) {
    const summary = [
      '# OnePage iPhone 尺寸 WebKit 检查',
      '',
      `运行状态 · ${result.status}`,
      `通过检查步骤 · ${this.steps}`,
      '',
      ...this.rows,
      '',
    ].join('\n');
    // 输出仅取固定标题和状态，不复制 Playwright 的错误正文或页面内容。
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }

  printsToStdio() { return true; }
}

module.exports = Summary;
