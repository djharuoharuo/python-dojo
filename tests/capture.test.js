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

// ---- validateCaptureCandidates_：組む(build)候補（§2 検証ゲートの書く段）----
const REF = 'def total(n):\n    s = 0\n    for i in range(1, n + 1):\n        s += i\n    return s';
t('正常なbuild候補が組むタイプで返る（参照解はフロント検証用に保持）', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [{
      kind: 'build', title: '合計を作る', statement: '1からnまでの合計を返す関数を作れ',
      function_name: 'total', conditions: ['forを使う'],
      tests: [{ call: 'total(5)', expected: '15' }, { call: 'total(1)', expected: '1' }],
      reference_solution: REF
    }]
  }, 'cap_b', '合計');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].kind, 'build');
  assert.strictEqual(out[0].function_name, 'total');
  assert.strictEqual(out[0].tests.length, 2);
  assert.ok(out[0].reference_solution, '参照解はフロント検証用に保持される（保存はしない）');
});
t('reference_solutionに禁止要素があるbuildは破棄', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [{ kind: 'build', title: 'x', statement: 's', function_name: 'f',
      tests: [{ call: 'f(1)', expected: '1' }], reference_solution: 'import random\ndef f(n):\n    return random.randint(1, n)' }]
  }, 'c', 'n');
  assert.strictEqual(out.length, 0);
});
t('テストの無いbuildは破棄', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [{ kind: 'build', title: 'x', statement: 's', function_name: 'f', tests: [], reference_solution: 'def f():\n    return 1' }]
  }, 'c', 'n');
  assert.strictEqual(out.length, 0);
});
t('test.callに禁止要素があるbuildは破棄', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [{ kind: 'build', title: 'x', statement: 's', function_name: 'f',
      tests: [{ call: 'open("a")', expected: '1' }], reference_solution: 'def f(n):\n    return n' }]
  }, 'c', 'n');
  assert.strictEqual(out.length, 0);
});
t('予測とbuildの混在を両方返す', () => {
  const out = cap.validateCaptureCandidates_({
    candidates: [
      { kind: 'predict', title: 'p', code_to_read: 'print(2)' },
      { kind: 'build', title: 'b', statement: 's', function_name: 'f', tests: [{ call: 'f(1)', expected: '1' }], reference_solution: 'def f(n):\n    return n' }
    ]
  }, 'c', 'n');
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map((x) => x.kind).sort(), ['build', 'predict']);
});
t('clampCount_ は0〜4に丸め、不正値は既定値に戻す', () => {
  assert.strictEqual(cap.clampCount_(2, 1), 2);
  assert.strictEqual(cap.clampCount_(99, 1), 4);   // 上限4
  assert.strictEqual(cap.clampCount_(0, 1), 0);    // 0は0のまま（生成しない）
  assert.strictEqual(cap.clampCount_(-5, 1), 1);   // 負値は不正→既定値に戻す
  assert.strictEqual(cap.clampCount_(undefined, 3), 3);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
