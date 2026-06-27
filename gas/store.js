// =====================================================================
// store.js — スプレッドシート読み書き（学習者モデルの唯一の保存先）
// シートの構造はここで一元定義する。他ファイルは必ずこの関数経由で読み書きする。
// =====================================================================

// 各タブのヘッダー定義（setup.js のシート作成でもこれを使う）
var SHEET_HEADERS = {
  concepts: [
    'concept_id', 'name', 'state', 'prereq', 'no_review',
    'due', 'stability', 'difficulty', 'reps', 'lapses', 'last_review',
    'nohint_streak', 'nohint_correct_days',
    // 由来。空＝シード（§10の初期概念）、'capture'＝本で読んで自分で捕捉した概念（学習キャプチャ）。
    // capture概念は「検証ゲートを通った問題」だけを出す（§2）ので、未検証の通常generateからは除外する。
    // aliases＝名寄せ（§5）用の別名（カンマ区切り。同義語を二重登録しないため）
    // ※ 列は必ず末尾に追加（既存行の列位置がずれないように）
    'source', 'aliases'
  ],
  problems: [
    'problem_id', 'number', 'concept_id', 'type', 'payload_json', 'status', 'created_at',
    // 学習キャプチャ用（§2 検証ゲート）。verified='TRUE' は Pyodide で実行して正解を確定済み。
    // source='capture' は本で読んで捕捉した概念から作った問題。どちらも末尾追加・空欄は後方互換
    'verified', 'source'
  ],
  attempts: [
    'attempt_id', 'timestamp', 'problem_id', 'concept_id', 'type', 'verdict',
    'hint_used', 'error_pattern', 'self_note', 'code', 'stdout', 'stderr', 'model_used',
    'feedback_json',
    // 本番 / 練習。過去問の「再挑戦」は '練習' として記録だけ残し、FSRS・昇級/降格・
    // 難易度クランプ・ミス集計・リベンジには一切混ぜない（空欄は本番扱い・後方互換）。
    // ※ 必ず末尾に追加すること（既存行の列位置がずれないように）
    'mode',
    // [▶実行] の試行ログ（コード・出力・エラーの履歴JSON）。採点で消える「正解前の試行錯誤」を
    // 残し、どう間違えてどう直したかを履歴で振り返れるようにする（末尾追加・空欄は後方互換）
    'runs_json'
  ],
  // 先生にした質問とその回答（履歴閲覧の素材。§5 ask が追記する）
  asks: ['ask_id', 'timestamp', 'problem_id', 'concept_id', 'question', 'answer', 'model_used'],
  // 解答の途中保存（下書き）。PC↔スマホで続きから再開するためサーバにも持つ（§8-2）
  drafts: ['problem_id', 'updated_at', 'code', 'hints_json', 'asks_json', 'hint_used'],
  // リベンジ再テスト：間違えた問題を数日後に類題で再出題するための待ち行列（§6 テスト効果）
  revenge: ['problem_id', 'concept_id', 'due', 'status'],
  mistakes: ['pattern', 'count', 'last_seen'],
  // 学習キャプチャ：本で読んで「学んだこと」を1行記録し、名寄せ結果の概念に紐づける（学習キャプチャ §8）。
  // この概念がFSRS復習キューに乗り、検証済みの問題が生成される。generated_problem_ids は生成した問題のID（カンマ区切り）
  learning_log: ['log_id', 'timestamp', 'raw_text', 'self_explanation', 'source_ref', 'concept_id', 'generated_problem_ids'],
  config: ['key', 'value']
};

// スプレッドシート本体を開く。IDは setup() が Script Properties に保存している
function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('SPREADSHEET_ID が未設定です。GASエディタで setup() を一度実行してください');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('シート「' + name + '」がありません。setup() を実行してください');
  return sheet;
}

// セル値を文字列に正規化する。
// Sheetsは日付っぽい文字列をDate型に変えてしまうことがあるため、ここで吸収する
function cellToString_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

// タブ全体を「ヘッダー名→値（文字列）」のオブジェクト配列で読む
function readRows_(name) {
  var sheet = getSheet_(name);
  var values = sheet.getDataRange().getValues();
  var headers = SHEET_HEADERS[name];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = cellToString_(values[i][j]);
    }
    row._rowIndex = i + 1; // 更新時に使うシート上の行番号（1始まり）
    rows.push(row);
  }
  return rows;
}

// タブが存在すれば readRows_、無ければ空配列を返す。
// 後から追加したタブ（asks 等）が migrate 未実行の環境でも落ちないようにする保険
function readRowsSafe_(name) {
  try {
    if (!getSpreadsheet_().getSheetByName(name)) return [];
  } catch (e) {
    return [];
  }
  return readRows_(name);
}

// オブジェクトを1行追記する（ヘッダー順に並べ替えて書く）
function appendRowObj_(name, obj) {
  var headers = SHEET_HEADERS[name];
  var row = headers.map(function (h) {
    return obj[h] !== undefined && obj[h] !== null ? obj[h] : '';
  });
  getSheet_(name).appendRow(row);
}

// keyCol = keyVal の最初の行に updates（列名→値）を適用する。見つかれば true
function updateRowWhere_(name, keyCol, keyVal, updates) {
  var rows = readRows_(name);
  var headers = SHEET_HEADERS[name];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][keyCol] === String(keyVal)) {
      var sheet = getSheet_(name);
      for (var col in updates) {
        var colIndex = headers.indexOf(col);
        if (colIndex === -1) throw new Error('不明な列: ' + name + '.' + col);
        sheet.getRange(rows[i]._rowIndex, colIndex + 1).setValue(updates[col]);
      }
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------
// config タブ（key-value）ヘルパー
// ---------------------------------------------------------------------

function getConfigAll_() {
  var rows = readRows_('config');
  var conf = {};
  rows.forEach(function (r) { conf[r.key] = r.value; });
  return conf;
}

function getConf_(key, fallback) {
  var conf = getConfigAll_();
  return conf[key] !== undefined && conf[key] !== '' ? conf[key] : fallback;
}

// 既存キーは更新、なければ追加（upsert）
function setConf_(key, value) {
  if (!updateRowWhere_('config', 'key', key, { value: value })) {
    appendRowObj_('config', { key: key, value: value });
  }
}

// ---------------------------------------------------------------------
// 日付ヘルパー（タイムゾーンは appsscript.json の Asia/Tokyo）
// ---------------------------------------------------------------------

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function dateStr_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// 「yyyy-MM-dd」文字列に日数を足した文字列を返す
function addDaysStr_(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return dateStr_(d);
}

// ---------------------------------------------------------------------
// mistakes タブ集計（error_pattern の count++ と last_seen 更新）
// ---------------------------------------------------------------------

function bumpMistake_(pattern) {
  var rows = readRows_('mistakes');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].pattern === pattern) {
      updateRowWhere_('mistakes', 'pattern', pattern, {
        count: Number(rows[i].count || 0) + 1,
        last_seen: todayStr_()
      });
      return;
    }
  }
  appendRowObj_('mistakes', { pattern: pattern, count: 1, last_seen: todayStr_() });
}

// mistakes を count 降順で返す（先頭が「今日のボトルネック」）
function topMistakes_() {
  return readRows_('mistakes').sort(function (a, b) {
    return Number(b.count || 0) - Number(a.count || 0);
  });
}
