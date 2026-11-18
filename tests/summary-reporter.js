const fs = require('node:fs');

class Summary {
  constructor() {
    this.rows = [];
    this.steps = 0;
    this.counts = { passed: 0, failed: 0, skipped: 0 };
  }

  onTestEnd(test, result) {
    if (result.status === 'passed' || result.status === 'skipped') this.counts[result.status]++;
    else this.counts.failed++;
    this.rows.push(`- ${result.status === 'passed' ? '通过' : result.status === 'skipped' ? '跳过' : '未通过'} · ${test.title}`);
    for (const a of result.annotations || []) {
      if (a.type === 'fixture-status' && /^[1-5]\d{2}$/.test(a.description || '')) {
        this.rows.push('  - 测试记录写入 HTTP 状态 · ' + a.description);
      }
    }
    for (const step of result.steps) {
      if (step.category !== 'test.step') continue;
      const skipped = step.annotations?.some(a => a.type === 'skip');
      if (!step.error && !skipped) this.steps++;
      this.rows.push(`  - ${skipped ? '跳过' : step.error ? '未通过' : '通过'} · ${step.title}`);
    }
  }

  onEnd(result) {
    const summary = [
      '# OnePage iPhone 尺寸 WebKit 检查',
      '',
      '档位 · ' + (process.env.QA_SUITE === 'smoke' ? '小版本' : process.env.QA_SUITE === 'release' ? '大版本' : '本地检查'),
      '用例统计 · 通过 ' + this.counts.passed + ' / 未通过 ' + this.counts.failed + ' / 跳过 ' + this.counts.skipped,
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
