// =====================================================================
// main.js — doPost ルーター（信頼境界の一点集約・§9）
// 全リクエストを毎回検証する：トークン照合 → 入力検証 → 各actionへ。
// クライアントは Content-Type: text/plain でJSONをPOSTする（CORSプリフライト回避）
// =====================================================================

function doPost(e) {
  var result = handleRequest_(e);
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest_(e) {
  // 1) JSONとして読めるか（読めない入力は何もせず拒否 = fail closed）
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return { error: 'bad_request', message: 'リクエストの形式が不正です。アプリを再読み込みしてください' };
  }

  // 2) 毎リクエストのトークン照合（セッションという暗黙の信頼を作らない）
  var expected = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
  if (!expected || String(body.token || '') !== expected) {
    return { error: 'unauthorized', message: '認証に失敗しました。config.js のTOKEN設定を確認してください' };
  }

  var action = String(body.action || '');
  try {
    // 読み取り系はロック不要
    if (action === 'getToday') return actionGetToday_();
    if (action === 'getHistory') return actionGetHistory_(body);
    if (action === 'clearNotice') { setConf_('model_notice', ''); return { ok: true }; }

    // 書き込み系＋予算消費系はスクリプトロックで直列化
    // （採番・FSRS更新の競合と、予算カウンタ llm_budget_used の競合を根絶）
    if (action === 'generate' || action === 'grade' || action === 'saveSelfNote' || action === 'ask') {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(30 * 1000)) {
        return { error: 'busy', message: '別の処理が実行中です。数秒待ってからもう一度お試しください' };
      }
      try {
        if (action === 'generate') return actionGenerate_(body);
        if (action === 'grade') return actionGrade_(body);
        if (action === 'saveSelfNote') return actionSaveSelfNote_(body);
        if (action === 'ask') return actionAsk_(body);
      } finally {
        lock.releaseLock();
      }
    }
    return { error: 'unknown_action', message: '不明な操作です。アプリを最新版に更新してください' };
  } catch (err) {
    if (err && err.code === 'budget') return { error: 'budget', message: err.message };
    if (err && err.code === 'llm_failed') return { error: 'llm_failed', message: err.message };
    return { error: 'internal', message: 'サーバ内部でエラーが発生しました（' + err.message + '）。もう一度お試しください' };
  }
}

// ---------------------------------------------------------------------
// getToday — 未回答問題リスト＋現在地サマリ（読み取りのみ）
// ---------------------------------------------------------------------
function actionGetToday_() {
  maybeHealthCheckModels_(); // §5b 週次ヘルスチェック

  var problems = readRows_('problems')
    .filter(function (p) { return p.status === '未回答'; })
    .map(function (p) {
      var payload;
      try { payload = JSON.parse(p.payload_json); } catch (e) { payload = null; }
      return { problem_id: p.problem_id, type: p.type, payload: payload };
    })
    .filter(function (p) { return p.payload !== null; });

  var concepts = readRows_('concepts');
  var mastered = concepts.filter(function (c) { return c.state === '習得'; }).length;
  var today = todayStr_();
  var dueCount = concepts.filter(function (c) {
    return c.state === '習得' && c.no_review !== 'TRUE' && c.due && c.due <= today;
  }).length;

  var top = topMistakes_()[0];
  return {
    problems: problems,
    summary: {
      mastered: mastered,
      total: concepts.length,
      due_count: dueCount,
      streak: calcStreak_(),
      bottleneck: top ? top.pattern : ''
    },
    notice: getConf_('model_notice', '')
  };
}

// attempts の日付から連続学習日数を算出（今日または昨日から途切れず遡れる日数）
function calcStreak_() {
  var days = {};
  readRows_('attempts').forEach(function (a) {
    if (a.timestamp) days[a.timestamp.slice(0, 10)] = true;
  });
  var d = new Date();
  // 今日まだ解いていなくてもストリークは昨日まで生きている扱い
  if (!days[dateStr_(d)]) d.setDate(d.getDate() - 1);
  var streak = 0;
  while (days[dateStr_(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---------------------------------------------------------------------
// saveSelfNote — 「原因を自分の言葉で1行」を attempts に書き戻す
// ---------------------------------------------------------------------
function actionSaveSelfNote_(body) {
  var attemptId = String(body.attempt_id || '');
  var note = String(body.note || '');
  if (!attemptId) return { error: 'bad_request', message: 'attempt_id がありません。採点からやり直してください' };
  if (note.length > 300) return { error: 'bad_request', message: 'メモは300文字以内にしてください' };
  if (!updateRowWhere_('attempts', 'attempt_id', attemptId, { self_note: note })) {
    return { error: 'not_found', message: '対象の解答記録が見つかりません。ホームに戻って続けてください' };
  }
  return { ok: true };
}
