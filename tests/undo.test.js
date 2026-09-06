// =====================================================================
// undo.test.js — 記録の取り消し(undoAttempt)の可否判定の純関数テスト。
// 実行: node tests/undo.test.js
// gas/main.js の isUndoable_ を直接テストする（Sheets読み書きはここでは検証しない）。
// =====================================================================
const assert = require('assert');
const { isUndoable_, UNDOABLE_TYPES_ } = require('../gas/main.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.error('  NG  ' + name + '\n      ' + e.message); }
}

// ---- 練習(mode='練習')は種別を問わず取り消せる（attemptsに1行残るだけで副作用が無いため）----
t('練習は復習でも取り消せる', () => {
  assert.strictEqual(isUndoable_('練習', '復習'), true);
});
t('練習はノーヒントでも取り消せる', () => {
  assert.strictEqual(isUndoable_('練習', 'ノーヒント'), true);
});
t('練習は組むでも取り消せる', () => {
  assert.strictEqual(isUndoable_('練習', '組む'), true);
});

// ---- 本番(mode='本番')は「読む/並べる」段（isTrace扱い）だけ取り消せる ----
UNDOABLE_TYPES_.forEach((type) => {
  t('本番の「' + type + '」は取り消せる', () => {
    assert.strictEqual(isUndoable_('本番', type), true);
  });
});
['復習', 'ノーヒント', 'デバッグ', '新規', '組む', '穴埋め'].forEach((type) => {
  t('本番の「' + type + '」は取り消せない（状態遷移・ミス集計・リベンジに関わるため）', () => {
    assert.strictEqual(isUndoable_('本番', type), false);
  });
});

// ---- 空欄は本番扱い（後方互換。attempts.mode の空欄は既存データにあり得る §データモデル）----
t('mode空欄は本番扱いとして判定される', () => {
  assert.strictEqual(isUndoable_('', '和訳'), true);
  assert.strictEqual(isUndoable_('', '復習'), false);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
