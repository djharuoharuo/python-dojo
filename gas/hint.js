// =====================================================================
// hint.js — 段階式ヒント（足場をだんだん外す faded scaffolding / 完成例の段階開示）。
// 同じ[ヒント]ボタンを押すほど level が上がり、だんだん答えに近づく：
//   level1 = 方針＋この問題に沿った小さな例（完成コードは出さない）
//   level2 = 解き方の骨組み（手順・擬似コード。まだ完成コードは出さない）
//   level3 = 穴埋め（ほぼ完成のコードだが、重要な学習ポイントだけ ____ で隠す）
// 完全初心者向けに噛み砕き、例は必ず「いま解いている問題」に即して出す。
// callGemini_ 経由なので daily_llm_budget を消費する（§5）。ステートレス（level だけ受け取る）。
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
    schema: { type: 'OBJECT', properties: { hint: { type: 'STRING' } }, required: ['hint'] },
    temperature: 0.3
  });
  var hint = res.json && typeof res.json.hint === 'string' ? res.json.hint.trim() : '';
  if (!hint) return { error: 'llm_failed', message: 'ヒントを生成できませんでした。もう一度お試しください' };
  return { hint: hint, level: level, model_used: res.model_used };
}

// 段階別の家庭教師プロンプト。共通ルール＋levelごとの出し方を指示する
function hintSystemPrompt_(level) {
  var common = [
    'あなたはPython完全初心者の家庭教師。生徒がいま解いている問題のヒントを出す。JSONのみ出力する。',
    '【最重要】いきなり完成した正解コードは書かない（穴埋め段階でも全部は埋めない）。',
    '- すべて日本語。専門用語には毎回その場で短い説明を添える（例:「for＝くり返し」）。',
    '- 具体例は必ず【いま解いている問題に沿った】内容にする。無関係な汎用例は出さない。',
    '- やさしく励ます調子で。詰まるのは普通だと伝える。'
  ];
  var perLevel = {
    1: [
      '今回は【レベル1：方針＋小さな例】。',
      '- まず「何をどう考えればいいか」の方針を1つ示す。',
      '- 使う文法の名前を出し（例: if / for / range）、その問題に関係する1〜2行の小さな例を1つ添える。',
      '- ただし問題の答えそのもの（完成コード）は書かない。3〜5文程度で簡潔に。'
    ],
    2: [
      '今回は【レベル2：骨組み】。',
      '- 解き方の手順を、上から順の箇条書き（擬似コード可）で示す。どの段階で何の文法を使うかを具体的に。',
      '- まだ完成コードは書かない。生徒が自分で各行を書けるだけの足場を渡す。'
    ],
    3: [
      '今回は【レベル3：穴埋め】。',
      '- ほぼ完成したコードを示すが、最も大事な学習ポイントを1〜3か所だけ ____（アンダースコア）で隠す。',
      '- 隠した各所のあとに「ここは○○（例: くり返す回数）」と短いヒントを添える。',
      '- 全部は埋めない。隠した所は生徒が自分で考えて埋められる、いちばん学びになる部分にする。'
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
