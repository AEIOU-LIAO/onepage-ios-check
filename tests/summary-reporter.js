// 把结果写成一份简短的 report.md（不含账号信息）：通过 / 不通过的检查项，失败原因只留第一行
const fs = require('fs');
class Summary {
  constructor() { this.rows = []; }
  onTestEnd(test, result) {
    const steps = [];
    const walk = (list, depth) => list.forEach(s => { if (s.category === 'test.step') { steps.push({ title: s.title, ok: !s.error, depth }); walk(s.steps || [], depth + 1); } });
    walk(result.steps, 0);
    let err = result.error ? String(result.error.message || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join(' ⏎ ').slice(0, 600) : '';
    for (const k of ['TEST_USER', 'TEST_PASS']) { const v = process.env[k]; if (v) err = err.split(v).join('***'); }
    this.rows.push({ title: test.title, status: result.status, ms: result.duration, steps, err });
  }
  onEnd() {
    const mark = s => (s === 'passed' ? '✓' : s === 'skipped' ? '－' : '✗');
    const out = ['# OnePage · iPhone（WebKit）检查', '', `网址：${process.env.SITE || 'https://tools.peiqi1.top/'}`, `时间：${new Date().toISOString()}`, ''];
    for (const r of this.rows) {
      out.push(`## ${mark(r.status)} ${r.title}（${Math.round(r.ms / 1000)} 秒）`);
      r.steps.forEach(s => out.push(`${'  '.repeat(s.depth)}- ${s.ok ? '✓' : '✗'} ${s.title}`));
      if (r.err) out.push('', '> ' + r.err);
      out.push('');
    }
    const bad = this.rows.filter(r => r.status !== 'passed' && r.status !== 'skipped').length;
    out.push(`合计：${this.rows.length} 组，未通过 ${bad} 组`);
    fs.writeFileSync('report.md', out.join('\n') + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
  }
}
module.exports = Summary;
