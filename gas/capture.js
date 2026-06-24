// =====================================================================
// capture.js — 学習キャプチャ（§1,§2）。
// 本で読んだ「学んだこと」を捕捉 → 既存概念へ名寄せ（§5）→ FSRS復習キューに登録 →
// 検証ゲート（§2: ブラウザのPyodideで実行して正解を確定）を通った問題だけを出題キューに積む。
//
// ◆安全の要は §2：Geminiは問題を【提案】するだけ。答えの真偽はPyodideが決める。
//   コードはGASでは実行できない（Pyodideはブラウザ側）。よって
//     captureCandidates（Geminiで“たね”を作る・未検証）
//       → フロントがPyodideで実行して検証（出力を確定/実行時エラーは破棄 §2）
//         → commitProblems（検証済みだけ保存。verified=TRUE）
//   という3段で回す。未検証の問題は決して出題対象（problems）に入れない。
//
// ◆v1の問題タイプは「予測（Stage1: 出力予測/読む段）」のみ。
//   読んだコードの出力を当てる練習は、本で読んだ直後の定着に最適（§15の下段＝書く力を予測する）。
//   かつ検証が最も安全（コードを実行した実stdoutがそのまま正解＝模範解答が要らない）。
//   「組む（白紙で書く）」型の捕捉はこの予測経路が実機で確認できてから次段で足す。
// =====================================================================

// 出題コードに含めてはいけない非決定的・環境依存の要素（§2: Pyodideで検証可能にする制約）。
// 純関数（GAS API不使用）＝Nodeスモークテストでもそのまま検証できる
function captureCodeAllowed_(code) {
  var c = String(code);
  var forbidden = [
    /\binput\s*\(/,      // 標準入力（対話）
    /\brandom\b/,        // 乱数（シード有無に関わらず捕捉問題では使わせない）
    /\bdatetime\b/, /\btime\s*\(/, /\.now\s*\(/, // 日時
    /\bopen\s*\(/, /\bos\./, /\bsys\.argv/,       // ファイル/OS/引数
    /\brequests\b/, /\burllib\b/, /\bsocket\b/    // ネットワーク
  ];
  for (var i = 0; i < forbidden.length; i++) {
    if (forbidden[i].test(c)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// §5 名寄せ（LLM不使用・決定的）。最終決定はユーザーの1タップ。
// 「スコープ」と「変数の有効範囲」を別概念として二重登録しないための入口。
// ---------------------------------------------------------------------
function actionCaptureMatch_(body) {
  var name = String(body.concept_name || '').trim();
  if (!name) return { error: 'bad_request', message: '学んだ概念の名前を入れてください' };
  var concepts = readRows_('concepts');
  var matches = matchConcepts_(name, concepts);
  // 上位候補が十分近ければ「既存に紐づけ」を、遠ければ「新規作成」を既定で薦める（決めるのは本人）
  var suggest = (matches[0] && matches[0].score >= 0.6) ? matches[0].concept_id : 'new';
  return { matches: matches.slice(0, 3), suggest: suggest };
}

// 概念名を正規化（小文字化・空白と記号の除去）。比較のゆれを吸収する（純関数）
function normalizeConceptName_(s) {
  return String(s).toLowerCase()
    .replace(/[\s　・/（）()\[\]「」『』、,。.\-_]/g, '')
    .trim();
}

// ゆるいトークン分割（英単語と区切り記号で分ける）。日本語は分割しづらいので substring 判定で補う（純関数）
function tokenizeConcept_(s) {
  return String(s).toLowerCase()
    .split(/[\s　・/（）()\[\]「」『』、,。.\-_]+/)
    .map(function (t) { return t.trim(); }).filter(String);
}

function tokenOverlap_(a, b) {
  if (!a.length || !b.length) return 0;
  var setB = {}; b.forEach(function (t) { setB[t] = true; });
  var hit = 0; a.forEach(function (t) { if (setB[t]) hit++; });
  return hit / Math.max(a.length, b.length);
}

// 入力名と既存conceptsを突き合わせ [{concept_id,name,state,score}] をスコア降順で返す（純関数）。
// score: 完全一致=1.0 / 一方が他方を含む=0.85 / トークン重なり率 / それ以外=0。0.2以下は捨てる
function matchConcepts_(name, concepts) {
  var n = normalizeConceptName_(name);
  var nTokens = tokenizeConcept_(name);
  var scored = (concepts || []).map(function (c) {
    var candidates = [c.name, c.concept_id].concat(String(c.aliases || '').split(','));
    var best = 0;
    candidates.forEach(function (cand) {
      var cn = normalizeConceptName_(cand);
      if (!cn || !n) return;
      var s = 0;
      if (cn === n) s = 1.0;
      else if (cn.indexOf(n) !== -1 || n.indexOf(cn) !== -1) s = 0.85;
      else s = tokenOverlap_(nTokens, tokenizeConcept_(cand));
      if (s > best) best = s;
    });
    return { concept_id: c.concept_id, name: c.name, state: c.state, score: Math.round(best * 100) / 100 };
  }).filter(function (m) { return m.score > 0.2; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored;
}

// ---------------------------------------------------------------------
// Phase A：捕捉 → 概念の作成/紐づけ → FSRS復習キューに登録（§3,§6 本体）。
// 「これだけで新概念が間隔反復キューに入る」最優先の配線（問題生成が無くても価値が出る）。
// ---------------------------------------------------------------------
function actionCapture_(body) {
  var rawText = String(body.raw_text || body.concept_name || '').trim();
  var selfExp = String(body.self_explanation || '').trim();
  var sourceRef = String(body.source_ref || '').trim();
  var conceptName = String(body.concept_name || '').trim();
  var attach = body.attach || {};
  if (!conceptName) return { error: 'bad_request', message: '学んだ概念の名前を入れてください' };
  if (conceptName.length > 60) return { error: 'bad_request', message: '概念名は60文字以内にしてください' };
  if (selfExp.length > 400) return { error: 'bad_request', message: 'ひとこと説明は400文字以内にしてください' };
  if (sourceRef.length > 120) return { error: 'bad_request', message: '出典は120文字以内にしてください' };

  var concepts = readRows_('concepts');
  var conceptId, conceptDisplay, created = false;

  if (attach.mode === 'existing' && attach.concept_id) {
    var ex = concepts.filter(function (c) { return c.concept_id === attach.concept_id; })[0];
    if (!ex) return { error: 'not_found', message: '紐づけ先の概念が見つかりません。選び直してください' };
    conceptId = ex.concept_id;
    conceptDisplay = ex.name;
    addAlias_(ex, conceptName); // 今回の言い方を別名に足す＝次回の名寄せが効く（§5）
  } else {
    // 新規概念：state=練習中・source=capture・due=今日。FSRSカードは初回採点で初期化される
    // （loadCard_ は reps=0 のとき createEmptyCard を返す）。練習中なので以後の復習に乗る。
    conceptId = 'cap_' + Utilities.getUuid().slice(0, 8);
    conceptDisplay = conceptName;
    appendRowObj_('concepts', {
      concept_id: conceptId, name: conceptName, state: '練習中', prereq: '', no_review: '',
      due: todayStr_(), stability: '', difficulty: '', reps: '', lapses: '', last_review: '',
      nohint_streak: 0, nohint_correct_days: '', source: 'capture', aliases: ''
    });
    created = true;
  }

  // §8 learning_log に1行記録（自己説明＝generation effect の記録。記録と学習の二役）。
  // learning_log タブ未作成（migrate前）でも概念登録は止めない（asks/revenge と同じ方針）。
  var logId = 'log_' + Utilities.getUuid().slice(0, 8);
  try {
    appendRowObj_('learning_log', {
      log_id: logId, timestamp: nowIso_(), raw_text: rawText, self_explanation: selfExp,
      source_ref: sourceRef, concept_id: conceptId, generated_problem_ids: ''
    });
  } catch (e) {
    logId = null; // 後で migrate() すれば記録されるようになる。捕捉自体は成功扱い
  }

  return { concept_id: conceptId, concept_name: conceptDisplay, created: created, log_id: logId };
}

// 既存概念に別名（今回の言い方）を足す。既に同義のものがあれば何もしない
function addAlias_(conceptRow, alias) {
  if (!alias) return;
  var norm = normalizeConceptName_(alias);
  if (normalizeConceptName_(conceptRow.name) === norm) return;
  var existing = String(conceptRow.aliases || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  var has = existing.some(function (a) { return normalizeConceptName_(a) === norm; });
  if (has) return;
  existing.push(alias);
  updateRowWhere_('concepts', 'concept_id', conceptRow.concept_id, { aliases: existing.join(',') });
}

// ---------------------------------------------------------------------
// Phase B-1：候補（“たね”）生成。Geminiに【完成した短いコード】だけ作らせる（未検証）。
// 期待出力はここでは確定しない＝フロントがPyodideで実行して確定する（§2）。
// ---------------------------------------------------------------------
function actionCaptureCandidates_(body) {
  var conceptId = String(body.concept_id || '');
  var conceptName = String(body.concept_name || '').trim();
  var selfExp = String(body.self_explanation || '').trim();
  if (!conceptName) return { error: 'bad_request', message: '概念名がありません' };
  var n = Math.max(1, Math.min(4, Number(body.predict_count) || Number(getConf_('capture_predict_count', 2))));

  var res = callGemini_({
    system: captureSystemPrompt_(),
    user: captureUserPrompt_(conceptName, selfExp, n),
    schema: captureSchema_(),
    temperature: 0.7
  });
  var candidates = validateCaptureCandidates_(res.json, conceptId, conceptName);
  if (!candidates.length) {
    return { error: 'generate_failed', message: '問題のたねを作れませんでした。もう一度お試しください' };
  }
  return { candidates: candidates, model_used: res.model_used };
}

function captureSystemPrompt_() {
  return [
    'あなたはPython完全初心者向けの「出力予測クイズ」作成者。指定された概念を使う【完成した短いコード】だけをJSONで出力する。',
    '学習者はそのコードを読んで標準出力を予測する（コードは書かない）。だから完成形でよい。',
    '【厳守】',
    '- 各コードは5〜10行で完結し、それ単体で実行できること（未定義の関数・変数を残さない）。',
    '- 必ず print で数行の出力を出す。出力は暗算で追える小さな規模（数値は10以下が目安）。',
    '- 指定された概念が主役になるように使う。1コードにつき新しい考えは1つだけ。',
    '- 【決定的であること】input()・乱数・現在時刻・ファイル/ネットワーク/OS依存を絶対に使わない（実行のたびに出力が変わるものは禁止）。',
    '- 人名・実在の固有名詞・個人情報を入れない（架空のID等にする）。',
    '- title は短い見出し（例「スコープの確認」）。code_to_read に完成コードを入れる。kind は必ず "predict"。',
    '- 期待出力は書かなくてよい（こちらで実行して確定する）。'
  ].join('\n');
}

function captureUserPrompt_(conceptName, selfExp, n) {
  return '概念「' + conceptName + '」を使う出力予測クイズのコードを' + n + '個、JSONで作ってください。' +
    (selfExp ? '\n学習者はこの概念をこう理解しています（参考）:「' + selfExp + '」。この理解を確かめられる素直な例にしてください。' : '') +
    '\nそれぞれ別の側面・別の具体例にして、似すぎないようにしてください。';
}

function captureSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      candidates: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            kind: { type: 'STRING' },
            title: { type: 'STRING' },
            code_to_read: { type: 'STRING' }
          },
          required: ['kind', 'title', 'code_to_read']
        }
      }
    },
    required: ['candidates']
  };
}

// Geminiの“たね”を検証用候補に整える（純関数に近い：禁止要素はここでも弾く §2 多層防御）。
// 期待出力はまだ無い＝フロントのPyodide検証で確定する。
function validateCaptureCandidates_(json, conceptId, conceptName) {
  if (!json || !Array.isArray(json.candidates)) return [];
  var out = [];
  json.candidates.forEach(function (c) {
    if (!c || typeof c.code_to_read !== 'string' || !c.code_to_read.trim()) return;
    if (!captureCodeAllowed_(c.code_to_read)) return; // 非決定的・環境依存は破棄（§2）
    out.push({
      kind: 'predict',
      concept_id: conceptId,
      concept_name: conceptName,
      title: typeof c.title === 'string' && c.title ? c.title : (conceptName + ' の出力予測'),
      code_to_read: c.code_to_read
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// Phase B-2：検証済みの問題だけ保存（commit）。フロントがPyodideで実行して
// 確定した expected_output を受け取り、verified=TRUE で problems に積む（§2）。
// ※ サーバは“クライアントの自己申告”を最終ではなく、禁止要素の再チェック＋型検証をして保存する。
// ---------------------------------------------------------------------
function actionCommitProblems_(body) {
  var conceptId = String(body.concept_id || '');
  var items = Array.isArray(body.problems) ? body.problems : [];
  if (!conceptId || !items.length) return { error: 'bad_request', message: '保存する問題がありません' };
  var concepts = readRows_('concepts');
  var concept = concepts.filter(function (c) { return c.concept_id === conceptId; })[0];
  if (!concept) return { error: 'not_found', message: '概念が見つかりません。捕捉からやり直してください' };

  var num = Number(getConf_('last_problem_number', 30));
  var saved = [];
  items.slice(0, 8).forEach(function (it) {
    if (!it || it.kind !== 'predict') return;
    var code = String(it.code_to_read || '');
    var expected = String(it.expected_output || '');
    // 検証ゲート（§2）：コードと「実行で得た出力」が無いものは捨てる。出力が空＝予測問題として無意味
    if (!code || !expected) return;
    if (!captureCodeAllowed_(code)) return; // サーバ側でも禁止要素を再チェック
    num++;
    var payload = {
      number: num,
      title: String(it.title || concept.name),
      concept_id: conceptId,
      type: '予測',
      statement: '次のコードの出力を予測してください（読んで考える練習です）',
      conditions: [],
      example_call: '',
      expected_output: expected,
      buggy_code: null,
      code_to_read: code,
      function_name: null,
      trace_vars: null,
      blanks: null,
      tests: null,
      theme: '基礎',
      is_revenge: false
    };
    var problemId = Utilities.getUuid();
    appendRowObj_('problems', {
      problem_id: problemId, number: num, concept_id: conceptId, type: '予測',
      payload_json: JSON.stringify(payload), status: '未回答', created_at: nowIso_(),
      verified: 'TRUE', source: 'capture'
    });
    saved.push({ problem_id: problemId, type: '予測', payload: payload });
  });

  if (!saved.length) {
    return { error: 'generate_failed', message: '検証を通った問題がありませんでした。もう一度お試しください' };
  }
  setConf_('last_problem_number', num);

  // learning_log に生成した問題IDを書き戻す（任意・失敗は飲み込む）
  if (body.log_id) {
    try {
      updateRowWhere_('learning_log', 'log_id', String(body.log_id), {
        generated_problem_ids: saved.map(function (s) { return s.problem_id; }).join(',')
      });
    } catch (e) { /* migrate前でも保存は止めない */ }
  }
  return { saved: saved };
}

// ---------------------------------------------------------------------
// 捕捉した概念の現況（ホーム下部の「学んだことの棚」用）。
// 各capture概念の残り未回答数・due を返す。残り0かつdue到来は「もう一度作る」対象（§6 recurrence）。
// ---------------------------------------------------------------------
function captureConceptsSummary_() {
  var concepts = readRows_('concepts').filter(function (c) { return c.source === 'capture'; });
  if (!concepts.length) return [];
  var pending = {};
  readRows_('problems').forEach(function (p) {
    if (p.status === '未回答' && p.source === 'capture') {
      pending[p.concept_id] = (pending[p.concept_id] || 0) + 1;
    }
  });
  var today = todayStr_();
  return concepts.map(function (c) {
    return {
      concept_id: c.concept_id,
      name: c.name,
      state: c.state,
      due: c.due || '',
      pending: pending[c.concept_id] || 0,
      due_now: !!(c.due && c.due <= today) // due到来＝そろそろ復習どき（FSRS）
    };
  });
}

// Nodeスモークテスト用にエクスポート（ブラウザ/GASでは無視される）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    captureCodeAllowed_: captureCodeAllowed_,
    normalizeConceptName_: normalizeConceptName_,
    tokenizeConcept_: tokenizeConcept_,
    tokenOverlap_: tokenOverlap_,
    matchConcepts_: matchConcepts_,
    validateCaptureCandidates_: validateCaptureCandidates_
  };
}
