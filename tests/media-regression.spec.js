// File input and API responses are simulated; this is not an iOS system-picker,
// microphone, pinch-gesture or real image/transcription provider test.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const MODEL = 'release-media-chat';
const IMAGE_MODEL = 'release-media-image';
// A generated 24 x 16 blue engineering fixture, containing no user photograph.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAQCAIAAACDRijCAAAAGklEQVR4nGPQyLtDFcQwatCoQaMGjRpEGQIAWK8rHyDsf+kAAAAASUVORK5CYII=';
const IMAGE_URL = 'data:image/png;base64,' + PNG;

async function prepareMedia(page, baseURL) {
  const records = new Map(), blobs = new Map();
  let rev = 0, imageRequests = 0, unexpectedServices = 0, releaseImage;
  const imageGate = new Promise(resolve => { releaseImage = resolve; });
  const origin = new URL(baseURL).origin;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.fallback();
    const path = url.pathname, method = request.method();
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/ai/config') return reply({ ok: true, share: null, providers: [{
      id: 'qwen', name: '千问', defaultRegion: 'cn',
      chatModels: [MODEL], think: false, web: false,
      image: true, imageModels: [IMAGE_MODEL], imageN: [1],
      imageSizes: [['512x512', '测试尺寸']], imageOpts: [],
      vision: { model: MODEL, re: '.*', strict: false },
      regions: [{ id: 'cn', label: '测试', full: '测试地区', hasKey: true, masked: 'synthetic', steps: [], chatModels: [MODEL] }]
    }] });
    if (path === '/api/ai/models') return reply({ ok: true, chat: [MODEL], image: [IMAGE_MODEL] });
    if (path === '/api/meeting/engines') return reply({ ok: true, cos: false, share: null, engines: [{
      id: 'qwen', name: '合成转写引擎', ready: true, shared: false, formats: ['wav', 'mp3']
    }] });
    if (path === '/api/ai/image' && method === 'POST') {
      imageRequests++;
      await imageGate;
      return reply({ ok: true, images: [IMAGE_URL] });
    }
    // No other model, upload, transcription, speech or provider calls may escape.
    if (path.startsWith('/api/ai/') || path.startsWith('/api/meeting/')) {
      unexpectedServices++;
      return reply({ ok: false, error: 'Synthetic media fixture only' }, 503);
    }
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
    if (path.startsWith('/api/me/blobs/')) {
      const id = path.split('/').pop();
      if (method === 'PUT') { blobs.set(id, request.postDataJSON().data); return reply({ ok: true }); }
      if (method === 'GET') return blobs.has(id) ? reply({ ok: true, data: blobs.get(id) }) : reply({ ok: false, error: 'Synthetic fixture not found' }, 404);
      return reply({ ok: true });
    }
    if (path.startsWith('/api/me/chats')) return reply({ ok: true });
    // Ordinary login remains real. All other account writes stay in this test run.
    if (!['GET', 'HEAD'].includes(method) && !path.startsWith('/api/auth/')) return reply({ ok: true });
    return route.fallback();
  });
  await login(page, baseURL);
  await page.locator('#cards [data-chat="qwen"]').click();
  await expect(page.locator('#chat')).toBeVisible();
  await page.locator('#chat .chat-tabs [data-mode="chat"]').click();
  await expect(page.locator('#chatInput')).toBeVisible();
  await page.locator('#chatModel').selectOption(MODEL);
  return {
    images: () => imageRequests,
    blocked: () => unexpectedServices,
    finishImage: () => releaseImage()
  };
}

const readyImage = (page, selector) => expect.poll(() => page.locator(selector).evaluateAll(images =>
  images.length === 1 && images[0].complete && images[0].naturalWidth > 0),
{ message: '合成图片已实际解码并显示' }).toBe(true);

test('R16 发布媒体：图片和文本附件可添加、预览及分别移除（模拟文件选择）',
  { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
    const media = await prepareMedia(page, baseURL);
    await test.step('选入合成图片和文本，两项均完成本地读取', async () => {
      await page.locator('#attFile').setInputFiles([
        { name: 'release-image.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') },
        { name: 'release-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic attachment for frontend regression.', 'utf8') }
      ]);
      await expect(page.locator('#attStrip')).toBeVisible();
      await expect(page.locator('#attStrip .att-chip.ready')).toHaveCount(2);
      await expect(page.locator('#attStrip .att-chip.file')).toContainText('release-note.txt');
      await readyImage(page, '#attStrip .att-chip.img img');
    });
    await test.step('打开图片预览并关闭，附件仍保留', async () => {
      await page.locator('#attStrip .att-chip.img img').click();
      await expect(page.locator('#lightbox')).toBeVisible();
      await readyImage(page, '#lightbox img');
      await page.locator('#lightbox .lb-x').click();
      await expect(page.locator('#lightbox')).toBeHidden();
      await expect(page.locator('#chatInput')).toBeVisible();
      await expect(page.locator('#attStrip .att-chip')).toHaveCount(2);
    });
    await test.step('分别移除附件，最后隐藏附件栏且没有发出消息', async () => {
      await page.locator('#attStrip .att-chip.img .att-x').click();
      await expect(page.locator('#attStrip .att-chip')).toHaveCount(1);
      await expect(page.locator('#attStrip .att-chip.file')).toBeVisible();
      await page.locator('#attStrip .att-chip.file .att-x').click();
      await expect(page.locator('#attStrip')).toBeHidden();
      await expect(page.locator('#chatBody .msg')).toHaveCount(0);
      expect(media.images()).toBe(0);
      expect(media.blocked()).toBe(0);
    });
  });

test('R17 发布媒体：未知附件拒收，旧格式文档提示转换且不能发送',
  { tag: ['@release', '@p2'] }, async ({ page, baseURL }) => {
    const media = await prepareMedia(page, baseURL);
    await test.step('未知二进制文件显示不支持提示且不进入附件栏', async () => {
      await page.locator('#attFile').setInputFiles({ name: 'release-unsupported.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic fixture') });
      await expect(page.locator('#toast')).toContainText('暂不支持');
      await expect(page.locator('#attStrip .att-chip')).toHaveCount(0);
    });
    await test.step('旧格式文档保留可处理的错误状态', async () => {
      await page.locator('#attFile').setInputFiles({ name: 'release-legacy.doc', mimeType: 'application/msword', buffer: Buffer.from('synthetic legacy fixture') });
      await expect(page.locator('#attStrip .att-chip.error')).toHaveCount(1);
      await expect(page.locator('#attStrip .att-note.bad')).toContainText('另存为');
      await page.locator('#chatInput').fill('合成附件检查');
      await page.locator('#chatSend').click();
      await expect(page.locator('#chatBody .msg')).toHaveCount(0);
      await expect(page.locator('#attStrip .att-chip.error')).toHaveCount(1);
      expect(media.blocked(), '无效附件未提交给模型').toBe(0);
      await page.locator('#attStrip .att-chip.error .att-x').click();
      await page.locator('#chatInput').fill('');
      await expect(page.locator('#attStrip')).toBeHidden();
      expect(media.images()).toBe(0);
    });
  });

test('R18 发布媒体：转写待选择状态与空录音拦截（不执行识别）',
  { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
    const media = await prepareMedia(page, baseURL);
    await page.locator('#chat .chat-tabs [data-mode="trans"]').click();
    await expect(page.locator('#chatFootTrans')).toBeVisible();
    await expect(page.locator('#transEng')).toContainText('合成转写引擎');
    await test.step('尚无文字稿时不能在录音追问框输入', async () => {
      await expect(page.locator('#transPick')).toBeEnabled();
      await expect(page.locator('#transPick')).toContainText('选择录音');
      await expect(page.locator('#transInput')).toBeDisabled();
      await expect(page.locator('#chatBody .msg')).toHaveCount(0);
    });
    await test.step('选择空录音后提示原因，不留下上传或识别状态', async () => {
      await page.locator('#transFile').setInputFiles({ name: 'release-empty.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(0) });
      await expect(page.locator('#toast')).toContainText('文件是空的');
      await expect(page.locator('#transInput')).toBeDisabled();
      await expect(page.locator('#transPick')).toBeEnabled();
      await expect(page.locator('#transFile')).toHaveValue('');
      await expect(page.locator('#chatBody .msg')).toHaveCount(0);
      expect(media.blocked(), '空文件未请求上传、识别或模型接口').toBe(0);
      expect(media.images()).toBe(0);
    });
  });

test('R19 发布媒体：模拟生图等待、结果解码显示及按钮恢复',
  { tag: ['@release', '@p1'] }, async ({ page, baseURL }) => {
    const media = await prepareMedia(page, baseURL);
    try {
      await page.locator('#chat .chat-tabs [data-mode="image"]').click();
      await expect(page.locator('#chatFootImage')).toBeVisible();
      await page.locator('#imgModel').selectOption(IMAGE_MODEL);
      await page.locator('#imgPrompt').fill('合成图片展示检查');
      await test.step('提交后显示等待并阻止重复生成', async () => {
        await page.locator('#imgGo').click();
        await expect.poll(media.images, { message: '只有一个合成生图请求' }).toBe(1);
        await expect(page.locator('#imgGo')).toBeDisabled();
        await expect(page.locator('#chatBody .msg.ai .typing')).toBeVisible();
        await expect(page.locator('#imgPrompt')).toHaveValue('');
      });
      await test.step('模拟响应完成后图片实际显示并恢复按钮', async () => {
        media.finishImage();
        await expect(page.locator('#imgGo')).toBeEnabled();
        await expect(page.locator('#imgGo')).toHaveText('生成');
        await expect(page.locator('#chatBody .gen-grid img')).toHaveCount(1);
        await readyImage(page, '#chatBody .gen-grid img');
        await expect(page.locator('#chatFootImage')).toBeVisible();
        await expect(page.locator('#chatBody .msg.ai .err')).toHaveCount(0);
        expect(media.images()).toBe(1);
        expect(media.blocked()).toBe(0);
      });
    } finally {
      media.finishImage();
    }
  });
