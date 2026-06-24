// =====================================================================
// revenge.js — リベンジ再テスト（テスト効果＝思い出す行為が記憶を作る §6/§11）。
// 間違えた（不正解・惜しい）問題を数日後に「類題」（数値や題材だけ変えた変種）として
// 再出題し、答えを見せる前にまず自力で解かせる。丸暗記を防ぐため毎回同じではなく変種にする。
// 概念ごとに1件だけ待機させ、行列が無限に伸びないようにする。
// =====================================================================

var REVENGE_DELAY_DAYS = 2; // 間違えてから再出題までの日数（短い間隔で1回挟む）

// grade が間違い確定時に呼ぶ：その問題をリベンジ待ち行列に積む。
// 同じ概念に「待機」中のリベンジがあれば、最新の間違い問題に更新する（重複防止）。
function enqueueRevenge_(problemId, conceptId) {
  var due = addDaysStr_(todayStr_(), REVENGE_DELAY_DAYS);
  var rows = readRowsSafe_('revenge');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].concept_id === conceptId && rows[i].status === '待機') {
      updateRowWhere_('revenge', 'problem_id', rows[i].problem_id, { problem_id: problemId, due: due });
      return;
    }
  }
  appendRowObj_('revenge', { problem_id: problemId, concept_id: conceptId, due: due, status: '待機' });
}

// generate が呼ぶ：期限が来たリベンジを最大 max 件取り出し「出題済」に倒す。
// 返り値は [{ concept_id, source: 元問題payload }]（generate が類題スペックに変換する）
function pickDueRevenges_(max) {
  var today = todayStr_();
  var due = readRowsSafe_('revenge').filter(function (r) {
    return r.status === '待機' && r.due && r.due <= today;
  }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });

  var picked = [];
  for (var i = 0; i < due.length && picked.length < max; i++) {
    var orig = readRows_('problems').filter(function (p) { return p.problem_id === due[i].problem_id; })[0];
    // 元問題が見つからない場合もキューからは外す（情報を残しても出題できないため）
    updateRowWhere_('revenge', 'problem_id', due[i].problem_id, { status: '出題済' });
    if (!orig) continue;
    // 学習キャプチャの問題はリベンジ（未検証の類題生成）に乗せない＝§2 検証ゲートを守る
    // （通常は grade 側で積まれないが、過去データ保険としてここでも弾く）
    if (orig.source === 'capture') continue;
    var payload;
    try { payload = JSON.parse(orig.payload_json); } catch (e) { continue; }
    picked.push({ concept_id: due[i].concept_id, source: payload });
  }
  return picked;
}
