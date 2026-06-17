// =====================================================================
// hint.js — 段階式ヒント（足場をだんだん外す faded scaffolding / 完成例の段階開示）。
// 同じ[ヒント]ボタンを押すほど level が上がり、だんだん答えに近づく：
//   level1 = 方針＋この問題に沿った小さな例
//   level2 = 解き方の骨組み（まだ完成させない）
//   level3 = 穴埋め（重要な学習ポイントだけ ①②③ の空欄。コードはクリーンに）
// 【読みやすさ】説明とコードを分けて返す（worked example のベストプラクティス）：
//   hint  = 短い方針/導入（散文）
//   code  = コードだけ（マークダウンの``` やコード内の長い説明は禁止。空欄は ①②③）
//   steps = ①②③ に対応する説明の配列（フロントが番号を振って並べる）
// ステートレス（level だけ受け取る）。callGemini_ 経由で daily_llm_budget を消費（§5）。
// =====================================================================

function actionHint_(body) {
  var problemId = String(body.problem_id || '');
  var code = String(body.code || '');
  var level = Number(body.level || 1);
  if (level < 1) level = 1;
  if (level > 3) level = 3;
  if (!problemId) return { error: 'bad_request', message: 'problem_id がありません。ホームからやり直してください' };
  if (code.length > 20000) return { error: 'bad_request', message: 'コードが長すぎます。短くしてからお試しください' };

  var prow = readRows_('problems').filter(function (p) { return p.problem_id === problemId; })[0];
  if (!prow) return { error: 'not_found', message: '問題が見つかりません。ホームを再読み込みしてください' };
  var payload = JSON.parse(prow.payload_json);

  var res = callGemini_({
    system: hintSystemPrompt_(level),
    user: hintUserPrompt_(payload, code, level),
    schema: {
      type: 'OBJECT',
      properties: {
        hint: { type: 'STRING' },
        code: { type: 'STRING', nullable: true },
        steps: { type: 'ARRAY', items: { type: 'STRING' }, nullable: true }
      },
      required: ['hint']
    },
    temperature: 0.3
  });
  var j = res.json || {};
  var hint = typeof j.hint === 'string' ? j.hint.trim() : '';
  if (!hint) return { error: 'llm_failed', message: 'ヒントを生成できませんでした。もう一度お試しください' };

  return {
    hint: hint,
    code: cleanHintCode_(j.code),
    steps: Array.isArray(j.steps) ? j.steps.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, 6) : null,
    level: level,
    model_used: res.model_used
  };
}

// 万一モデルがマークダウンのコードフェンス（```）を付けても剥がす保険
function cleanHintCode_(code) {
  if (typeof code !== 'string' || !code.trim()) return null;
  return code.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').replace(/\s+$/, '');
}

function hintSystemPrompt_(level) {
  var common = [
    'あなたはPython完全初心者の家庭教師。生徒がいま解いている問題のヒントを出す。JSONのみ出力する。',
    '【最重要】いきなり完成した正解コードは書かない（穴埋め段階でも全部は埋めない）。',
    '- すべて日本語。専門用語には毎回その場で短い説明を添える（例:「if＝もし〜なら」）。',
    '- 例は必ず【いま解いている問題に沿った】内容にする。無関係な汎用例は出さない。',
    '【出力の分け方（読みやすさのため厳守）】',
    '- hint: 散文の短い方針・導入（1〜2文）。コードは書かない。',
    '- code: コードだけをこのフィールドに入れる。マークダウンの ``` は付けない。',
    '  コードの中に長い説明コメントを書かない（説明は steps へ）。',
    '- steps: 読む説明を順番に並べた配列。各要素に番号は付けない（フロントが①②③を振る）。',
    '- 埋めてほしい空欄は code の中で出てくる順に ①②③… でマークし、',
    '  steps をその空欄と同じ順番にする（steps[0]が①の説明、という対応）。',
    'やさしく励ます調子で。詰まるのは普通だと伝える。'
  ];
  var perLevel = {
    1: [
      '今回は【レベル1：方針＋小さな例】。',
      '- hint に「何をどう考えるか」の方針を1つ。',
      '- code にこの問題に関係する1〜2行の小さな例（使う文法が分かるもの。穴埋めは無しでよい）。',
      '- steps にその例のポイントを1〜2個。問題の答えそのものは出さない。'
    ],
    2: [
      '今回は【レベル2：骨組み】。',
      '- code に解き方の骨組み（関数の枠や擬似コード）。まだ完成させない。要所は ①②… の空欄にしてよい。',
      '- steps に「どの順で何をするか」を番号順で。完成コードは書かない。'
    ],
    3: [
      '今回は【レベル3：穴埋め】。',
      '- code はほぼ完成のコード。ただし最も大事な学習ポイント1〜3か所だけを ①②③ の空欄にする。',
      '- コードはクリーンに（説明コメントを入れない）。空欄以外は正しく書いてよい。',
      '- steps に ①②③ に入れるものの説明を順番に（「〜が必要」「〜を使う」のように、答えの単語は直接書かず導く）。'
    ]
  };
  return common.concat(perLevel[level] || perLevel[1]).join('\n');
}

function hintUserPrompt_(payload, code, level) {
  return ['# いま解いている問題', JSON.stringify({
    statement: payload.statement, conditions: payload.conditions,
    example_call: payload.example_call, expected_output: payload.expected_output
  }), '# 生徒がいま書いているコード（空のこともある）', code || '(まだ何も書いていない)',
    '# 求めるヒントの段階', 'レベル' + level].join('\n');
}
