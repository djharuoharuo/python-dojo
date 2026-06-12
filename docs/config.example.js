// =====================================================================
// config.example.js — config.js の見本。
// 本物の config.js はリポジトリに置かない（§9-5）。
// GitHub Actions（deploy.yml）が Repository Secrets の GAS_URL / APP_TOKEN
// からデプロイ時に自動生成して Pages に注入する。
// ローカル開発時だけ、このファイルを config.js にコピーして値を埋める
// （docs/config.js は .gitignore 済みなのでコミットされない）。
// =====================================================================
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  APP_TOKEN: 'ここに長いランダム文字列'
};
