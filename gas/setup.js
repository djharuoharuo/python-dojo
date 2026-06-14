// =====================================================================
// setup.js — 初回セットアップ（GASエディタから setup() を1回だけ手で実行する）
// スプレッドシート作成 → タブ＋ヘッダー作成 → §10のシードデータ投入 →
// SPREADSHEET_ID を Script Properties に保存、まで全自動。
// =====================================================================

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SPREADSHEET_ID')) {
    throw new Error('SPREADSHEET_ID が既に設定されています。作り直す場合はScript Propertiesから削除してから実行してください');
  }
  var ss = SpreadsheetApp.create('python-dojo-data');
  props.setProperty('SPREADSHEET_ID', ss.getId());

  // タブ＋ヘッダー作成（列定義は store.js の SHEET_HEADERS が唯一の正）
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SHEET_HEADERS[name].length).setValues([SHEET_HEADERS[name]]);
    // 日付や数値文字列をSheetsに勝手に型変換させない（読み書きの揺れを防ぐ）
    sheet.getDataRange().setNumberFormat('@');
    sheet.setFrozenRows(1);
  });
  ss.deleteSheet(ss.getSheetByName('シート1') || ss.getSheets()[0]);

  seedConcepts_();
  seedMistakes_();
  seedConfig_();
  Logger.log('セットアップ完了。スプレッドシート: ' + ss.getUrl());
  Logger.log('次の手順: Script Properties に GEMINI_API_KEY と APP_TOKEN を設定 → ウェブアプリとしてデプロイ');
}

// ---------------------------------------------------------------------
// migrate — 既に setup() 済みのスプレッドシートに、後から追加したタブ・
// configキーを補う（何度実行しても安全）。新機能の追加時にGASエディタから
// 一度だけ手で実行する。setup() と違い既存データは消さない。
// ---------------------------------------------------------------------
function migrate() {
  var ss = getSpreadsheet_();

  // 不足しているタブを作る（列定義は store.js の SHEET_HEADERS が唯一の正）
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    if (ss.getSheetByName(name)) return;
    var sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SHEET_HEADERS[name].length).setValues([SHEET_HEADERS[name]]);
    sheet.getDataRange().setNumberFormat('@');
    sheet.setFrozenRows(1);
    Logger.log('タブを作成しました: ' + name);
  });

  // 不足しているconfigキーを補う（日記連携の置き換え管理用など、後付け設定）
  var conf = getConfigAll_();
  var defaults = { diary_block_id: '', diary_block_date: '' };
  Object.keys(defaults).forEach(function (k) {
    if (conf[k] === undefined) {
      appendRowObj_('config', { key: k, value: defaults[k] });
      Logger.log('config に追加しました: ' + k);
    }
  });

  Logger.log('migrate 完了');
}

// §10 concepts 初期状態（2026-06-12時点のNotionシステムから移植）
function seedConcepts_() {
  var rows = [
    // [concept_id, name, state, prereq, no_review, due, stability, difficulty, reps, lapses, last_review]
    ['print', 'print', '習得', '', 'TRUE', '', '', '', '', '', ''],
    ['def_args_return', 'def・引数・return', '練習中', '', '', '', '', '', '', '', ''],
    ['for_range', 'for / range', '練習中', '', '', '', '', '', '', '', ''],
    ['if_else', 'if / else', '練習中', '', '', '', '', '', '', '', ''],
    ['mod', '剰余（%）', '練習中', '', '', '', '', '', '', '', ''],
    ['total', 'total累積', '習得', '', '', '2026-06-18', '7', '5', '3', '0', '2026-06-11'],
    ['for_if', 'for+if組合せ', '習得', '', '', '2026-06-18', '7', '5', '3', '0', '2026-06-11'],
    ['max_search', '最大値・最小値探索', '練習中', '', '', '', '', '', '', '', ''], // 最優先弱点
    // traceback は常時並行扱い（新規解放の対象外。generate.js の UNLOCK_EXCLUDED 参照）
    ['traceback', 'Tracebackを読む', '未', '', '', '', '', '', '', '', ''],
    ['while', 'while', '未', 'for_range', '', '', '', '', '', '', ''],
    ['str_fstring', '文字列・f-string', '未', 'print', '', '', '', '', '', '', ''],
    ['list_basic', 'list・append・index・slice', '未', 'for_range', '', '', '', '', '', '', ''],
    ['dict_basic', '辞書', '未', 'list_basic', '', '', '', '', '', '', ''],
    ['try_except', 'エラー処理 try/except（fail closed）', '未', 'list_basic', '', '', '', '', '', '', ''],
    ['file_io', 'ファイル読み書き', '未', 'str_fstring,list_basic', '', '', '', '', '', '', ''],
    ['sec_stdlib', 'セキュリティ標準ライブラリ入門（hashlib/secrets/datetime/re）', '未', 'dict_basic,try_except', '', '', '', '', '', '', ''],
    ['capstone_zt', '卒業制作：ミニ・ゼロトラストゲート', '未', 'file_io,sec_stdlib', '', '', '', '', '', '', '']
  ];
  rows.forEach(function (r) {
    appendRowObj_('concepts', {
      concept_id: r[0], name: r[1], state: r[2], prereq: r[3], no_review: r[4],
      due: r[5], stability: r[6], difficulty: r[7], reps: r[8], lapses: r[9],
      last_review: r[10], nohint_streak: 0, nohint_correct_days: ''
    });
  });
}

// §10 mistakes 初期値（旧システムで蓄積したミス傾向）
function seedMistakes_() {
  var seed = [
    ['未定義変数', 1], ['range+1忘れ', 2], ['比較対象ミス', 1], ['更新方向逆', 1],
    ['return忘れ', 1], ['スペルミス', 1], ['初期値設計', 2]
  ];
  seed.forEach(function (m) {
    appendRowObj_('mistakes', { pattern: m[0], count: m[1], last_seen: todayStr_() });
  });
}

// §4 config 既定値
function seedConfig_() {
  var conf = [
    ['last_problem_number', 30], // 旧Notion問題集の㉚まで使用済み。本アプリは31から
    ['daily_count', 3],
    ['theme_weights', '音楽:0.4,セキュリティ:0.3,日常:0.3'],
    ['target_acc_low', 0.75],
    ['target_acc_high', 0.90],
    ['nohint_threshold', 3],
    ['daily_llm_budget', 60],
    ['model_chain', 'gemini-2.5-flash,gemini-2.5-flash-lite'],
    ['model_last_used', ''],
    ['model_checked_at', ''],
    ['model_notice', ''],
    ['llm_budget_date', ''],
    ['llm_budget_used', 0],
    ['streak_freeze_used_week', ''] // Phase 2 用
  ];
  conf.forEach(function (c) {
    appendRowObj_('config', { key: c[0], value: c[1] });
  });
}
