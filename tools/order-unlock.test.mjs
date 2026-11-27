// Mocked order-unlock checks for this quiz. Synthetic ids only.
// Chrome is pinned to 127.0.0.1 for the vault, order, and Mantle hosts, so a
// missed mock cannot redeem a real order or code.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VAULT_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const VERCEL_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const ORDER = 'P847291038475610293';
const ORDER_B = 'P847291038475610294';
const CODE = 'AGABCD';
const PORT = 8942;
const BASE = `http://127.0.0.1:${PORT}/`;

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER) || patternError(ORDER_B)) throw new Error('synthetic order is not a legal id');
if (!/^AG[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const pageHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
if (pageHtml.includes('vercel.app') || pageHtml.includes('/order/') || pageHtml.includes('mantledb')) {
  throw new Error('order path still names a server host');
}
if (pageHtml.includes('soft_persimmon_order_uses') || !pageHtml.includes('age_gap_love_order_uses')) {
  throw new Error('display count must use this quiz\'s own key');
}
if (pageHtml.includes('暂时验证不了') || pageHtml.includes('次数已经用完')) {
  throw new Error('format-valid ids must not have a hard-block message');
}
if (!pageHtml.includes('paidVerified:false')) throw new Error('paidVerified must stay false');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    vaultMode: 'ok',
    vaultRemaining: 1,
    vaultPosts: 0,
    vaultGets: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleVault(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' ' + u.pathname + u.search);
  if (u.pathname === '/order/get' || u.pathname === '/order/redeem' || u.pathname.includes('/orders/')) {
    state.unexpected.push('vault-order ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.pathname === '/get') {
    state.vaultGets++;
    return send(req, 200, { ok: true, remaining: state.vaultRemaining, max: 3 });
  }
  if (u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: state.vaultRemaining, max: 3 });
  }
  state.unexpected.push('vault ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === VAULT_HOST) return await handleVault(req, u, state);
      state.unexpected.push(u.hostname + ' ' + req.method() + ' ' + u.pathname);
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      vaultPosts: state.vaultPosts, vaultGets: state.vaultGets,
      bodies: state.bodies, urls: state.urls, unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => u.includes('/orders/') || u.includes('/order/') || u.includes('vercel'));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qno', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qno').textContent !== prev, { timeout: 3000 }, before);
}

async function newPage(browser, state, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemVault === 'function');
  return { page, errors };
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep AG codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order, other) => {
    const before = localStorage.getItem(ORDER_USES_KEY);
    const badRepeat = redeemOrder('P111111111111111111');
    const badSeq = redeemOrder('P123456789012345678');
    const bad19 = redeemOrder('P9900000000000001378');
    const first = redeemOrder(order);
    const second = redeemOrder(other);
    return {
      good: orderFormatError(order),
      repeat: orderFormatError('P111111111111111111'),
      seq: orderFormatError('P123456789012345678'),
      pasted: classifyInput(' 「p8472-9103-8475-610293」 '),
      code: classifyInput(' ag ab cd '),
      junk: classifyInput('hello'),
      badCode: classifyInput('AGIIII'),
      shortP: classifyInput('P12345'),
      quiz: QUIZ_KEY,
      p19: orderFormatError('P9900000000000001378'),
      p19c: classifyInput('P9900000000000001378').type,
      copy: orderSuccessText({ ok: true, uses: 1, remaining: 2 }),
      lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0 }),
      laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0 }),
      paid: first.paidVerified,
      stored: localStorage.getItem(ORDER_USES_KEY),
      foreign: localStorage.getItem('soft_persimmon_order_uses'),
      key: ORDER_USES_KEY,
      before,
      badRepeat,
      badSeq,
      bad19,
      shown: shownOrderUses(order),
      shownOther: shownOrderUses(other),
      uses: first.uses,
      otherUses: second.uses,
    };
  }, ORDER, ORDER_B);
  assert(out.good === '', 'legal synthetic id rejected ' + out.good);
  assert(out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced AG code ' + JSON.stringify(out.code));
  assert(out.junk.type === 'order-invalid' && out.badCode.type === 'order-invalid' && out.shortP.type === 'order-invalid', 'classifier mixed');
  assert(out.quiz === 'age', 'quiz constant');
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.paid === false, 'paidVerified must stay false');
  assert(out.key === 'age_gap_love_order_uses' && out.foreign == null, 'storage key');
  assert(out.before == null && out.badRepeat.ok === false && out.badSeq.ok === false && out.bad19.ok === false, 'rejected ids must not count');
  assert(out.uses === 1 && out.otherUses === 1 && out.shown === 1 && out.shownOther === 1, 'counts are per order id');
  const stored = JSON.parse(out.stored);
  assert(stored[ORDER] === 1 && stored[ORDER_B] === 1 && Object.keys(stored).length === 2, 'stored map ' + out.stored);
  assertNoOrderNet(state, 'format checks must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('valid id starts with no order request; refresh and continue do not advance', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(!visible.includes('已付款') && !visible.includes('paidVerified'), 'start copy');
  assert(visible.includes('年上年下恋爱测试'), 'product title');
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  const heading = await page.$eval('.code-panel h3', (el) => el.textContent);
  const hint = await page.$eval('.code-hint', (el) => el.innerText);
  assert(heading === '输入订单号', heading);
  assert(hint.includes('我的订单') && hint.includes('3 次'), hint);
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, ' 「p8472-9103-8475-610293」 ');
  await page.click('#btnCodeOk');
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assertNoOrderNet(state, 'first start must not call the network');
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 2 次' && !toast.includes('付款'), 'success copy ' + toast);
  const prog = await page.$eval('#qprog', (el) => el.textContent);
  assert(prog === '1 / 18', 'quiz did not start ' + prog);
  const orderBefore = await page.evaluate(() => order.slice());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  assert(await shownUses(page) === 1, 'refresh at question 1 must not change the display count');
  assertNoOrderNet(state, 'refresh must not call the network');
  await answerOne(page);
  await answerOne(page);
  const mid = await page.$eval('#qprog', (el) => el.textContent);
  assert(mid === '3 / 18', 'progress ' + mid);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    qi,
    a0: ans[0],
    a1: ans[1],
    same: JSON.stringify(order),
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.a1 === 1, 'mid refresh ' + JSON.stringify(resumed));
  assert(resumed.same === JSON.stringify(orderBefore), 'refresh reshuffled the attempt');
  assert(await shownUses(page) === 1, 'mid refresh must not change the display count');
  assertNoOrderNet(state, 'mid refresh must not call the network');
  await page.click('#qback');
  await page.click('#qback');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => JSON.stringify(order));
  assert(cont === JSON.stringify(orderBefore), 'continue started a new attempt');
  assert(await shownUses(page) === 1, 'continue must not change the display count');
  assertNoOrderNet(state, 'continue must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result restore and 查看上次结果 do not advance; 重新测试 does; later entry still starts', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstIndex = await page.$eval('.index-num', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const peeked = await page.$eval('.index-num', (el) => el.textContent);
  assert(peeked === firstIndex, 'result refresh changed the index');
  assert(await shownUses(page) === 1, 'result refresh changed the display count');
  assertNoOrderNet(state, 'result refresh must not call the network');

  await page.evaluate(() => show('start'));
  await page.click('#btnLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, '查看上次结果 changed the display count');
  assertNoOrderNet(state, '查看上次结果 must not call the network');
  await page.click('#btnViewLast');
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'));
  assert(await shownUses(page) === 1, '查看上次 changed the display count');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, 'retest should display the second use');
  const secondToast = await page.$eval('#toast', (el) => el.textContent);
  assert(secondToast.includes('还可以测 1 次'), secondToast);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent, len: ans.length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  const thirdToast = await page.$eval('#toast', (el) => el.textContent);
  assert(thirdToast.includes('这是最后一次'), thirdToast);
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(await shownUses(page) === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected on the page', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const samples = ['P123456789012345678', 'P9900000000000001378', 'P111111111111111111', 'hello'];
  for (const sample of samples) {
    await page.$eval('#toast', (el) => { el.textContent = ''; });
    if (sample === samples[0]) await openAndSubmit(page, sample);
    else {
      await page.$eval('#codeInput', (el, v) => { el.value = v; }, sample);
      await page.click('#btnCodeOk');
    }
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
    const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
    assert(!onQuiz, sample + ' started the quiz');
  }
  assert(await shownUses(page, 'P123456789012345678') === 0, 'rejected id was counted');
  assert(await shownUses(page, 'P111111111111111111') === 0, 'repeat id was counted');
  assertNoOrderNet(state, 'invalid input reached the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('access codes hit the vault and do not call an order host', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'ag ab cd');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === 'age' && state.bodies[0].code === CODE, 'vault body', state);
  assert(!state.bodies[0].orderId, 'legacy redeem must not send orderId', state);
  assert(state.unexpected.length === 0, 'vault hit touched another host', state);
  assert(state.urls.some((u) => u.startsWith('POST /redeem')), 'vault url', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast === '验证成功，还可以测 1 次', toast);
  const counted = await page.evaluate(() => localStorage.getItem(ORDER_USES_KEY));
  assert(counted == null, 'access code wrote an order display count');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();

  const miss = freshState();
  miss.vaultMode = 'not_found';
  const missed = await newPage(browser, miss);
  await openAndSubmit(missed.page, CODE);
  await missed.page.waitForFunction(() => document.getElementById('toast').textContent.includes('验证码不正确'));
  const missQuiz = await missed.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!missQuiz && miss.vaultPosts === 1 && miss.unexpected.length === 0, 'vault miss left the vault path', miss);
  await missed.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('此验证码已用完'));
  const doneQuiz = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!doneQuiz && done.vaultPosts === 1 && done.unexpected.length === 0, 'exhausted vault left the vault path', done);
  await second.page.close();
});

async function waitPort(port) {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = createConnection({ port, host: '127.0.0.1' }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('preview server did not start');
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await waitPort(PORT);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${VAULT_HOST} 127.0.0.1, MAP ${VERCEL_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
