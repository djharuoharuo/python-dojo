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

  // --- Stage1: 説明（EiPE）。コードの"目的"を一言で説明させる。LLMが【寛容に】採点し、
  // 必ず模範解答を見せる（読む段＝習得には算入しない・初心者を萎えさせない §スキルラダー） ---
  if (payload.type === '説明') {
    var explanationText = String(body.explanation_text || '');
    if (!explanationText) return { error: 'bad_request', message: 'このコードが何をするか、一言で書いてください' };
    var eg = gradeEipe_(payload, explanationText);
    var result = finalizeAttempt_(prow, payload, {
      code: '説明: ' + explanationText, stdout: '', stderr: '',
      verdict: eg.ok ? '正解' : '惜しい', hintUsed: false, easy: false,
      errorPattern: 'なし', explanation: null, modelUsed: eg.model_used, hints: [],
      suggestion: '', practice: practice, isTrace: true
    });
    result.eipe_model = eg.model_answer; // 模範の一言（必ず見せる）
    result.eipe_feedback = eg.feedback;
    return result;
  }

  // --- Stage1: 和訳（コードを1行ずつ日本語に訳す）。LLMが【寛容に】各行を採点し、必ず各行の
  // お手本和訳を返す。読む段なので習得には算入しない(isTrace)。不正解で詰めない（惜しい止まり） ---
  if (payload.type === '和訳') {
    var lineDescs = Array.isArray(body.line_descs) ? body.line_descs.map(function (s) { return String(s || ''); }) : [];
    if (!lineDescs.some(function (s) { return s.trim() !== ''; })) {
      return { error: 'bad_request', message: '1行でもいいので、行の意味を日本語で書いてください' };
    }
    var wg = gradeWayaku_(payload, lineDescs);
    var wres = finalizeAttempt_(prow, payload, {
      code: '和訳: ' + lineDescs.join(' / '), stdout: '', stderr: '',
      verdict: wg.overall_ok ? '正解' : '惜しい', hintUsed: false, easy: false,
      errorPattern: 'なし', explanation: null, modelUsed: wg.model_used, hints: [],
      suggestion: '', practice: practice, isTrace: true
    });
    wres.wayaku_lines = wg.lines; // 各行の {line, ok, model} をUIへ（お手本和訳を必ず見せる）
    return wres;
  }

  // --- Stage4: 組む（仕様から白紙でプログラムを書く）。複数のテストケースで判定（実開発と同じ）。
  // 不正解でも【正解コードは絶対に出さない】（§1: 最上段で足場を外す）。組むのクリアは習得に算入する ---
  if (payload.type === '組む') {
    if (!code) return { error: 'bad_request', message: 'コードを書いてから採点してください' };
    var tests = Array.isArray(payload.tests) ? payload.tests : [];
    var outs = Array.isArray(body.test_outputs) ? body.test_outputs : [];
    var errs = Array.isArray(body.test_errors) ? body.test_errors : [];
    var passed = [];
    var allPass = tests.length > 0;
    for (var ti = 0; ti < tests.length; ti++) {
      var tok = String(errs[ti] || '').indexOf('Traceback') === -1 &&
        normalizedEquals_(String(outs[ti] || ''), String(tests[ti].expected));
      passed.push(tok);
      if (!tok) allPass = false;
    }
    var buildRes = finalizeAttempt_(prow, payload, {
      code: code, stdout: outs.join('\n'), stderr: errs.join('\n'),
      verdict: allPass ? '正解' : '不正解', hintUsed: hintUsed, easy: easy,
      errorPattern: 'なし', explanation: null, modelUsed: '', hints: hints,
      suggestion: '', practice: practice
    });
    buildRes.tests_passed = passed; // UIが各テストの合否を出す（正解コードは出さない）
    buildRes.tests_total = tests.length;
    return buildRes;
  }

  // --- Stage1: トレース（変数トレース表）。学習者が埋めたセルと、Pyodideで実際に実行して得た
  // 真の値（フロントが sys.settrace で取得）をセル単位で照合。LLM不使用。読む段＝習得に算入しない ---
  if (payload.type === 'トレース') {
    var cells = Array.isArray(body.trace_cells) ? body.trace_cells : [];     // 学習者が書いた値
    var actual = Array.isArray(body.trace_actual) ? body.trace_actual : [];  // Pyodideの真値
    if (cells.length === 0 || actual.length === 0) {
      return { error: 'bad_request', message: '表を埋めてから答え合わせしてください' };
    }
    var hit = 0;
    for (var ci = 0; ci < actual.length; ci++) {
      if (normalizedEquals_(String(cells[ci] || ''), String(actual[ci] || ''))) hit++;
    }
    var tverdict = hit === actual.length ? '正解' : (hit > 0 ? '惜しい' : '不正解');
    var tres = finalizeAttempt_(prow, payload, {
      code: 'トレース: ' + hit + '/' + actual.length, stdout: '', stderr: '',
      verdict: tverdict, hintUsed: false, easy: false,
      errorPattern: 'なし', explanation: null, modelUsed: '', hints: [],
      suggestion: '', practice: practice, isTrace: true
    });
    tres.trace_hit = hit;
    tres.trace_total = actual.length;
    return tres;
  }

  // --- Stage2: 並べ替え（Parsons）。学習者が並べたコードをPyodideで実行した結果（stdout）が
  // expected_output と一致すれば正解。LLM不使用。並べる段＝習得（昇級）には算入しない（isTrace） ---
  if (payload.type === '並べ替え') {
    var okParsons = stderr.indexOf('Traceback') === -1 && normalizedEquals_(stdout, payload.expected_output);
    return finalizeAttempt_(prow, payload, {
      code: code, stdout: stdout, stderr: stderr,
      verdict: okParsons ? '正解' : '不正解', hintUsed: false, easy: false,
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

// EiPE（説明）の寛容採点。要点（コードの目的）を捉えていれば ok=true。
// LLM障害でも止めない＝寛容に通して励ます（初心者を萎えさせないため §スキルラダー）
function gradeEipe_(payload, explanationText) {
  try {
    var res = callGemini_({
      system: [
        'あなたはPython完全初心者の家庭教師。学習者がコードの「目的」を一言で説明する。【寛容に】採点する。JSONのみ。',
        '- 要点（このコードが結局何をするか）を捉えていれば ok=true。言い回し違い・多少の不正確さ・言葉足らずは許す。',
        '- まったく的外れ・空・無関係なときだけ ok=false。出力を答えただけ（目的を言えていない）は ok=false にして優しく促す。',
        '- model_answer は一言の模範説明（初心者向け・短く・専門用語を避ける）。feedback は1文で励ます/補足。'
      ].join('\n'),
      user: '# コード\n' + (payload.code_to_read || '') + '\n# 学習者の説明\n' + explanationText +
        '\n\nこの説明はコードの「目的」を捉えている？ JSONで返して。',
      schema: {
        type: 'OBJECT',
        properties: {
          ok: { type: 'BOOLEAN' },
          model_answer: { type: 'STRING' },
          feedback: { type: 'STRING' }
        },
        required: ['ok', 'model_answer', 'feedback']
      },
      temperature: 0.2
    });
    var j = res.json || {};
    return {
      ok: j.ok === true,
      model_answer: typeof j.model_answer === 'string' ? j.model_answer : '',
      feedback: typeof j.feedback === 'string' ? j.feedback : '',
      model_used: res.model_used
    };
  } catch (e) {
    if (e && e.code === 'budget') throw e; // 予算超過はそのまま上へ
    // LLM障害：寛容に通す（自分の言葉で説明できたこと自体を肯定する）
    return { ok: true, model_answer: '', feedback: '自分の言葉で説明できたのは大きな一歩。採点サーバが混んでいたので模範解答は次回に。', model_used: '' };
  }
}

// 和訳（1行ずつ日本語に訳す）の寛容採点。各行を甘く判定し、必ず各行の模範和訳を返す。
// LLM障害でも止めない＝寛容に通して励ます（§スキルラダー・モチベ設計）
function gradeWayaku_(payload, lineDescs) {
  var codeLines = String(payload.code_to_read || '').split('\n').filter(function (l) { return l.trim() !== ''; });
  try {
    var res = callGemini_({
      system: [
        'あなたはPython完全初心者の家庭教師。学習者がコードを1行ずつ日本語に訳す（その行が何をするか）。【寛容に】採点する。JSONのみ。',
        '- 各行について、学習者の説明が要点を捉えていれば ok=true（言い回し違い・言葉足らずは許す）。空や的外れだけ ok=false。',
        '- model は各行の模範の和訳（初心者向け・短く・専門用語を避ける）。必ず全行ぶん、行の順番どおりに返す。',
        '- overall_ok は「半分以上の行が ok」なら true（励ます方向）。'
      ].join('\n'),
      user: '# コード（行番号:中身）\n' + codeLines.map(function (l, i) { return i + ': ' + l; }).join('\n') +
        '\n# 学習者の各行の説明\n' + codeLines.map(function (l, i) { return i + ': ' + (lineDescs[i] || '(空)'); }).join('\n') +
        '\n\n各行を寛容に採点し、各行の模範和訳を JSON で。',
      schema: {
        type: 'OBJECT',
        properties: {
          lines: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, model: { type: 'STRING' } }, required: ['ok', 'model'] }
          },
          overall_ok: { type: 'BOOLEAN' }
        },
        required: ['lines', 'overall_ok']
      },
      temperature: 0.2
    });
    var j = res.json || {};
    var arr = Array.isArray(j.lines) ? j.lines : [];
    var lines = codeLines.map(function (l, i) {
      var item = arr[i] || {};
      return { line: l, ok: item.ok === true, model: typeof item.model === 'string' ? item.model : '' };
    });
    return { lines: lines, overall_ok: j.overall_ok === true, model_used: res.model_used };
  } catch (e) {
    if (e && e.code === 'budget') throw e;
    var lines2 = codeLines.map(function (l) { return { line: l, ok: true, model: '' }; });
    return { lines: lines2, overall_ok: true, model_used: '' };
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
