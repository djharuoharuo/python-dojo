// =====================================================================
// api.test.js — GAS Web API クライアントの自動リトライ（指数バックオフ）の検証。
// 実行: node tests/api.test.js
// GASのWeb Appは、リクエストがdoPost()に届く前にGoogle側インフラで稀に404/5xxを
// 返すことがある（既知の一時的挙動）。リトライで復帰することを確認する。
// =====================================================================
const assert = require('assert');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.error('  NG  ' + name + '\n      ' + e.message); }
}

// api.js はブラウザの fetch/navigator/CONFIG を前提にしているため、Node実行用に最小限スタブする。
// Node 22+ は読み取り専用の組み込み navigator を持つため、defineProperty で上書きする
Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
global.CONFIG = { GAS_URL: 'https://example.test/exec', APP_TOKEN: 'test-token' };

function mockFetchSequence(responses) {
  let i = 0;
  global.fetch = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r.throw) throw new Error('network down');
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
}

delete require.cache[require.resolve('../docs/api.js')];
const { api, ApiError } = require('../docs/api.js');

(async () => {
  await t('1回目404・2回目成功 → リトライして成功する', async () => {
    mockFetchSequence([{ ok: false, status: 404 }, { ok: true, status: 200, body: { hint: 'ok' } }]);
    const res = await api('hint', {});
    assert.strictEqual(res.hint, 'ok');
  });

  await t('最初から成功 → リトライなしで即返る', async () => {
    mockFetchSequence([{ ok: true, status: 200, body: { ok: true } }]);
    const res = await api('getToday', {});
    assert.deepStrictEqual(res, { ok: true });
  });

  await t('404が最大リトライ回数を超えて続く → ApiError(http)で諦める', async () => {
    mockFetchSequence([{ ok: false, status: 404 }]); // 常に404
    let threw = null;
    try { await api('hint', {}); } catch (e) { threw = e; }
    assert.ok(threw instanceof ApiError);
    assert.strictEqual(threw.kind, 'http');
  }, 8000);

  await t('400（リトライ対象外のHTTPエラー）は即座にApiError', async () => {
    mockFetchSequence([{ ok: false, status: 400 }]);
    let threw = null;
    try { await api('hint', {}); } catch (e) { threw = e; }
    assert.ok(threw instanceof ApiError);
    assert.strictEqual(threw.kind, 'http');
  });

  await t('アプリ側のエラー応答({error:...})はリトライしない', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ error: 'budget', message: '上限です' }) }; };
    let threw = null;
    try { await api('hint', {}); } catch (e) { threw = e; }
    assert.ok(threw instanceof ApiError);
    assert.strictEqual(threw.kind, 'budget');
    assert.strictEqual(calls, 1); // リトライしていない＝1回だけ呼ばれる
  });

  await t('fetch自体が例外(通信断)でもリトライして成功する', async () => {
    let i = 0;
    global.fetch = async () => {
      i++;
      if (i === 1) throw new Error('network down');
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const res = await api('getToday', {});
    assert.deepStrictEqual(res, { ok: true });
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
