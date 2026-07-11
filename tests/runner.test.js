// =====================================================================
// runner.test.js — 全角記号の検出・自動修正の純関数テスト。
// 実行: node tests/runner.test.js
// スマホのキーボードが " を ” に変える罠（unterminated string literal）への対策。
// =====================================================================
const assert = require('assert');
const { Runner } = require('../docs/runner.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.error('  NG  ' + name + '\n      ' + e.message); }
}

t('半角だけのコードは警告なし(null)', () => {
  assert.strictEqual(Runner.checkInput('def gate(token):\n    return "許可"'), null); // 許可 は文字列内なのでOK
});
t('スマート二重引用符を検出', () => {
  const w = Runner.checkInput('print(gate(“secret123”))'); // “ ”
  assert.ok(w && w.indexOf('"') !== -1, 'should warn about double quotes');
});
t('スマート一重引用符を検出', () => {
  assert.ok(Runner.checkInput('x = ‘a’'));
});
t('全角括弧・全角コロン・全角スペースを検出', () => {
  assert.ok(Runner.checkInput('print（x）'));   // （ ）
  assert.ok(Runner.checkInput('if x：'));            // ：
  assert.ok(Runner.checkInput('def f():\n　return 1')); // 全角スペース
});

t('fixInput: スマート引用符を半角へ', () => {
  assert.strictEqual(Runner.fixInput('print(gate(“secret123”))'), 'print(gate("secret123"))');
});
t('fixInput: 全角括弧・コロン・スペースを半角へ', () => {
  assert.strictEqual(Runner.fixInput('if x：\n　print（x）'), 'if x:\n print(x)');
});
t('fixInput 後は checkInput が null（直っている）', () => {
  const fixed = Runner.fixInput('gate(“ok”)　');
  assert.strictEqual(Runner.checkInput(fixed), null);
});
t('文字列内の日本語は壊さない', () => {
  const code = 'def gate(t):\n    return "許可"'; // 許可
  assert.strictEqual(Runner.fixInput(code), code); // 変えない
});

// ---- afterMarker: テスト呼び出しの出力だけを取り出す（学習者の余分なprintに惑わされない）----
const M = Runner.RUN_MARKER;
t('afterMarker: 学習者のprintがあってもマーカー後だけ取り出す', () => {
  // 学習者が print(gate("secret123")) を書いていて、その後にテストのマーカー＋呼び出し
  const stdout = '許可\n' + M + '\n許可\n';
  assert.strictEqual(Runner.afterMarker(stdout), '許可\n');
});
t('afterMarker: 余分なprintが複数行でも最後の呼び出し出力だけ', () => {
  const stdout = 'デバッグ1\nデバッグ2\n' + M + '\nTrue\n';
  assert.strictEqual(Runner.afterMarker(stdout), 'True\n');
});
t('afterMarker: マーカーが無ければそのまま返す（エラー時など）', () => {
  assert.strictEqual(Runner.afterMarker('Traceback...'), 'Traceback...');
});
t('afterMarker: 空の呼び出し出力（空文字返り）も扱える', () => {
  const stdout = 'なにか\n' + M + '\n\n'; // print("") 相当
  assert.strictEqual(Runner.afterMarker(stdout), '\n');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
