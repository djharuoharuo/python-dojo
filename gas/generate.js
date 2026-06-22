// =====================================================================
// generate.js — 出題ロジック（§6）。
// どの概念を・どの種別で・どのテーマで出すかは【すべてここのコードが決める】。
// LLMには完成した仕様を渡して問題文を書かせるだけ（状態判断をさせない）。
// =====================================================================

// 新規解放の対象外にする概念（§10: tracebackはhint側で育てる常時並行枠）
var UNLOCK_EXCLUDED = { traceback: true };

// 「基礎」とみなす概念。これが全部「習得」になったら、超初心者期に0にしていた
// セキュリティ題材を自動で解放する（§6: 同じ文法をセキュリティ文脈でも出す段階へ）
var BASIC_CONCEPTS = ['max_search', 'total', 'for_if', 'def_args_return', 'for_range', 'if_else', 'mod'];
// 解放後の題材配分。基礎を4割残しつつ、音楽3割・セキュリティ3割を戻す（いきなり全振りしない）
var THEME_AFTER_RAMP = '基礎:0.4,音楽:0.3,セキュリティ:0.3';

function actionGenerate_(body) {
  var conf = getConfigAll_();
  var count = Math.max(1, Math.min(5, Number(body.count) || Number(conf.daily_count || 3)));
  var concepts = readRows_('concepts');
  maybeRestoreSecurityTheme_(concepts); // 基礎が固まっていればセキュリティ題材を解放（この生成から反映）
  var acc = recentAccuracy_(Number(conf.target_acc_low || 0.75), Number(conf.target_acc_high || 0.90));

  // --- リベンジ枠：期限が来た「前回間違えた問題」の類題を最大1問（テスト効果 §6） ---
  var revenges = pickDueRevenges_(1);

  // --- スロット決定（残り枠を 復習＋新規 or 練習中 で埋める） ---
  var normalCount = count - revenges.length;
  var slots = normalCount > 0 ? pickSlots_(concepts, normalCount, acc) : [];
  if (slots.length === 0 && revenges.length === 0) {
    return { error: 'no_concept', message: '出題できる概念がありません。conceptsシートを確認してください' };
  }

  // --- 各スロットの種別・テーマ・バグ素材を確定。リベンジを先頭にして通し番号を振る ---
  var threshold = Number(conf.nohint_threshold || 3);
  var startNumber = Number(conf.last_problem_number || 30);
  var topPatterns = topMistakes_().map(function (m) { return m.pattern; });
  // 解放が走った直後でも新しい配分を使うよう、ここで config を読み直す
  var weights = String(getConf_('theme_weights', '基礎:0.6,音楽:0.3,日常:0.1'));

  var specs = [];
  revenges.forEach(function (rv) {
    var src = rv.source;
    specs.push({
      concept_id: rv.concept_id,
      concept_name: conceptName_(concepts, rv.concept_id),
      type: '復習',                       // 復習＝ヒント先行（答えを先に見せない §7）
      theme: src.theme || pickTheme_(weights),
      error_pattern: null,
      is_revenge: true,                   // UIで「🔁 リベンジ」表示・採点後の扱いに使う
      revenge_source: {                   // Geminiに渡す元問題（これの類題を作らせる）
        statement: src.statement, conditions: src.conditions,
        example_call: src.example_call, expected_output: src.expected_output
      }
    });
  });
  var traceEnabled = getConf_('trace_enabled', 'TRUE') !== 'FALSE';
  var traceUsed = false;
  slots.forEach(function (slot, i) {
    // 読む段（Stage1: 出力予測/トレース）を1セッションに1問だけ混ぜる＝「書く前に読む」＋
    // インターリービング（§スキルラダー）。書く力の土台になる実装精度を低負荷で鍛える。
    // 練習中の概念が対象。コードを読んで stdout を予測させる（書かせない）
    var type;
    if (traceEnabled && !traceUsed && slot.kind === 'practice') {
      type = '予測';
      traceUsed = true;
    } else {
      type = decideType_(slot, threshold, acc);
    }
    specs.push({
      concept_id: slot.concept.concept_id,
      concept_name: slot.concept.name,
      type: type,
      theme: pickTheme_(weights),
      error_pattern: type === 'デバッグ' ? (topPatterns[i % Math.max(1, topPatterns.length)] || '未定義変数') : null,
      is_revenge: false
    });
  });
  specs.forEach(function (s, i) { s.number = startNumber + i + 1; });

  // --- Gemini 生成（検証失敗は1回だけ再生成 §6） ---
  var result = null;
  var modelUsed = '';
  for (var attempt = 0; attempt < 2 && result === null; attempt++) {
    var res = callGemini_({
      system: generateSystemPrompt_(),
      user: generateUserPrompt_(specs),
      schema: generateSchema_(),
      temperature: 0.7
    });
    modelUsed = res.model_used;
    result = validateGenerated_(res.json, specs); // 不正なら null
  }
  if (result === null) {
    return { error: 'generate_failed', message: '問題の生成に失敗しました。[もう一度]を押してください' };
  }

  // --- 保存（ここまで検証を通ったものだけ書く §9） ---
  var saved = result.map(function (p) {
    var problemId = Utilities.getUuid();
    appendRowObj_('problems', {
      problem_id: problemId,
      number: p.number,
      concept_id: p.concept_id,
      type: p.type,
      payload_json: JSON.stringify(p),
      status: '未回答',
      created_at: nowIso_()
    });
    return { problem_id: problemId, type: p.type, payload: p };
  });
  setConf_('last_problem_number', startNumber + specs.length);
  return { problems: saved, model_used: modelUsed };
}

// ---------------------------------------------------------------------
// 直近20問の正答率（惜しい=0.5換算）→ 'low' / 'ok' / 'high'
// 標本が5問未満のうちは判断せず 'ok' 扱い
// ---------------------------------------------------------------------
function recentAccuracy_(low, high) {
  // 練習（過去問の再挑戦）は難易度判断に混ぜない（自分で選んだ・詰め込みでデータが偏るため）
  var attempts = readRows_('attempts')
    .filter(function (a) { return a.mode !== '練習'; }).slice(-20);
  if (attempts.length < 5) return 'ok';
  var score = 0;
  attempts.forEach(function (a) {
    if (a.verdict === '正解') score += 1;
    else if (a.verdict === '惜しい') score += 0.5;
  });
  var acc = score / attempts.length;
  if (acc < low) return 'low';
  if (acc > high) return 'high';
  return 'ok';
}

// ---------------------------------------------------------------------
// スロット選定：復習1＋練習中（弱い順）＋未解放1（正答率が低い時は解放しない）
// ---------------------------------------------------------------------
function pickSlots_(concepts, count, acc) {
  var today = todayStr_();
  var slots = [];
  var usedIds = {};

  // 復習枠：due超過の習得概念のうち最も古いもの1つ
  var reviewable = concepts.filter(function (c) {
    return c.state === '習得' && c.no_review !== 'TRUE' && c.due && c.due <= today;
  }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
  if (reviewable[0]) {
    slots.push({ concept: reviewable[0], kind: 'review' });
    usedIds[reviewable[0].concept_id] = true;
  }

  // 練習中：弱点優先（lapses多い順→ノーヒント連続が短い順）
  var practicing = concepts.filter(function (c) { return c.state === '練習中'; })
    .sort(function (a, b) {
      var d = Number(b.lapses || 0) - Number(a.lapses || 0);
      return d !== 0 ? d : Number(a.nohint_streak || 0) - Number(b.nohint_streak || 0);
    });

  // 新規解放：前提がすべて習得済みの「未」を1つだけ（85%ルール：lowの時は止める §6-5）
  var unlock = null;
  if (acc !== 'low') {
    unlock = concepts.filter(function (c) {
      if (c.state !== '未' || UNLOCK_EXCLUDED[c.concept_id]) return false;
      var prereqs = String(c.prereq || '').split(',').map(function (s) { return s.trim(); }).filter(String);
      return prereqs.every(function (pid) {
        var p = concepts.filter(function (x) { return x.concept_id === pid; })[0];
        return p && p.state === '習得';
      });
    })[0] || null;
  }

  // 残り枠を埋める：練習中→（あれば）新規解放→足りなければ練習中を再利用
  var pi = 0;
  while (slots.length < count) {
    var next = null;
    while (pi < practicing.length && usedIds[practicing[pi].concept_id]) pi++;
    if (pi < practicing.length) {
      next = { concept: practicing[pi], kind: 'practice' };
    } else if (unlock && !usedIds[unlock.concept_id]) {
      next = { concept: unlock, kind: 'new' };
    } else if (practicing.length > 0) {
      // 概念が足りない日は同じ練習中概念を別テーマでもう1問（重複可）
      next = { concept: practicing[slots.length % practicing.length], kind: 'practice' };
    } else if (reviewable.length > 0) {
      next = { concept: reviewable[slots.length % reviewable.length], kind: 'review' };
    } else {
      break;
    }
    usedIds[next.concept.concept_id] = true;
    slots.push(next);
  }
  return slots.slice(0, count);
}

// ---------------------------------------------------------------------
// 種別の自動切替（§6-2）と難易度クランプ（§6-5）
// ---------------------------------------------------------------------
function decideType_(slot, threshold, acc) {
  if (slot.kind === 'new') return '新規';
  var c = slot.concept;
  var streak = Number(c.nohint_streak || 0);
  if (streak >= threshold) {
    // 足場外し：ノーヒントとデバッグを交互に（前回の同概念特別問題と逆を出す）
    var lastSpecial = readRows_('problems').filter(function (p) {
      return p.concept_id === c.concept_id && (p.type === 'ノーヒント' || p.type === 'デバッグ');
    }).pop();
    return lastSpecial && lastSpecial.type === 'ノーヒント' ? 'デバッグ' : 'ノーヒント';
  }
  // 正答率が高すぎる時はノーヒント比率を上げる（85%ルールの上側）
  if (acc === 'high' && streak >= 1) return 'ノーヒント';
  return '復習';
}

// 基礎が全部「習得」になったら、セキュリティ題材を自動で解放する（一度だけ）。
// 超初心者期は theme_weights のセキュリティを0にしている（§6）。基礎が固まった
// タイミングで「同じ文法をセキュリティ文脈でも出す」段階へ自動移行する。
// theme_ramp_done フラグで二度は発火しない（以後の手動調整を上書きしない）。
// generate はロック下で呼ばれるので config 書き込みは安全（§5）。
function maybeRestoreSecurityTheme_(concepts) {
  if (getConf_('theme_ramp_done', '') === 'TRUE') return; // 既に解放済み（手動値を尊重）
  var mastered = {};
  concepts.forEach(function (c) { if (c.state === '習得') mastered[c.concept_id] = true; });
  var allBasicsMastered = BASIC_CONCEPTS.every(function (id) { return mastered[id]; });
  if (!allBasicsMastered) return;

  setConf_('theme_weights', THEME_AFTER_RAMP);
  setConf_('theme_ramp_done', 'TRUE');
  // ホーム上部のバナーで本人に知らせる（getToday が notice として返す §5b）
  setConf_('theme_notice', '🎉 基礎が固まりました！これからはセキュリティの題材（ログ集計・トークン検査など）も少しずつ出します。卒業制作（ミニ・ゼロトラストゲート）に向けて前進中です。');
}

// theme_weights（例「基礎:0.6,音楽:0.3,日常:0.1」）から重み付き抽選
function pickTheme_(weightsStr) {
  var entries = weightsStr.split(',').map(function (s) {
    var kv = s.split(':');
    return { theme: kv[0].trim(), w: Number(kv[1]) || 0 };
  }).filter(function (e) { return e.theme && e.w > 0; });
  if (entries.length === 0) return '日常';
  var total = entries.reduce(function (s, e) { return s + e.w; }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < entries.length; i++) {
    r -= entries[i].w;
    if (r <= 0) return entries[i].theme;
  }
  return entries[entries.length - 1].theme;
}

// ---------------------------------------------------------------------
// Gemini プロンプトとスキーマ（§6）
// ---------------------------------------------------------------------
function generateSystemPrompt_() {
  return [
    'あなたはPython完全初心者向けの問題作成者。渡された仕様（概念・種別・テーマ・番号）に厳密に従い、JSONのみを出力する。',
    '【超初心者向けの大原則】解いている人は def/for/range/if/%/total/return をやっと使える段階。実装精度（スペル・range の +1・初期値・比較対象）でよくミスする。',
    '- 1問につき【新しい考えは1つまで】。すでに知っている for / range / if / % / total / return を土台に組み、欲張らない',
    '- 問題文は2〜3文で短く。ひねった物語や前提知識を要求しない。専門用語には毎回その場で短い説明を添える',
    '- 数値は小さく（n は 10 以下が目安）。出力は数行に収め、暗算で答え合わせできる規模にする',
    '- 種別が新規・復習・デバッグのときは、conditionsに使う構文（例「`for` を使う」「`%` を使う」「`return` で返す」）を明示して足場をかける',
    '- 種別が予測（Stage1: 読む段）の場合、その概念を使う【完成した短いコード5〜10行】を code_to_read に入れる。statement は「次のコードの出力を予測してください」、conditions は空配列にする。学習者はコードを読んで標準出力を予測する（書かない）ので code_to_read は完成形でよい。expected_output はそのコードの厳密な標準出力（数行・暗算で追える規模）。example_call は使わない',
    '- 種別がノーヒントの場合だけ、conditionsは「関数名は `xxx`」の1項目のみ（どの構文を使うかは本人に選ばせる）',
    '- 種別がデバッグの場合、buggy_codeに指定されたerror_patternのバグを1つだけ仕込み、statementには「このコードを修正して」と書く。expected_outputは修正後の正しい出力',
    '- example_call は【関数の呼び出し方だけ】を示す。print(関数名(引数)) の呼び出し行のみにする（例: print(find_max([3, 8, 5]))）。【def や関数の中身＝解答は絶対に書かない】。学習者が自分でその関数を書くので、答えを見せてはいけない',
    '- expected_output は厳密な出力（実行したときのstdoutと完全一致させる）',
    '- input() は絶対に使わせない。乱数や現在時刻など実行ごとに変わる出力も禁止',
    '- 人名・実在の固有名詞・個人情報を問題文やコードに含めない（架空のID等を使う）',
    '【テーマの作り分け】',
    '- 「基礎」… 余計な物語をつけない素朴な数の問題（例：1からnまでの合計、偶数だけ足す、5の倍数を数える、最大値を返す）。これが主軸',
    '- 「日常」… 買い物の合計・カレンダーなど説明不要の身近な題材。文章は最小限',
    '- 「音楽」… BPMやテンポなど身近な題材。ただし計算は1ステップに留める（例：BPMから1拍のミリ秒＝60000÷BPM）。難しい音楽用語は出さない',
    '- 「セキュリティ」… ログ集計・トークン検査など。※今は基礎固めの期間なので指定されたら最小限の素朴な題材にする（複雑なログ構造は使わない）'
  ].join('\n');
}

function generateUserPrompt_(specs) {
  return '次の仕様で問題を' + specs.length + '問、JSONで作成してください。numberとconcept_idとtypeとthemeは仕様の値をそのまま使うこと。\n' +
    '※ variant_of がある問題は「類題」です。元の問題（variant_of）と同じ概念・同じ構造・同じ出力形式を保ち、' +
    '数値・登場する名前・題材などの具体だけを変えてください（難易度は同じ、答えそのものは作り直す）。\n' +
    JSON.stringify(specs.map(function (s) {
      return {
        number: s.number,
        concept_id: s.concept_id,
        concept: s.concept_name,
        type: s.type,
        theme: s.theme,
        error_pattern: s.error_pattern,
        variant_of: s.is_revenge ? s.revenge_source : undefined
      };
    }), null, 1);
}

// concept_id から表示名を引く（リベンジspec用）
function conceptName_(concepts, conceptId) {
  var c = concepts.filter(function (x) { return x.concept_id === conceptId; })[0];
  return c ? c.name : conceptId;
}

function generateSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      problems: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            number: { type: 'INTEGER' },
            title: { type: 'STRING' },
            concept_id: { type: 'STRING' },
            type: { type: 'STRING' },
            statement: { type: 'STRING' },
            conditions: { type: 'ARRAY', items: { type: 'STRING' } },
            example_call: { type: 'STRING' },
            expected_output: { type: 'STRING' },
            buggy_code: { type: 'STRING', nullable: true },
            code_to_read: { type: 'STRING', nullable: true },
            theme: { type: 'STRING' }
          },
          required: ['number', 'title', 'concept_id', 'type', 'statement',
            'conditions', 'expected_output', 'theme']
        }
      }
    },
    required: ['problems']
  };
}

// LLM応答のスキーマ検証（§9: 検証を通るまで保存禁止）。OKなら問題配列、NGなら null
function validateGenerated_(json, specs) {
  if (!json || !Array.isArray(json.problems) || json.problems.length !== specs.length) return null;
  var out = [];
  for (var i = 0; i < specs.length; i++) {
    var p = json.problems[i];
    var s = specs[i];
    if (!p || p.number !== s.number || p.concept_id !== s.concept_id || p.type !== s.type) return null;
    if (typeof p.statement !== 'string' || !p.statement) return null;
    if (typeof p.title !== 'string' || !p.title) return null;
    if (!Array.isArray(p.conditions) || !p.conditions.every(function (c) { return typeof c === 'string'; })) return null;
    if (s.type === '予測') {
      // 読む段：完成コード(code_to_read)が必須。example_call は使わない
      if (typeof p.code_to_read !== 'string' || !p.code_to_read) return null;
    } else {
      if (typeof p.example_call !== 'string' || p.example_call.indexOf('print') === -1) return null;
      // 答え漏れ防止（§7 答えを見せない）：呼び出し例に def（＝関数本体＝解答）が
      // 紛れていたら無効にして作り直させる。実行例は「呼び出し方だけ」を示す行のはず
      if (/(^|\n)\s*def\s/.test(p.example_call)) return null;
    }
    if (typeof p.expected_output !== 'string' || !p.expected_output) return null;
    if (s.type === 'デバッグ' && (typeof p.buggy_code !== 'string' || !p.buggy_code)) return null;
    if (s.type === 'ノーヒント') p.conditions = p.conditions.slice(0, 1); // 足場は1項目のみ
    p.code_to_read = p.code_to_read || null;
    p.theme = s.theme;
    p.error_pattern = s.error_pattern || null;
    p.is_revenge = s.is_revenge || false; // リベンジ（前回間違いの類題）か
    out.push(p);
  }
  // number重複チェック（既存problemsとも比較）
  var existing = {};
  readRows_('problems').forEach(function (r) { existing[r.number] = true; });
  for (var j = 0; j < out.length; j++) {
    if (existing[String(out[j].number)]) return null;
  }
  return out;
}
