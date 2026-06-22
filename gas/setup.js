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
// migrate — 既に setup() 済みのスプレッドシートに、後から追加したタブを
// 補う（何度実行しても安全）。新機能の追加時にGASエディタから一度だけ手で
// 実行する。setup() と違い既存データは消さない。
// 例：履歴機能で追加した asks タブを既存シートに足す。
// ---------------------------------------------------------------------
function migrate() {
  ensureTabs_();
  Logger.log('migrate 完了');
}

// 不足しているタブの作成と、既存タブの列の後付けを行う（migrate / reseed の共通処理）。
// 列定義は store.js の SHEET_HEADERS が唯一の正。既存データ行は壊さない。
function ensureTabs_() {
  var ss = getSpreadsheet_();
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var headers = SHEET_HEADERS[name];
    var sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getDataRange().setNumberFormat('@');
      sheet.setFrozenRows(1);
      Logger.log('タブを作成しました: ' + name);
      return;
    }

    // 既存タブで列が足りなければヘッダーを後付け（例: attempts に feedback_json）。
    // 既存データ行はその列が空になるだけで読み書きは壊れない
    if (sheet.getLastColumn() < headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
      Logger.log('列を追加しました: ' + name + '（' + headers.join(', ') + '）');
    }
  });
}

// ---------------------------------------------------------------------
// reseed — 学習者モデルを「リアルな現在地」から作り直す（§10 再調整）。
// アプリ運用で溜まった【不適合な蓄積】（過去問・解答ログ・下書き・リベンジ・
// 質問）を全消去し、concepts / mistakes / config を超初心者向けに再シードする。
// setup() と違いスプレッドシート自体は作り直さない（SPREADSHEET_ID は保持）。
//
// ⚠️ 破壊的：problems / attempts などの実データ行を消す。GASエディタから
//   一度だけ手で実行する。スマホで開く前にこれを1回流せば、次に開いたとき
//   不適合な蓄積が消え、honestなベースラインから始まる。
// ---------------------------------------------------------------------
function reseed() {
  ensureTabs_(); // 不足タブ・不足列をまず整える（古い環境でも安全に動かすため）
  var ss = getSpreadsheet_();

  // 1) 「不適合な蓄積」を消す：ヘッダー（1行目）は残してデータ行だけ全削除
  ['problems', 'attempts', 'drafts', 'revenge', 'asks'].forEach(function (name) {
    clearDataRows_(ss.getSheetByName(name));
  });

  // 2) 現在地を作り直す：concepts / mistakes / config を消して超初心者ベースで再投入
  ['concepts', 'mistakes', 'config'].forEach(function (name) {
    clearDataRows_(ss.getSheetByName(name));
  });
  seedConcepts_();
  seedMistakes_();
  seedConfig_();

  Logger.log('reseed 完了：不適合な蓄積を消去し、超初心者ベースラインで再シードしました');
}

// シートのヘッダー（1行目）を残してデータ行（2行目以降）を全削除する
function clearDataRows_(sheet) {
  if (!sheet) return; // 無いタブは ensureTabs_ で作られる
  var last = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
}

// §10 concepts 初期状態。
// Notionの📊学習ステータスのラベルではなく、実際の解答内容（問題集④⑤⑥の答案）で
// 校正した「ホントの現在地」。要点：
//  - total / for+if は📊では✅だったが、答案では return total 忘れ・+1忘れ・問題読み違いが
//    残るため【練習中に降格】（足場を外さない＝ノーヒント/デバッグに進めない）
//  - 最大値探索は㉒でヒント要・㉗誤読・㉘で3箇所同時崩壊＝まだ未定着の最優先弱点。
//    練習中の【先頭】に置き、毎セッションの練習対象に surface させる（pickSlots_ は
//    lapses→nohint_streak→シート順で並べるため、同点なら上にある概念が選ばれる）
//  - while は㉙㉚を作っただけで未着手＝未。次に解放する新規概念はこれ1つ
//  - 新規概念は「現在の基礎が習得になるまで出さない」。そのため str_fstring の前提を
//    print（常時習得）から for_range に変更し、while と同じゲートに揃える（一度に
//    新しい考えを増やさない＝超初心者の足場固め優先）
function seedConcepts_() {
  var rows = [
    // [concept_id, name, state, prereq, no_review, due, stability, difficulty, reps, lapses, last_review]
    ['print', 'print', '習得', '', 'TRUE', '', '', '', '', '', ''],
    // ↓ 練習中（弱い順に上から。最優先弱点を先頭に）
    ['max_search', '最大値・最小値探索', '練習中', '', '', '', '', '', '', '', ''], // 最優先弱点
    ['total', 'total累積', '練習中', '', '', '', '', '', '', '', ''],   // ✅→練習中に降格
    ['for_if', 'for+if組合せ', '練習中', '', '', '', '', '', '', '', ''], // ✅→練習中に降格
    ['def_args_return', 'def・引数・return', '練習中', '', '', '', '', '', '', '', ''],
    ['for_range', 'for / range', '練習中', '', '', '', '', '', '', '', ''],
    ['if_else', 'if / else', '練習中', '', '', '', '', '', '', '', ''],
    ['mod', '剰余（%）', '練習中', '', '', '', '', '', '', '', ''],
    // traceback は常時並行扱い（新規解放の対象外。generate.js の UNLOCK_EXCLUDED 参照）
    ['traceback', 'Tracebackを読む', '未', '', '', '', '', '', '', '', ''],
    // ↓ 次の段階（基礎が習得になって初めて1つずつ解放。最初に解放されるのは while）
    ['while', 'while', '未', 'for_range', '', '', '', '', '', '', ''],
    ['str_fstring', '文字列・f-string', '未', 'for_range', '', '', '', '', '', '', ''],
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

// §10 mistakes 初期値。問題集④⑤⑥の答案に実際に現れた頻度で校正（多い順）。
// 「今日のボトルネック」表示とデバッグ問題の素材になるため、本当に多いミスを上に。
// ※ パターン名は grade.js の error_pattern enum に揃える（デバッグ問題で再現するため）
function seedMistakes_() {
  var seed = [
    ['スペルミス', 4],   // evan/spcial/evna… 最頻
    ['range+1忘れ', 3],  // range(1,n) で +1 抜け（㉖ ほか頻発）
    ['比較対象ミス', 2], // 最大値探索で何と比べるかを取り違える（㉗㉘）
    ['更新方向逆', 2],   // max更新の向き・代入先ミス（㉘）
    ['未定義変数', 2],   // max=a で a が未定義（㉘）
    ['return忘れ', 2],   // return の後に total を書き忘れ（㉓）
    ['初期値設計', 2]    // max_num の初期値設計（㉒ ヒント要）
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
    // 題材は超初心者向けに再調整：Notionで実際にできていた「素朴な数の問題（基礎）」を主軸に。
    // 音楽はBPM等の身近な題材で動機づけ（計算は1ステップ）。セキュリティ題材は基礎が固まるまで
    // 一旦0（ログ集計等は知らない題材が syntax の上に乗って難しすぎたため。卒業目標としては §11 capstone_zt に温存）。
    ['theme_weights', '基礎:0.6,音楽:0.3,日常:0.1'],
    ['target_acc_low', 0.75],
    ['target_acc_high', 0.90],
    // 足場外し（ノーヒント/デバッグ）に切り替わる連続正解数。超初心者のうちは長めに保ち、
    // 構文を自分で選ばせる前に実装精度（スペル・+1・初期値）を固める（3→5）
    ['nohint_threshold', 5],
    ['daily_llm_budget', 60],
    // モデル名はハードコード禁止（§6）。2026-05にGAになった gemini-3.5-flash を先頭に、
    // 落ちたとき用に 2.5 系へフォールバック。チェーンはこのセル1つの書き換えで更新できる（§5b）
    ['model_chain', 'gemini-3.5-flash,gemini-2.5-flash,gemini-2.5-flash-lite'],
    ['model_last_used', ''],
    ['model_checked_at', ''],
    ['model_notice', ''],
    // セキュリティ題材の自動解放（§6）。基礎が全部習得になったら generate が一度だけ
    // theme_weights を戻し、theme_ramp_done=TRUE にしてお祝い通知を theme_notice に書く
    ['theme_ramp_done', ''],
    ['theme_notice', ''],
    // Stage1（読む段=出力予測/トレース）を1セッションに1問混ぜる（§スキルラダー）。FALSEで停止
    ['trace_enabled', 'TRUE'],
    ['llm_budget_date', ''],
    ['llm_budget_used', 0],
    ['streak_freeze_used_week', ''] // Phase 2 用
  ];
  conf.forEach(function (c) {
    appendRowObj_('config', { key: c[0], value: c[1] });
  });
}
