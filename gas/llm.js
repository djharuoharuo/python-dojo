// =====================================================================
// llm.js — Gemini API 呼び出し（モデルチェーン・日次予算・週次ヘルスチェック）
// LLMはステートレスな関数として使う。状態はすべて config タブに持つ。
// =====================================================================

var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function getGeminiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY が未設定です。Script Properties に登録してください');
  return key;
}

// ---------------------------------------------------------------------
// 日次予算（乱用ガード）。TOKENが漏れても無料枠の枯渇を1日分で食い止める
// ---------------------------------------------------------------------
function consumeBudget_() {
  var today = todayStr_();
  var conf = getConfigAll_();
  var used = conf.llm_budget_date === today ? Number(conf.llm_budget_used || 0) : 0;
  var budget = Number(conf.daily_llm_budget || 60);
  if (used >= budget) {
    setConf_('model_notice', '⚠️ 本日のLLM呼び出し上限（' + budget + '回）に達しました。明日また再開できます');
    var err = new Error('本日のLLM呼び出し上限に達しました。明日また学習を再開してください');
    err.code = 'budget';
    throw err;
  }
  setConf_('llm_budget_date', today);
  setConf_('llm_budget_used', used + 1);
}

// ---------------------------------------------------------------------
// Gemini 呼び出し本体。
// model_chain（config）を上から順に試し、429/404/5xx は次のモデルへ。
// 戻り値: { json: パース済みオブジェクト, model_used: 実際に使ったモデル名 }
// ---------------------------------------------------------------------
function callGemini_(opts) {
  // opts: { system, user, schema, temperature }
  consumeBudget_();
  var chain = String(getConf_('model_chain', 'gemini-2.5-flash,gemini-2.5-flash-lite'))
    .split(',').map(function (s) { return s.trim(); }).filter(String);
  var lastError = null;

  for (var m = 0; m < chain.length; m++) {
    var model = chain[m];
    // 一時障害（429/5xx）は同一モデルで指数バックオフ2回まで再試行
    for (var attempt = 0; attempt < 2; attempt++) {
      var res;
      try {
        res = UrlFetchApp.fetch(GEMINI_BASE + '/models/' + model + ':generateContent', {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': getGeminiKey_() },
          payload: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            contents: [{ role: 'user', parts: [{ text: opts.user }] }],
            generationConfig: {
              temperature: opts.temperature,
              responseMimeType: 'application/json',
              responseSchema: opts.schema
            }
          }),
          muteHttpExceptions: true
        });
      } catch (e) {
        lastError = e; // ネットワーク例外も次の試行へ
        continue;
      }
      var code = res.getResponseCode();
      if (code === 200) {
        var parsed = parseGeminiResponse_(res.getContentText());
        if (parsed !== null) {
          recordModelUsed_(model, chain[0]);
          return { json: parsed, model_used: model };
        }
        lastError = new Error('Geminiの応答JSONを解釈できませんでした');
        break; // パース不能の再生成は呼び出し側の責務（§6）
      }
      if (code === 404) { lastError = new Error(model + ' は廃止された可能性があります(404)'); break; } // 廃止→即次モデル
      lastError = new Error(model + ' がHTTP ' + code + ' を返しました');
      if (code === 429 || code >= 500) {
        Utilities.sleep(1000 * Math.pow(2, attempt)); // 1秒→2秒
        continue;
      }
      break; // 400系のその他は再試行しても無駄
    }
  }
  var err = new Error('すべてのモデル（' + chain.join(', ') + '）が失敗しました: ' +
    (lastError ? lastError.message : '不明') + '。少し待ってからもう一度お試しください');
  err.code = 'llm_failed';
  throw err;
}

// candidates[0] からテキストを取り出してJSONパース。失敗は null
function parseGeminiResponse_(bodyText) {
  try {
    var body = JSON.parse(bodyText);
    var text = body.candidates[0].content.parts[0].text;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// 実際に使ったモデルを記録し、チェーン先頭と違えば通知を残す（§5b）
function recordModelUsed_(model, primary) {
  var last = getConf_('model_last_used', '');
  if (last !== model) {
    setConf_('model_last_used', model);
    if (model !== primary) {
      setConf_('model_notice', '⚠️ ' + primary + ' が利用不可のため ' + model + ' で動作中');
    }
  }
}

// ---------------------------------------------------------------------
// 週次ヘルスチェック（getToday から呼ばれる）。
// models.list でチェーン内モデルの存在を確認し、消えたものは外して通知する
// ---------------------------------------------------------------------
function maybeHealthCheckModels_() {
  var checkedAt = getConf_('model_checked_at', '');
  if (checkedAt && addDaysStr_(checkedAt, 7) > todayStr_()) return; // 7日以内なら何もしない
  try {
    var res = UrlFetchApp.fetch(GEMINI_BASE + '/models?pageSize=200', {
      headers: { 'x-goog-api-key': getGeminiKey_() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return; // チェック自体の失敗は致命的でないので黙ってスキップ
    var available = {};
    (JSON.parse(res.getContentText()).models || []).forEach(function (m) {
      available[String(m.name).replace('models/', '')] = true;
    });
    var chain = String(getConf_('model_chain', '')).split(',')
      .map(function (s) { return s.trim(); }).filter(String);
    var alive = chain.filter(function (m) { return available[m]; });
    if (alive.length > 0 && alive.length < chain.length) {
      var removed = chain.filter(function (m) { return !available[m]; });
      setConf_('model_chain', alive.join(','));
      setConf_('model_notice', '⚠️ モデル ' + removed.join(', ') +
        ' が提供終了したためチェーンから外しました（現在: ' + alive.join(' → ') + '）');
    }
    setConf_('model_checked_at', todayStr_());
  } catch (e) {
    // ヘルスチェックは学習を止めない（次回 getToday で再試行される）
  }
}
