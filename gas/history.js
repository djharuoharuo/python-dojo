// =====================================================================
// history.js — 過去問・自分の解答・した質問を見返すための読み取りAPI（§5 getHistory）。
// attempts（解答記録）に problems（問題文）と asks（質問ログ）を結合して返す。
// 読み取りのみ＝ロック不要。LLMは使わない。
// =====================================================================

function actionGetHistory_(body) {
  var limit = Math.min(Math.max(Number(body.limit || 30), 1), 100);

  // 問題文（payload）を problem_id で引けるようにする
  var problems = {};
  readRows_('problems').forEach(function (p) {
    try { problems[p.problem_id] = JSON.parse(p.payload_json); } catch (e) { /* 壊れた行は無視 */ }
  });

  // 質問ログを problem_id ごとにまとめる（asksタブ未作成でも空配列で動く）
  var asksByProblem = {};
  readRowsSafe_('asks').forEach(function (a) {
    (asksByProblem[a.problem_id] = asksByProblem[a.problem_id] || [])
      .push({ question: a.question, answer: a.answer });
  });

  // 新しい順に limit 件。各 attempt に問題文と質問を結合して返す
  var attempts = readRows_('attempts');
  var items = attempts.slice(-limit).reverse().map(function (a) {
    var pl = problems[a.problem_id] || {};
    // 採点時に保存したヒント・フル解説（古い記録には無いので空に倒す）
    var feedback = {};
    try { feedback = JSON.parse(a.feedback_json || '{}') || {}; } catch (e) { feedback = {}; }
    return {
      timestamp: a.timestamp,
      number: pl.number || '',
      title: pl.title || '(問題不明)',
      statement: pl.statement || '',
      type: a.type,
      verdict: a.verdict,
      hint_used: a.hint_used === 'TRUE',
      error_pattern: a.error_pattern,
      self_note: a.self_note,
      code: a.code,
      expected_output: pl.expected_output || '',
      stdout: a.stdout,
      hints: Array.isArray(feedback.hints) ? feedback.hints : [],
      explanation: feedback.explanation || null,
      asks: asksByProblem[a.problem_id] || []
    };
  });

  return { items: items };
}
