// =====================================================================
// grade.js — 採点ロジック（§7）。
// 正誤は【コードが stdout と expected_output の比較で確定】する。
// LLMの役割はヒント生成と解説のみ（正誤フラグを渡してから依頼する）。
// =====================================================================

function actionGrade_(body) {
  // --- 入力検証（§9: クライアント入力は長さ・型を検証してから使う） ---
  var problemId = String(body.problem_id || '');
  var code = String(body.code || '');
  var stdout = String(body.stdout || '');
  var stderr = String(body.stderr || '');
  var stage = body.stage === 'full' ? 'full' : 'hint';
  var hintUsed = body.hint_used === true;
  var easy = body.easy === true; // UIの「余裕だった」タップ
  // 過去問の「再挑戦」（練習モード）。記録は残すが学習計画には混ぜない（後述 finalizeAttempt_）
  var practice = body.mode === 'practice';
  // この問題で表示したヒント（履歴に残すためフロントから受け取る）
  var hints = Array.isArray(body.hints)
    ? body.hints.filter(function (h) { return typeof h === 'string' && h; }).slice(0, 5)
    : [];
  if (!problemId) return { error: 'bad_request', message: 'problem_id がありません。ホームからやり直してください' };
  if (code.length > 20000 || stdout.length > 20000 || stderr.length > 20000) {
    return { error: 'bad_request', message: '入力が長すぎます。コードと出力を短くしてください' };
  }

  var prow = readRows_('problems').filter(function (p) { return p.problem_id === problemId; })[0];
  if (!prow) return { error: 'not_found', message: '問題が見つかりません。ホームを再読み込みしてください' };
  var payload = JSON.parse(prow.payload_json);

  // --- Stage1: 予測（トレース）。正誤は「予測した出力」と「実際の出力(Pyodide実行)」の一致で決める。
  // LLMは使わない（Pyodideが正解の出力をくれる）。書く力の前段を低負荷で鍛える（§スキルラダー） ---
  if (payload.type === '予測') {
    var prediction = String(body.prediction || '');
    var actual = String(body.actual || '');
    if (!prediction) return { error: 'bad_request', message: '出力の予測を入力してください' };
    var okTrace = normalizedEquals_(prediction, actual);
    return finalizeAttempt_(prow, payload, {
      code: '予測: ' + prediction, stdout: actual, stderr: '',
      verdict: okTrace ? '正解' : '不正解', hintUsed: false, easy: false,
      errorPattern: 'なし', explanation: null, modelUsed: '', hints: [],
      suggestion: '', practice: practice, isTrace: true
    });
  }

  if (!code) return { error: 'bad_request', message: 'コードが空です。コードを書いてから採点してください' };

  // --- 一次判定はコード（§7）。Tracebackありは自動的に不正解 ---
  var isCorrect = stderr.indexOf('Traceback') === -1 &&
    normalizedEquals_(stdout, payload.expected_output);

  if (isCorrect) {
    // 正解は「正解！」で十分。ただし「こう書くともっと良い」一言があれば添える（本人の希望）
    var suggestion = correctSuggestion_(payload, code);
    return finalizeAttempt_(prow, payload, {
      code: code, stdout: stdout, stderr: stderr,
      verdict: '正解', hintUsed: hintUsed, easy: easy,
      errorPattern: 'なし', explanation: null, modelUsed: '', hints: hints,
      suggestion: suggestion, practice: practice
    });
  }

  if (stage === 'hint') {
    // hint段階：誘導質問のみ返す。attemptsには書かない（full確定時にまとめて記録）
    var hintRes = askHints_(payload, code, stdout, stderr);
    return { stage: 'hint', verdict: '不正解', hints: hintRes.hints, model_used: hintRes.model_used };
  }

  // full段階の不正解：LLMに解説を依頼（落ちても採点自体は成立させる）
  var explanation = null;
  var modelUsed = '';
  try {
    var res = callGemini_({
      system: gradeSystemPrompt_(),
      user: gradeUserPrompt_(payload, code, stdout, stderr),
      schema: gradeFullSchema_(),
      temperature: 0.2
    });
    explanation = validateExplanation_(res.json);
    modelUsed = res.model_used;
  } catch (e) {
    if (e && e.code === 'budget') throw e; // 予算超過はそのまま上へ
    explanation = null; // LLM障害でも正誤判定は既に確定している
  }
  // 「惜しい」はLLMの方針判定によるコード側の格上げ（最終確定はコード §7）
  var verdict = explanation && explanation.verdict_hint === '惜しい' ? '惜しい' : '不正解';
  return finalizeAttempt_(prow, payload, {
    code: code, stdout: stdout, stderr: stderr,
    verdict: verdict, hintUsed: hintUsed, easy: false,
    errorPattern: explanation ? explanation.error_pattern : 'その他',
    explanation: explanation, modelUsed: modelUsed, hints: hints, practice: practice
  });
}

// 末尾改行・行末空白を吸収して比較（§7の正規化比較）
function normalizedEquals_(a, b) {
  function norm(s) {
    return String(s).replace(/\r\n/g, '\n').split('\n')
      .map(function (line) { return line.replace(/\s+$/, ''); })
      .join('\n').replace(/\n+$/, '');
  }
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------
// full確定時のコード側処理（§7: attempts追記・FSRS・昇級・mistakes）
// ---------------------------------------------------------------------
function finalizeAttempt_(prow, payload, r) {
  var attemptId = Utilities.getUuid();
  appendRowObj_('attempts', {
    attempt_id: attemptId,
    timestamp: nowIso_(),
    problem_id: prow.problem_id,
    concept_id: prow.concept_id,
    type: prow.type,
    verdict: r.verdict,
    hint_used: r.hintUsed ? 'TRUE' : 'FALSE',
    error_pattern: r.errorPattern || 'なし',
    self_note: '',
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    model_used: r.modelUsed,
    // もらったヒントとフル解説を履歴用に保存（後から振り返れるように §5）
    feedback_json: JSON.stringify({ hints: r.hints || [], explanation: r.explanation || null }),
    mode: r.practice ? '練習' : '本番'
  });

  // 過去問の「再挑戦」（練習モード）は、履歴とストリークにだけ残す。
  // FSRS・昇級/降格・難易度クランプ・ミス集計・リベンジには一切影響させない
  // （詰め込み正解で復習スケジュールを乱したり、遊びの誤答で降格させないため）。
  if (r.practice) {
    return {
      stage: 'full',
      attempt_id: attemptId,
      verdict: r.verdict,
      expected_output: payload.expected_output,
      explanation: r.explanation,
      explanation_failed: r.verdict !== '正解' && r.explanation === null,
      suggestion: r.suggestion || '',
      state_change: null, // 練習では昇級も降格もしない
      practice: true,
      model_used: r.modelUsed
    };
  }

  updateRowWhere_('problems', 'problem_id', prow.problem_id, { status: '採点済' });

  // FSRS rating（§7-2）: 不正解→Again / 惜しい→Hard / ヒントあり正解→Hard / ノーヒント正解→Good（余裕→Easy）
  var rating;
  if (r.verdict === '不正解') rating = FSRS.Rating.Again;
  else if (r.verdict === '惜しい') rating = FSRS.Rating.Hard;
  else if (r.hintUsed) rating = FSRS.Rating.Hard;
  else rating = r.easy ? FSRS.Rating.Easy : FSRS.Rating.Good;

  var change = updateConceptAfterAttempt_(prow.concept_id, r.verdict, r.hintUsed, rating, r.isTrace);

  if (r.errorPattern && r.errorPattern !== 'なし') bumpMistake_(r.errorPattern);

  // 間違えた問題は数日後に類題で再出題するキューへ（テスト効果 §6）。
  // revengeタブ未作成（migrate前）でも採点は止めない。
  // ※ 予測（読む段）の外しは「書く」リベンジに積まない（種別がちぐはぐになるため）
  if (r.verdict !== '正解' && !r.isTrace) {
    try { enqueueRevenge_(prow.problem_id, prow.concept_id); } catch (e) { /* 後でmigrateすれば有効に */ }
  }

  return {
    stage: 'full',
    attempt_id: attemptId,
    verdict: r.verdict,
    expected_output: payload.expected_output,
    explanation: r.explanation, // 正解時とLLM障害時は null（フロントは定型表示）
    explanation_failed: r.verdict !== '正解' && r.explanation === null,
    suggestion: r.suggestion || '', // 正解時の「もっと良くする一言」（無ければ空）
    state_change: change, // 昇級・降格があれば {concept, from, to}
    practice: false,
    model_used: r.modelUsed
  };
}

// 正解コードに対する「もっと良く書く一言」を1つだけ返す（無ければ空文字）。
// 予算超過・LLM障害でも正解の確定は止めないよう、失敗は飲み込む
function correctSuggestion_(payload, code) {
  try {
    var res = callGemini_({
      system: [
        'あなたはPython完全初心者の家庭教師。正解できたコードを、より良く書く提案が1つだけあれば短く返す。JSONのみ。',
        '- 提案が無ければ suggestion は空文字にする（無理にひねり出さない）。',
        '- 1文だけ。専門用語には短い説明。説教やお世辞はしない。',
        '- 例:「if x == True より if x: の方が簡潔です（==Trueは省ける）」'
      ].join('\n'),
      user: '# 問題\n' + payload.statement + '\n# 正解できたコード\n' + code +
        '\n\nこのコードを、より良く/簡潔にする一言の提案が1つあれば。無ければ空文字。',
      schema: { type: 'OBJECT', properties: { suggestion: { type: 'STRING' } }, required: ['suggestion'] },
      temperature: 0.2
    });
    return res.json && typeof res.json.suggestion === 'string' ? res.json.suggestion.trim() : '';
  } catch (e) {
    return ''; // 予算超過などでも「正解！」は返す
  }
}

// ---------------------------------------------------------------------
// concepts のFSRSカード更新と昇級・降格判定（§7-2,3）
// ---------------------------------------------------------------------
function updateConceptAfterAttempt_(conceptId, verdict, hintUsed, rating, isTrace) {
  var c = readRows_('concepts').filter(function (x) { return x.concept_id === conceptId; })[0];
  if (!c) return null;

  // FSRSカードを復元してスケジュール更新。短期ステップは使わない（1日1セッション運用のため）
  var scheduler = FSRS.fsrs(FSRS.generatorParameters({ enable_fuzz: false, enable_short_term: false }));
  var next = scheduler.next(loadCard_(c), new Date(), rating).card;
  var updates = {
    due: dateStr_(next.due),
    stability: Math.round(next.stability * 10000) / 10000,
    difficulty: Math.round(next.difficulty * 10000) / 10000,
    reps: next.reps,
    lapses: next.lapses,
    last_review: todayStr_()
  };

  // 読む段（予測/トレース）は FSRS のスケジュールだけ動かし、昇級材料(nohint)や状態遷移には
  // 触れない＝「習得」は書く段（Stage3）で判定する（§スキルラダー calibration）
  if (isTrace) {
    updateRowWhere_('concepts', 'concept_id', conceptId, updates);
    return null;
  }

  // ノーヒント連続正解数（ヒント利用・不正解・惜しいで途切れる）
  var nohintCorrect = verdict === '正解' && !hintUsed;
  updates.nohint_streak = nohintCorrect ? Number(c.nohint_streak || 0) + 1 : 0;

  // 昇級材料：ノーヒント正解した日付の集合（同日2回はカウントしない §7-3）
  var days = String(c.nohint_correct_days || '').split(',').filter(String);
  if (nohintCorrect && days.indexOf(todayStr_()) === -1) days.push(todayStr_());
  updates.nohint_correct_days = days.join(',');

  // 状態遷移
  var change = null;
  if (c.state === '未') {
    updates.state = '練習中'; // 初めて取り組んだら練習中へ
    change = { concept: c.name, from: '未', to: '練習中' };
  } else if (c.state === '練習中' && days.length >= 2) {
    updates.state = '習得'; // 異なる日付で2日分のノーヒント正解 → 昇級
    change = { concept: c.name, from: '練習中', to: '習得' };
  } else if (c.state === '習得' && verdict !== '正解') {
    updates.state = '練習中'; // 降格＋7日後に再確認
    updates.due = addDaysStr_(todayStr_(), 7);
    updates.nohint_correct_days = ''; // 昇級材料はやり直し
    change = { concept: c.name, from: '習得', to: '練習中' };
  }

  updateRowWhere_('concepts', 'concept_id', conceptId, updates);
  return change;
}

// シートの行から ts-fsrs のカードを復元する。
// FSRSのstate列は持たない設計（§4）なので reps から New/Review を導出する
function loadCard_(c) {
  if (!Number(c.reps || 0)) return FSRS.createEmptyCard(new Date());
  var lastReview = c.last_review ? new Date(c.last_review + 'T00:00:00') : new Date();
  var due = c.due ? new Date(c.due + 'T00:00:00') : new Date();
  return {
    due: due,
    stability: Number(c.stability || 0.1),
    difficulty: Number(c.difficulty || 5),
    elapsed_days: 0,
    scheduled_days: Math.max(0, Math.round((due - lastReview) / 86400000)),
    reps: Number(c.reps),
    lapses: Number(c.lapses || 0),
    learning_steps: 0,
    state: FSRS.State.Review,
    last_review: lastReview
  };
}

// ---------------------------------------------------------------------
// LLMヒント（hint段階）。LLMが落ちても定型ヒントで学習を止めない
// ---------------------------------------------------------------------
function askHints_(payload, code, stdout, stderr) {
  try {
    var res = callGemini_({
      system: gradeSystemPrompt_(),
      user: gradeUserPrompt_(payload, code, stdout, stderr) +
        '\n\nこの解答は不正解だった。答え（正解コード）は絶対に明かさず、本人が自力で気づける誘導質問を最大2つ返して。' +
        'stderrにTracebackがあれば「最後の行のエラー名と行番号から読む」という読み方のヒントを1つ含めて。',
      schema: { type: 'OBJECT', properties: { hints: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['hints'] },
      temperature: 0.2
    });
    var hints = res.json && Array.isArray(res.json.hints)
      ? res.json.hints.filter(function (h) { return typeof h === 'string' && h; }).slice(0, 2)
      : [];
    if (hints.length > 0) return { hints: hints, model_used: res.model_used };
  } catch (e) {
    if (e && e.code === 'budget') throw e;
  }
  // 定型フォールバック（黙って失敗しない §14）
  return {
    hints: [stderr.indexOf('Traceback') !== -1
      ? 'Tracebackは最後の行から読みます。エラーの種類（例: NameError）と、何行目で起きたかをまず確認してみよう'
      : '期待される出力と自分の出力を1行ずつ見比べて、最初に違いが出た行に注目してみよう'],
    model_used: ''
  };
}

// ---------------------------------------------------------------------
// Gemini 採点プロンプト・スキーマ（§7）
// ---------------------------------------------------------------------
function gradeSystemPrompt_() {
  return [
    'あなたはPython完全初心者の家庭教師。正誤判定は既にコードが済ませており、あなたの役割はヒントと解説だけ。JSONのみを出力する。',
    '- すべて日本語。専門用語には毎回その場で短い説明を添える',
    '【簡潔さ最優先】ダラダラ説明しない：',
    '- what_differs は1〜2文。why は1文。one_point は1文。',
    '- line_by_line は「間違いに直接関係する行だけ」を最大3つ。正しい行を一つずつ褒め称えない。',
    '- 本人を励ます調子で、ただし誤りは具体的に指摘する'
  ].join('\n');
}

function gradeUserPrompt_(payload, code, stdout, stderr) {
  return ['# 問題', JSON.stringify({
    statement: payload.statement, conditions: payload.conditions,
    example_call: payload.example_call, expected_output: payload.expected_output,
    buggy_code: payload.buggy_code || null
  }), '# 本人のコード', code, '# 実行結果 stdout', stdout || '(出力なし)',
    '# 実行結果 stderr', stderr || '(エラーなし)',
    '# コードによる確定判定', '不正解（期待される出力と一致しなかった）'].join('\n');
}

function gradeFullSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      verdict_hint: { type: 'STRING', enum: ['惜しい', '不正解'] },
      correct_code: { type: 'STRING' },
      what_differs: { type: 'STRING' },
      line_by_line: { type: 'ARRAY', items: { type: 'STRING' } },
      why: { type: 'STRING' },
      error_pattern: {
        type: 'STRING',
        enum: ['未定義変数', 'range+1忘れ', '更新方向逆', '比較対象ミス', 'return忘れ',
          'スペルミス', '初期値設計', 'その他', 'なし']
      },
      one_point: { type: 'STRING' }
    },
    required: ['verdict_hint', 'correct_code', 'what_differs', 'line_by_line', 'why', 'error_pattern', 'one_point']
  };
}

// LLM解説のスキーマ検証（通らなければ null = 解説なしで採点続行）
function validateExplanation_(json) {
  if (!json) return null;
  var strings = ['verdict_hint', 'correct_code', 'what_differs', 'why', 'error_pattern', 'one_point'];
  for (var i = 0; i < strings.length; i++) {
    if (typeof json[strings[i]] !== 'string' || !json[strings[i]]) return null;
  }
  if (!Array.isArray(json.line_by_line)) return null;
  return json;
}
