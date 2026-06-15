// =====================================================================
// drafts.js — 解答の途中保存（下書き）をサーバにも持つ（§5 saveDraft）。
// localStorage（端末内・即時・圏外可）に加えてスプレッドシートにも保存し、
// PC↔スマホで同じ問題を「続きから」開けるようにする。1問1行（upsert）。
// 読み取りは getToday がまとめて返す（個別取得の通信を増やさない）。
// =====================================================================

function actionSaveDraft_(body) {
  var problemId = String(body.problem_id || '');
  if (!problemId) return { error: 'bad_request', message: 'problem_id がありません。ホームからやり直してください' };

  var code = String(body.code || '');
  var hints = Array.isArray(body.hints) ? body.hints : [];
  var asks = Array.isArray(body.asks) ? body.asks : [];
  var hintUsed = body.hint_used === true;
  if (code.length > 20000) return { error: 'bad_request', message: 'コードが長すぎます。短くしてください' };

  // 中身が空（コードもヒントも質問も無い）なら下書きを消して掃除する
  if (!code && hints.length === 0 && asks.length === 0) {
    deleteDraftRow_(problemId);
    return { ok: true, cleared: true };
  }

  var row = {
    problem_id: problemId,
    updated_at: nowIso_(),
    code: code,
    hints_json: JSON.stringify(hints),
    asks_json: JSON.stringify(asks),
    hint_used: hintUsed ? 'TRUE' : 'FALSE'
  };
  if (!updateRowWhere_('drafts', 'problem_id', problemId, row)) {
    appendRowObj_('drafts', row);
  }
  return { ok: true };
}

// 指定problemの下書き行を削除する（無ければ何もしない）
function deleteDraftRow_(problemId) {
  var rows = readRowsSafe_('drafts');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].problem_id === problemId) {
      getSheet_('drafts').deleteRow(rows[i]._rowIndex);
      return;
    }
  }
}

// getToday が呼ぶ：未回答問題の下書きを {problem_id: {...}} で返す。
// drafts タブ未作成（migrate前）でも空オブジェクトで動く
function draftsForProblems_(problemIds) {
  var want = {};
  problemIds.forEach(function (id) { want[id] = true; });
  var map = {};
  readRowsSafe_('drafts').forEach(function (d) {
    if (!want[d.problem_id]) return;
    map[d.problem_id] = {
      code: d.code,
      hints: safeParseArray_(d.hints_json),
      asks: safeParseArray_(d.asks_json),
      hint_used: d.hint_used === 'TRUE',
      updated_at: d.updated_at
    };
  });
  return map;
}

function safeParseArray_(s) {
  try { var v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
