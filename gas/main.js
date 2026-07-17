// =====================================================================
// main.js — doPost ルーター（信頼境界の一点集約・§9）
// 全リクエストを毎回検証する：トークン照合 → 入力検証 → 各actionへ。
// クライアントは Content-Type: text/plain でJSONをPOSTする（CORSプリフライト回避）
// （GAS自動デプロイ動作確認用の無害な変更）
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
    if (action === 'captureMatch') return actionCaptureMatch_(body); // §5 名寄せ（読み取りのみ・LLM不使用）
    if (action === 'clearNotice') { setConf_('model_notice', ''); setConf_('theme_notice', ''); return { ok: true }; }

    // LLM呼び出し系（hint / ask / captureCandidates / grade）はロックを取らない。
    // 以前は全actionを1本のロックで直列化していたが、LLM応答に10〜30秒かかる間
    // 他の操作が全部「別の処理が実行中」で弾かれる主因だった。これらは
    // 採番（last_problem_number）・FSRS・問題statusを一切書かないため直列化不要
    // （budgetカウンタは最悪1回ぶんの数え漏れ、asksへの追記はappendRowが行単位で安全）。
    // grade だけは書き込みがあるが、LLM解説を済ませた後の finalizeAttempt_ 内部で短くロックする
    if (action === 'hint') return actionHint_(body);
    if (action === 'ask') return actionAsk_(body);
    if (action === 'captureCandidates') return actionCaptureCandidates_(body);
    if (action === 'grade') return actionGrade_(body);

    // 書き込み系はスクリプトロックで直列化（採番・状態更新の競合を根絶 §5）。
    // どれもLLMを呼ばない、または呼んでも短い（generateのみ長いが採番があるため必須）
    if (action === 'generate' || action === 'saveSelfNote' || action === 'saveDraft' ||
        action === 'capture' || action === 'commitProblems' || action === 'discardProblem') {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(30 * 1000)) {
        return { error: 'busy', message: '別の処理が実行中です。数秒待ってからもう一度お試しください' };
      }
      try {
        if (action === 'generate') return actionGenerate_(body);
        if (action === 'saveSelfNote') return actionSaveSelfNote_(body);
        if (action === 'discardProblem') return actionDiscardProblem_(body);
        if (action === 'saveDraft') return actionSaveDraft_(body);
        if (action === 'capture') return actionCapture_(body);
        if (action === 'commitProblems') return actionCommitProblems_(body);
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
  var masteredList = concepts.filter(function (c) { return c.state === '習得'; })
    .map(function (c) { return c.concept_id; });
  var mastered = masteredList.length;
  var today = todayStr_();
  var dueCount = concepts.filter(function (c) {
    return c.state === '習得' && c.no_review !== 'TRUE' && c.due && c.due <= today;
  }).length;

  // ストリーク（❄️週1フリーズつき）と週間ゴール（§11 Phase2: 赦しの設計）
  var sinfo = streakInfo_(attemptDays_(), todayStr_(), Number(getConf_('weekly_goal_days', 5)));

  return {
    problems: problems,
    summary: {
      mastered: mastered,
      total: concepts.length,
      due_count: dueCount,
      streak: sinfo.streak,
      streak_freeze_used: sinfo.freeze_used_this_week, // ❄️ 今週の身代わりを使ったか（表示用）
      week_days: sinfo.week_days,                      // 今週の活動日数（月〜今日）
      weekly_goal: sinfo.weekly_goal,                  // 週の目標日数（config: weekly_goal_days）
      build_day: Number(getConf_('build_day', 6)),     // 🏗 ビルド日（0=日…6=土。config: build_day）
      bottleneck: recentBottleneck_()
    },
    // 各問題の下書き（PC↔スマホ共有）。フロントは開いた問題を続きから復元する
    drafts: draftsForProblems_(problems.map(function (p) { return p.problem_id; })),
    // 習得済み概念のID一覧（フロントの「解放ツール」棚がどれを解放するか判定する §11）
    mastered_concepts: masteredList,
    // 本で読んで捕捉した概念の現況（学習キャプチャ §1）。残り問題数・due を返し、
    // 残り0かつdue到来は「もう一度練習を作る」候補としてホームに出す
    captures: captureConceptsSummary_(),
    // 過去に使った出典（本のタイトル）。捕捉フォームで選べるようにする（同じ本の別章を打ち直さない）
    capture_sources: captureSources_(),
    // セキュリティ題材の自動解放のお祝い（§6）とモデル通知（§5b）を1つのバナーに集約。
    // [OK]（clearNotice）で両方クリアされる
    notice: [getConf_('theme_notice', ''), getConf_('model_notice', '')]
      .filter(function (s) { return s; }).join('\n')
  };
}

// 「今のボトルネック」: 直近の解答で最も多い error_pattern を返す（実質ミス種別が付いた直近20件）。
// 苦手を克服すると表示も切り替わる（通算ではなく“いまの弱点”を指すため）。
// 直近にミスが無ければ通算トップのmistakeにフォールバック（情報を空にしない）
function recentBottleneck_() {
  // 読む/並べる/穴埋め/組む型（予測・説明・和訳・トレース・並べ替え・組む）は正誤に関わらず
  // error_pattern が常に「なし」で記録される（§15）。これらを含めたまま「直近20件」を取ると、
  // 実際にミス種別が付く「書く」型の解答が薄まってしまい、いつまでも直近ミスが見つからず
  // 通算フォールバックに落ち続ける（＝表示が実質固定される）不具合があった。
  // ミス種別が付いた解答だけに絞ってから直近20件を見る（練習/再挑戦も除外）
  var recent = readRows_('attempts')
    .filter(function (a) { return a.mode !== '練習' && a.error_pattern && a.error_pattern !== 'なし'; })
    .slice(-20);
  var counts = {};
  recent.forEach(function (a) {
    var p = a.error_pattern;
    counts[p] = (counts[p] || 0) + 1;
  });
  var best = '';
  var bestN = 0;
  Object.keys(counts).forEach(function (p) {
    if (counts[p] > bestN) { bestN = counts[p]; best = p; }
  });
  if (best) return best;
  var top = topMistakes_()[0];
  return top ? top.pattern : '';
}

// attempts から「活動した日」の一覧を返す（ストリーク計算の材料。streak.js が純関数で判定する）
function attemptDays_() {
  var days = {};
  readRows_('attempts').forEach(function (a) {
    if (a.timestamp) days[a.timestamp.slice(0, 10)] = true;
  });
  return Object.keys(days);
}

// ---------------------------------------------------------------------
// discardProblem — 壊れた問題を1タップで捨てる（学習を永久に詰まらせない）。
// 生成された問題のコードが実行できない等でその問題が進められない時、status='破棄' にして
// ホームの「今日の問題」から消す。attempts には書かない＝FSRS・昇級・ミス集計に一切影響しない。
// ---------------------------------------------------------------------
function actionDiscardProblem_(body) {
  var problemId = String(body.problem_id || '');
  if (!problemId) return { error: 'bad_request', message: 'problem_id がありません。ホームからやり直してください' };
  if (!updateRowWhere_('problems', 'problem_id', problemId, { status: '破棄' })) {
    return { error: 'not_found', message: '対象の問題が見つかりません。ホームを再読み込みしてください' };
  }
  return { ok: true };
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
