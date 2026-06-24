// =====================================================================
// capture.test.js — 学習キャプチャの純関数スモークテスト（Node実行・依存なし）。
// 実行: node tests/capture.test.js
// gas/ の外に置く＝clasp push の対象外（GASには送られない）。
// ここで守りたいのは §2 検証ゲートの土台（名寄せ・禁止要素の検出・候補整形）が
// 期待どおり動くこと。Pyodide実行そのものは実機テスト（フロント）で確認する。
// =====================================================================
const assert = require('assert');
const cap = require('../gas/capture.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.error('  NG  ' + name + '\n      ' + e.message); }
}

// ---- captureCodeAllowed_：非決定的・環境依存コードを弾く（§2）----
t('決定的なコードは許可', () => {
  assert.strictEqual(cap.captureCodeAllowed_('total = 0\nfor i in range(5):\n    total += i\nprint(total)'), true);
});
t('input() を弾く', () => {
  assert.strictEqual(cap.captureCodeAllowed_('x = input()\nprint(x)'), false);
});
t('random を弾く', () => {
  assert.strictEqual(cap.captureCodeAllowed_('import random\nprint(random.randint(1,9))'), false);
});
t('datetime / now を弾く', () => {
  assert.strictEqual(cap.captureCodeAllowed_('import datetime\nprint(datetime.datetime.now())'), false);
  assert.strictEqual(cap.captureCodeAllowed_('import time\nprint(time.time())'), false);
});
t('open / os を弾く', () => {
  assert.strictEqual(cap.captureCodeAllowed_('open("a.txt")'), false);
  assert.strictEqual(cap.captureCodeAllowed_('import os\nprint(os.getcwd())'), false);
});
t('ネットワークを弾く', () => {
  assert.strictEqual(cap.captureCodeAllowed_('import requests\nrequests.get("http://x")'), false);
});

// ---- normalizeConceptName_：表記ゆれの吸収 ----
t('正規化：空白・記号・大小文字を吸収', () => {
  assert.strictEqual(cap.normalizeConceptName_('  Local / Global  '), 'localglobal');
  assert.strictEqual(cap.normalizeConceptName_('for ・ range'), 'forrange');
});

// ---- matchConcepts_：名寄せ（§5）----
const concepts = [
  { concept_id: 'for_range', name: 'for / range', state: '練習中', aliases: '' },
  { concept_id: 'mod', name: '剰余（%）', state: '練習中', aliases: '余り,モジュロ' },
  { concept_id: 'while', name: 'while', state: '未', aliases: '' }
];
t('完全一致は score=1.0 で先頭', () => {
  const m = cap.matchConcepts_('while', concepts);
  assert.strictEqual(m[0].concept_id, 'while');
  assert.strictEqual(m[0].score, 1.0);
});
t('別名(aliases)経由でも一致する', () => {
  const m = cap.matchConcepts_('モジュロ', concepts);
  assert.strictEqual(m[0].concept_id, 'mod');
  assert.ok(m[0].score >= 0.85, 'score should be high via alias, got ' + m[0].score);
});
t('部分一致は中スコア', () => {
  const m = cap.matchConcepts_('range', concepts);
  assert.strictEqual(m[0].concept_id, 'for_range');
  assert.ok(m[0].score >= 0.85);
});
t('無関係な新概念は候補なし（新規作成へ）', () => {
  const m = cap.matchConcepts_('デコレータ', concepts);
  assert.strictEqual(m.length, 0);
});

// ---- validateCaptureCandidates_：たねの整形＋禁止要素の再除去（§2 多層防御）----
t('正常な候補は予測タイプで返る', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [{ kind: 'predict', title: 'スコープ確認', code_to_read: 'x = 5\nprint(x)' }]
  }, 'cap_123', 'スコープ');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'predict');
  assert.strictEqual(out[0].concept_id, 'cap_123');
  assert.ok(out[0].code_to_read.indexOf('print') !== -1);
});
t('禁止要素を含む候補は破棄される', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [
      { kind: 'predict', title: 'ng', code_to_read: 'x = input()\nprint(x)' },
      { kind: 'predict', title: 'ok', code_to_read: 'print(1+1)' }
    ]
  }, 'cap_1', 'テスト');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, 'ok');
});
t('空コード・壊れた入力は空配列', () => {
  assert.strictEqual(cap.validateCaptureCandidates_({ candidates: [{ kind: 'predict', title: 'x', code_to_read: '' }] }, 'c', 'n').length, 0);
  assert.strictEqual(cap.validateCaptureCandidates_(null, 'c', 'n').length, 0);
  assert.strictEqual(cap.validateCaptureCandidates_({}, 'c', 'n').length, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
