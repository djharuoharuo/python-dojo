// =====================================================================
// api.js — GAS Web API クライアント。
// GASはOPTIONSプリフライトを処理できないため、Content-Type: text/plain で
// JSON文字列をPOSTする（simple requestにしてCORSプリフライトを回避 §5）。
// =====================================================================

// 失敗時に日本語メッセージを持つエラー（呼び出し側はそのまま画面に出せる）
class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

async function api(action, params) {
  // config.js（GitHub Actionsが生成）が無いと何もできない。先に明示する
  if (typeof CONFIG === 'undefined' || !CONFIG.GAS_URL || !CONFIG.APP_TOKEN) {
    throw new ApiError('config', 'config.js がありません。README の手順4（Secrets設定とPagesデプロイ）を確認してください');
  }
  if (!navigator.onLine) {
    throw new ApiError('offline', 'ネット接続がありません。[実行]だけはオフラインでも使えます。採点・出題は接続後にどうぞ');
  }

  let res;
  try {
    res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(Object.assign({ token: CONFIG.APP_TOKEN, action }, params || {}))
    });
  } catch (e) {
    throw new ApiError('network', '通信に失敗しました。電波の良い場所でもう一度お試しください');
  }
  if (!res.ok) {
    throw new ApiError('http', 'サーバが応答しません（HTTP ' + res.status + '）。少し待ってからもう一度お試しください');
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new ApiError('parse', 'サーバ応答を読めませんでした。GASのデプロイ設定（アクセス: 全員）を確認してください');
  }
  // GASは失敗を {error, message} で返す（§5）。ここで例外に変換して一元処理
  if (json && json.error) {
    throw new ApiError(json.error, json.message || 'エラーが発生しました（' + json.error + '）');
  }
  return json;
}
