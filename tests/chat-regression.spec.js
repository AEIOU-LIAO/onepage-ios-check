// 前端交互回归：使用公开页面真实 DOM，模型响应及聊天存储全部在浏览器/测试进程内合成。
// 不调用真实模型，不读取/清空服务端聊天，不修改线上偏好；不输出正文、截图、录像或 trace。
// 本文件检查 WebKit 前端行为，不代表 iPhone 真机、主屏幕 PWA 或供应商服务验收。
const { test, expect } = require('@playwright/test');
const { login, watchErrors } = require('./helpers');

const QUESTION = 'release synthetic question';
const FIRST = 'Synthetic first segment. ';
const SECOND = 'Synthetic second segment.';
const DRAFT = 'synthetic unsent draft';
const MODEL = 'release-synthetic-chat';

function provider(id, name) {
  return {
    id, name, defaultRegion: 'cn', image: id === 'qwen', imageN: [1],
    imageModels: ['release-synthetic-image'], imageSizes: [], imageOpts: [],
    chatModels: [MODEL], think: true, thinkRules: [['.*', 'switch']], web: true,
    regions: [{ id: 'cn', label: '测试', full: '测试地区', hasKey: true, masked: 'synthetic', steps: [], chatModels: [MODEL] }]
  };
}

async function prepare(page, baseURL) {
  const records = new Map();
  let rev = 0;
  const origin = new URL(baseURL).origin;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const path = url.pathname, method = request.method();
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/ai/config') return reply({ ok: true, share: null, providers: [provider('qwen', '千问'), provider('deepseek', 'DeepSeek')] });
    if (path === '/api/ai/models') return reply({ ok: true, chat: [MODEL], image: ['release-synthetic-image'] });
    // 双重兜底：即使 fetch 合成器未生效，也绝不把 AI 请求发送到服务器。
    if (path.startsWith('/api/ai/') || path.startsWith('/api/meeting/')) return reply({ ok: false, error: 'Synthetic fixture only' }, 503);
    if (path === '/api/me/chats' && method === 'GET') {
      const after = Number(url.searchParams.get('after') || -1);
      return reply({ ok: true, chats: [...records.values()].filter(c => c.rev > after), cursor: rev, now: Date.now(), more: false });
    }
    if (path.startsWith('/api/me/chats/') && method === 'PUT') {
      const body = request.postDataJSON(), id = path.split('/').pop();
      const row = { id, at: Date.now(), rev: ++rev, deleted: false, conv: body.conv };
      records.set(id, row);
      return reply({ ok: true, rev: row.rev, updated: row.at });
    }
    if (path.startsWith('/api/me/chats') || path.startsWith('/api/me/blobs')) {
      // 本文件没有删除用例。意外进入此路径也只拦截，不碰真实历史。
      return reply({ ok: true });
    }
    if (!['GET', 'HEAD'].includes(method) && !path.startsWith('/api/auth/')) return reply({ ok: true });
    return route.fallback();
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const requests = [], streams = [];
    const harness = {
      requests, failNext: false,
      emit(index, content, reasoning) {
        const s = streams[index];
        if (!s || s.closed) throw new Error('Synthetic stream is not open');
        s.controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: {
          ...(content ? { content } : {}), ...(reasoning ? { reasoning_content: reasoning } : {})
        } }] }) + '\n\n'));
      },
      finish(index, reason = 'stop') {
        const s = streams[index];
        if (!s || s.closed) throw new Error('Synthetic stream is not open');
        s.controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] }) + '\n\ndata: [DONE]\n\n'));
        s.closed = true; s.controller.close(); s.detach();
      }
    };
    window.__releaseChat = harness;
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/ai/chat') return originalFetch(input, init);
      const body = JSON.parse(init.body || '{}');
      const index = requests.length;
      // 只保留协议元数据，不记录提问/回答正文。
      const meta = { provider: body.provider, web: body.web, thinking: body.thinking, messages: (body.messages || []).length, aborted: false };
      requests.push(meta);
      if (harness.failNext) {
        harness.failNext = false; streams.push(null);
        return new Response(JSON.stringify({ ok: false, error: 'Synthetic temporary failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
      const signal = init.signal;
      const stream = new ReadableStream({
        start(controller) {
          const s = { controller, closed: false, detach: () => signal && signal.removeEventListener('abort', abort) };
          const abort = () => {
            if (s.closed) return;
            meta.aborted = true; s.closed = true; s.detach();
            controller.error(new DOMException('Synthetic request aborted', 'AbortError'));
          };
          streams[index] = s;
          if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
        },
        cancel() { const s = streams[index]; if (s) { s.closed = true; s.detach(); } }
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await login(page, baseURL);
}

const requestCount = page => page.evaluate(() => window.__releaseChat.requests.length);
const contains = (page, selector, text) => page.evaluate(([s, t]) => [...document.querySelectorAll(s)].some(e => e.textContent.includes(t)), [selector, text]);
const emit = (page, index, content, reasoning = '') => page.evaluate(args => window.__releaseChat.emit(...args), [index, content, reasoning]);
const finish = (page, index, reason = 'stop') => page.evaluate(args => window.__releaseChat.finish(...args), [index, reason]);
const waitRequests = (page, count) => expect.poll(() => requestCount(page), { message: '合成请求数量符合预期' }).toBe(count);
const expectContent = (page, selector, text) => expect.poll(() => contains(page, selector, text), { message: '页面显示预期合成内容' }).toBe(true);

async function openChat(page) {
  await page.locator('#cards [data-chat="qwen"]').click();
  await expect(page.locator('#chatInput')).toBeVisible();
  await page.locator('#chatModel').selectOption(MODEL);
}
async function ask(page, text = QUESTION) {
  await page.locator('#chatInput').fill(text);
  await page.locator('#chatInput').press('Enter');
}
async function newChat(page) {
  if (await page.locator('#chatNew').isVisible()) await page.locator('#chatNew').click();
  else { await page.locator('#chatMore').click(); await page.locator('#morePop [data-go="#chatNew"]').click(); }
}
async function openMulti(page) {
  if (await page.locator('#multiBtn').getAttribute('aria-pressed') !== 'true') await page.locator('#multiBtn').click();
  const buttons = page.locator('#multiPick button[data-id]');
  for (let i = 0; i < await buttons.count(); i++) {
    const b = buttons.nth(i), wanted = ['qianwen', 'deepseek'].includes(await b.getAttribute('data-id'));
    if ((await b.getAttribute('aria-pressed') === 'true') !== wanted) await b.click();
  }
  await page.locator('#askInput').fill(QUESTION);
  await page.locator('#askInput').press('Enter');
  await expect(page.locator('#multi')).toBeVisible();
  await waitRequests(page, 2);
  await expect(page.locator('#multiGrid .mc')).toHaveCount(2);
}

test('R10 流式逐段显示、草稿保护和停止保留内容（3-1/3-3/3-4）', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  const errors = watchErrors(page);
  await prepare(page, baseURL); await openChat(page);
  await test.step('首段在请求尚未结束时显示', async () => {
    await ask(page); await waitRequests(page, 1); await emit(page, 0, FIRST);
    await expectContent(page, '#chatBody .msg.ai', FIRST);
    await expect(page.locator('#chatSend')).toHaveText('停止');
  });
  await test.step('回答期间按回车不会丢草稿或新增请求', async () => {
    await page.locator('#chatInput').fill(DRAFT); await page.locator('#chatInput').press('Enter');
    await expect(page.locator('#chatInput')).toHaveValue(DRAFT);
    await emit(page, 0, SECOND); await expectContent(page, '#chatBody .msg.ai', SECOND);
    expect(await requestCount(page)).toBe(1);
  });
  await test.step('停止取消流，已有内容与未发送草稿保留', async () => {
    await page.locator('#chatSend').click();
    await expect(page.locator('#chatSend')).toHaveText('发送');
    expect(await page.evaluate(() => window.__releaseChat.requests[0].aborted)).toBe(true);
    await expectContent(page, '#chatBody .msg.ai', FIRST + SECOND);
    await expect(page.locator('#chatBody .finish-note')).toBeVisible();
    await expect(page.locator('#chatInput')).toHaveValue(DRAFT);
    expect(errors()).toBe(0);
  });
});

test('R11 自动续写拼接、保留联网思考偏好及后续提问', { tag: ['@release', '@p0'] }, async ({ page, baseURL }) => {
  await prepare(page, baseURL); await openChat(page);
  await page.locator('#chatThink').check(); await page.locator('#chatWeb').check();
  await test.step('长度截断自动发起续写', async () => {
    await ask(page); await waitRequests(page, 1); await emit(page, 0, FIRST); await finish(page, 0, 'length');
    await waitRequests(page, 2);
    const options = await page.evaluate(() => window.__releaseChat.requests.map(r => ({ web: r.web, thinking: r.thinking })));
    expect(options).toEqual([{ web: true, thinking: true }, { web: false, thinking: false }]);
    await emit(page, 1, SECOND); await finish(page, 1);
    await expect(page.locator('#chatSend')).toHaveText('发送');
    await expectContent(page, '#chatBody .msg.ai', FIRST + SECOND);
    await expect(page.locator('#chatBody .msg.ai')).toHaveCount(1);
    await expect(page.locator('#chatBody .finish-note')).toHaveCount(0);
  });
  await test.step('界面偏好保留，下一次提问按原偏好发送', async () => {
    await expect(page.locator('#chatThink')).toBeChecked(); await expect(page.locator('#chatWeb')).toBeChecked();
    await ask(page, 'synthetic followup'); await waitRequests(page, 3);
    const options = await page.evaluate(() => ({ web: window.__releaseChat.requests[2].web, thinking: window.__releaseChat.requests[2].thinking }));
    expect(options).toEqual({ web: true, thinking: true });
    await emit(page, 2, SECOND); await finish(page, 2);
    await expect(page.locator('#chatSend')).toHaveText('发送');
  });
});

test('S05 首页问答闭环、模式切换和新对话（2-8/3-10/3-11）', { tag: ['@smoke', '@release', '@p0'] }, async ({ page, baseURL }) => {
  await prepare(page, baseURL);
  await test.step('首页提交问题后显示完整合成答案', async () => {
    if (await page.locator('#multiBtn').getAttribute('aria-pressed') === 'true') await page.locator('#multiBtn').click();
    await page.locator('#cards .card[data-id="qianwen"]').focus();
    await page.locator('#cards .card[data-id="qianwen"]').press('Enter');
    await page.locator('#askInput').fill(QUESTION); await page.locator('#askInput').press('Enter');
    await waitRequests(page, 1); await emit(page, 0, FIRST); await emit(page, 0, SECOND); await finish(page, 0);
    await expect(page.locator('#chat')).toBeVisible();
    await expect(page.locator('#chatSend')).toHaveText('发送');
    await expect(page.locator('#chatBody .msg.ai .bub')).toBeVisible();
    await expectContent(page, '#chatBody .msg.ai', FIRST + SECOND);
    await expect(page.locator('#chatBody .msg.ai .err, #chatBody .finish-note')).toHaveCount(0);
  });
  await test.step('生图模式返回后原问答仍在', async () => {
    await page.locator('#chat .chat-tabs [data-mode="image"]').click();
    await expect(page.locator('#chatFootImage')).toBeVisible();
    await page.locator('#chat .chat-tabs [data-mode="chat"]').click();
    await expectContent(page, '#chatBody .msg.ai', FIRST);
    await expect(page.locator('#chatBody .msg.user')).toHaveCount(1);
  });
  await test.step('新建空白对话再切换模式，不会回到上一段', async () => {
    await newChat(page); await expect(page.locator('#chatBody .msg')).toHaveCount(0);
    await page.locator('#chat .chat-tabs [data-mode="image"]').click();
    await page.locator('#chat .chat-tabs [data-mode="chat"]').click();
    await expect(page.locator('#chatBody .msg')).toHaveCount(0);
    expect(await requestCount(page)).toBe(1);
  });
});

test('R12 服务端错误可见，重试成功且问题不重复', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  await prepare(page, baseURL); await openChat(page);
  await test.step('合成503错误显示重试入口', async () => {
    await page.evaluate(() => { window.__releaseChat.failNext = true; });
    await ask(page); await waitRequests(page, 1);
    await expect(page.locator('#chatBody .msg.ai .err')).toBeVisible();
    await expect(page.locator('#chatBody .retry')).toBeVisible();
    await expect(page.locator('#chatSend')).toHaveText('发送');
  });
  await test.step('重试后使用同一问题，错误状态被成功回答替换', async () => {
    await page.locator('#chatBody .retry').click(); await waitRequests(page, 2);
    await emit(page, 1, SECOND); await finish(page, 1);
    await expect(page.locator('#chatSend')).toHaveText('发送');
    await expectContent(page, '#chatBody .msg.ai', SECOND);
    await expect(page.locator('#chatBody .msg.user')).toHaveCount(1);
    await expect(page.locator('#chatBody .msg.ai')).toHaveCount(1);
    await expect(page.locator('#chatBody .msg.ai .err')).toHaveCount(0);
  });
});

test('R13 多问两栏分别完成，并携带问答接着聊（5-1/5-4）', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  const errors = watchErrors(page);
  await prepare(page, baseURL);
  await openChat(page);
  await page.locator('#chatClose').tap();
  await expect(page.locator('#chat')).toBeHidden();
  await openMulti(page);

  const selected = page.locator('#multiGrid .mc').filter({
    has: page.locator('.mc-head b').filter({ hasText: /^DeepSeek$/ })
  });
  const deepseekIndex = await page.evaluate(() => window.__releaseChat.requests.findIndex(r => r.provider === 'deepseek'));
  const deepseekText = [FIRST, SECOND][deepseekIndex].trim();

  await test.step('两个服务商分别显示各自的合成回答', async () => {
    await emit(page, 0, FIRST); await emit(page, 1, SECOND); await finish(page, 0); await finish(page, 1);
    await expect(page.locator('#multiStop')).toBeHidden();
    await expect(page.locator('#multiGrid [data-a="pick"]')).toHaveCount(2);
    await expect(page.locator('#multiGrid')).toContainText(FIRST.trim());
    await expect(page.locator('#multiGrid')).toContainText(SECOND);
    await expect(selected.locator('.mc-body')).toContainText(deepseekText);
    expect(await page.evaluate(() => new Set(window.__releaseChat.requests.map(r => r.provider)).size)).toBe(2);
  });
  await test.step('滚动至 DeepSeek 一栏，点击继续聊后切到该服务商', async () => {
    const pick = selected.locator('[data-a="pick"]');
    await pick.scrollIntoViewIfNeeded({ timeout: 10_000 });
    await expect(pick).toBeInViewport();
    await pick.tap({ timeout: 10_000 });
    await expect(page.locator('#multi')).toBeHidden();
    await expect(page.locator('#chat')).toBeVisible();
    await expect(page.locator('#chatName')).toHaveText('DeepSeek');
  });
  await test.step('单聊显示该栏的提问和回答，不产生新模型请求', async () => {
    await expect(page.locator('#chatBody .msg.user')).toHaveCount(1);
    await expect(page.locator('#chatBody .msg.user .bub')).toContainText(QUESTION);
    await expect(page.locator('#chatBody .msg.ai .bub')).toContainText(deepseekText);
    await expect(page.locator('#chatBody .msg.ai')).toHaveCount(1);
    expect(await requestCount(page)).toBe(2);
    expect(errors()).toBe(0);
  });
});

test('R14 多问生成中保护草稿，停止全部取消两栏（5-2）', { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
  await prepare(page, baseURL); await openMulti(page);
  await emit(page, 0, FIRST); await emit(page, 1, SECOND);
  await expectContent(page, '#multiGrid', FIRST); await expectContent(page, '#multiGrid', SECOND);
  await test.step('生成期间回车不会清空追问草稿或重复请求', async () => {
    await page.locator('#multiInput').fill(DRAFT); await page.locator('#multiInput').press('Enter');
    await expect(page.locator('#multiInput')).toHaveValue(DRAFT);
    await expect(page.locator('#multiSend')).toBeDisabled();
    expect(await requestCount(page)).toBe(2);
  });
  await test.step('停止全部后两条流都中止，内容和草稿仍在', async () => {
    await page.locator('#multiStop').click();
    await expect(page.locator('#multiStop')).toBeHidden();
    await expect(page.locator('#multiSend')).toBeEnabled();
    expect(await page.evaluate(() => window.__releaseChat.requests.every(r => r.aborted))).toBe(true);
    await expectContent(page, '#multiGrid', FIRST); await expectContent(page, '#multiGrid', SECOND);
    await expect(page.locator('#multiInput')).toHaveValue(DRAFT);
  });
});
