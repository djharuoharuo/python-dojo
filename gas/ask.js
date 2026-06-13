// =====================================================================
// ask.js — 自由質問（ヒント拡張）。
// 「いま詰まっている所」を初心者が自由文で質問し、Geminiが【答えのコードは
// 直接書かず】次の一歩を導く。LLMはステートレス＝会話履歴を持たない
// （1質問→1回答。状態はコード側＝hint_usedの記録で管理する §7）。
// 呼び出しは callGemini_ 経由なので daily_llm_budget を消費する（乱用ガード §5）。
// =====================================================================

function actionAsk_(body) {
  // --- 入力検証（§9: クライアント入力は長さ・型を検証してから使う） ---
  var problemId = String(body.problem_id || '');
  var code = String(body.code || '');
  var question = String(body.question || '').trim();
  if (!problemId) return { error: 'bad_request', message: 'problem_id がありません。ホームからやり直してください' };
  if (!question) return { error: 'bad_request', message: '質問が空です。聞きたいことを入力してください' };
  if (question.length > 500 || code.length > 20000) {
    return { error: 'bad_request', message: '質問やコードが長すぎます。短くしてからもう一度お試しください' };
  }

  var prow = readRows_('problems').filter(function (p) { return p.problem_id === problemId; })[0];
  if (!prow) return { error: 'not_found', message: '問題が見つかりません。ホームを再読み込みしてください' };
  var payload = JSON.parse(prow.payload_json);

  // callGemini_ が予算消費・モデルフォールバックを担う（落ちたら llm_failed が上がる）
  var res = callGemini_({
    system: askSystemPrompt_(),
    user: askUserPrompt_(payload, code, question),
    schema: { type: 'OBJECT', properties: { answer: { type: 'STRING' } }, required: ['answer'] },
    temperature: 0.3
  });
  var answer = res.json && typeof res.json.answer === 'string' ? res.json.answer.trim() : '';
  if (!answer) return { error: 'llm_failed', message: '答えを生成できませんでした。質問を少し変えてもう一度お試しください' };
  return { answer: answer, model_used: res.model_used };
}

// 家庭教師プロンプト。最重要ルール＝「正解コードは丸ごと書かない」（§7の答えを明かさない方針）
function askSystemPrompt_() {
  return [
    'あなたはPython完全初心者の家庭教師。生徒がいま解いている問題について質問してくる。',
    '最重要ルール：【完成した正解コードは絶対に書かない】。答えを丸ごと教えず、生徒が自分で書けるように導く。',
    '- すべて日本語。専門用語には毎回短い説明を添える',
    '- 3〜5文ほどで簡潔に。次の一歩がはっきりわかる具体的なヒントを返す',
    '- 文法の小さな例（1〜2行）は出してよいが、その問題の解答そのものは出さない',
    '- 励ます調子で。詰まるのは普通のことだと伝える'
  ].join('\n');
}

function askUserPrompt_(payload, code, question) {
  return ['# いま解いている問題', JSON.stringify({
    statement: payload.statement, conditions: payload.conditions,
    example_call: payload.example_call, expected_output: payload.expected_output
  }), '# 生徒がいま書いているコード（空のこともある）', code || '(まだ何も書いていない)',
    '# 生徒の質問', question].join('\n');
}
