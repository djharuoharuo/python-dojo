// =====================================================================
// notion.js — その日の学習サマリを「日記」ページの python学習 セクションへ
// 自動追記する（§5 pushDiary）。
//
// 設計方針:
// - サマリ本文は【コードが組み立てる】。LLMは使わない（¥0・確実・ステートレス §0）
// - ゼロトラスト（§9）: Notionトークンは Script Properties のみ。フロントには置かない。
//   既存の日記システムとは別トークンを使う（侵害の横展開を遮断）
// - 1日1ブロック（トグル）に集約し、再実行時は古いブロックを消して置き換える＝重複しない
// =====================================================================

var NOTION_BASE = 'https://api.notion.com/v1';
var NOTION_VERSION = '2022-06-28';

function getNotionToken_() {
  var t = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!t) {
    var e = new Error('日記連携が未設定です（NOTION_TOKEN）。READMEの「日記連携」手順を確認してください');
    e.code = 'notion_unconfigured';
    throw e;
  }
  return t;
}

function getNotionDiaryDbId_() {
  var id = PropertiesService.getScriptProperties().getProperty('NOTION_DIARY_DB_ID');
  if (!id) {
    var e = new Error('日記連携が未設定です（NOTION_DIARY_DB_ID）。READMEの「日記連携」手順を確認してください');
    e.code = 'notion_unconfigured';
    throw e;
  }
  return id;
}

// Notion API 共通呼び出し。2xx以外は notion_failed として日本語メッセージで投げる
function notionFetch_(method, path, payload) {
  var opt = {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + getNotionToken_(),
      'Notion-Version': NOTION_VERSION
    },
    muteHttpExceptions: true
  };
  if (payload) opt.payload = JSON.stringify(payload);

  var res = UrlFetchApp.fetch(NOTION_BASE + path, opt);
  var code = res.getResponseCode();
  var json = {};
  try { json = JSON.parse(res.getContentText()); } catch (e) { /* 本文が空のこともある */ }
  if (code < 200 || code >= 300) {
    var msg = json && json.message ? json.message : ('HTTP ' + code);
    var err = new Error('Notionへの書き込みに失敗しました: ' + msg);
    err.code = 'notion_failed';
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------
// action: フロントが「今日の進歩」表示時に呼ぶ。今日の学習を日記へ反映する
// ---------------------------------------------------------------------
function actionPushDiary_(body) {
  var today = todayStr_(); // yyyy-MM-dd
  var summary = buildDiaryToggle_(today);
  if (!summary) return { ok: true, skipped: true, message: '今日の学習記録がまだないため、記録をスキップしました' };

  var page = findOrCreateDiaryPage_(today, summary);
  if (page.created) {
    // 新規作成時は本文（children）にトグルを入れ済み。置き換え管理は翌日からでよい
    setConf_('diary_block_date', today);
    setConf_('diary_block_id', '');
    return { ok: true, message: '今日の日記ページを作成し、学習内容を記録しました' };
  }

  // 既存ページ: 今日ぶんの古いトグルがあれば消してから入れ直す（重複防止）
  if (getConf_('diary_block_date', '') === today) {
    var oldId = getConf_('diary_block_id', '');
    if (oldId) {
      try { notionFetch_('delete', '/blocks/' + oldId, null); } catch (e) { /* 既に消えていてもよい */ }
    }
  }

  // python学習 見出しの直後へ。見出しが無ければ末尾へ追記
  var headingId = findPythonSectionHeading_(page.pageId);
  var appendBody = { children: [summary] };
  if (headingId) appendBody.after = headingId;

  var appendRes;
  try {
    appendRes = notionFetch_('patch', '/blocks/' + page.pageId + '/children', appendBody);
  } catch (e) {
    // after が使えない等で失敗したら、位置指定なしで末尾に追記して再試行
    appendRes = notionFetch_('patch', '/blocks/' + page.pageId + '/children', { children: [summary] });
  }

  var newId = appendRes.results && appendRes.results[0] ? appendRes.results[0].id : '';
  setConf_('diary_block_date', today);
  setConf_('diary_block_id', newId);
  return { ok: true, message: '今日の学習を日記に記録しました' };
}

// ---------------------------------------------------------------------
// サマリ本文（トグル1個）をコードで組み立てる。
// 含める: 解いた問題・正誤・ヒント有無・原因メモ・した質問・次に必要なこと
// ---------------------------------------------------------------------
function buildDiaryToggle_(today) {
  var attempts = readRows_('attempts').filter(function (a) {
    return String(a.timestamp).slice(0, 10) === today;
  });
  var asks = readRowsSafe_('asks').filter(function (a) {
    return String(a.timestamp).slice(0, 10) === today;
  });
  if (attempts.length === 0 && asks.length === 0) return null;

  var problems = {};
  readRows_('problems').forEach(function (p) {
    try { problems[p.problem_id] = JSON.parse(p.payload_json); } catch (e) { /* 無視 */ }
  });

  var correct = attempts.filter(function (a) { return a.verdict === '正解'; }).length;
  var children = [];
  children.push(bullet_('解いた問題: ' + attempts.length + '問（正解 ' + correct + '）'));

  // 問題ごとに1行＋（あれば）メモ・ミス傾向を子ブロックで
  attempts.forEach(function (a) {
    var pl = problems[a.problem_id] || {};
    var mark = a.verdict === '正解' ? '✅' : (a.verdict === '惜しい' ? '🟡' : '❌');
    var hint = a.hint_used === 'TRUE' ? '（ヒントあり）' : '（ノーヒント）';
    var num = pl.number ? ('問' + pl.number + ' ') : '';
    var line = mark + ' ' + num + (pl.title || '') + ' [' + a.type + '] ' + a.verdict + hint;
    var kids = [];
    if (a.self_note) kids.push(bullet_('原因メモ: ' + a.self_note));
    if (a.error_pattern && a.error_pattern !== 'なし') kids.push(bullet_('ミス傾向: ' + a.error_pattern));
    children.push(bulletWithChildren_(line, kids));
  });

  // した質問（要点のみ。答えは日記に載せず、アプリの履歴で読める）
  if (asks.length > 0) {
    var qkids = asks.map(function (a) { return bullet_('Q: ' + a.question); });
    children.push(bulletWithChildren_('先生にした質問: ' + asks.length + '件', qkids));
  }

  // 次に必要なこと（コードが決める）
  children.push(bullet_('次に必要なこと: ' + nextFocusText_(attempts)));

  var mmdd = Number(today.slice(5, 7)) + '/' + Number(today.slice(8, 10));
  return {
    object: 'block',
    type: 'toggle',
    toggle: { rich_text: rt_('🐍 Python道場 ' + mmdd + '（自動記録）'), children: children }
  };
}

// 今日間違えたパターン → 無ければ全体のボトルネック → から「次の一歩」を1文で
function nextFocusText_(attempts) {
  var patterns = {};
  attempts.forEach(function (a) {
    if (a.verdict !== '正解' && a.error_pattern && a.error_pattern !== 'なし') {
      patterns[a.error_pattern] = (patterns[a.error_pattern] || 0) + 1;
    }
  });
  var list = Object.keys(patterns);
  if (list.length > 0) return list.join('・') + ' を意識して復習する';
  var top = topMistakes_()[0];
  return top ? (top.pattern + ' のパターンを引き続き意識する') : 'ノーヒントで解ける問題を増やす';
}

// ---------------------------------------------------------------------
// 日記ページの特定・作成
// ---------------------------------------------------------------------
function findOrCreateDiaryPage_(today, toggleBlock) {
  var dbId = getNotionDiaryDbId_();

  // 1) 作成日 == today で検索（最も確実）
  var q1 = notionFetch_('post', '/databases/' + dbId + '/query', {
    filter: { property: '作成日', date: { equals: today } },
    page_size: 1
  });
  if (q1.results && q1.results.length > 0) return { pageId: q1.results[0].id, created: false };

  // 2) タイトル（例: 2026/6/14）一致で検索（フォールバック）
  var titleStr = diaryTitle_(today);
  var q2 = notionFetch_('post', '/databases/' + dbId + '/query', {
    filter: { property: 'タイトル', title: { equals: titleStr } },
    page_size: 1
  });
  if (q2.results && q2.results.length > 0) return { pageId: q2.results[0].id, created: false };

  // 3) 無ければ新規作成（python学習 見出し＋トグルを本文に入れる）
  var created = notionFetch_('post', '/pages', {
    parent: { database_id: dbId },
    properties: {
      'タイトル': { title: rt_(titleStr) },
      '作成日': { date: { start: today } },
      'タグ': { multi_select: [{ name: '復習' }] }
    },
    children: [
      { object: 'block', type: 'heading_1', heading_1: { rich_text: rt_('python学習') } },
      toggleBlock
    ]
  });
  return { pageId: created.id, created: true };
}

// ページ直下の見出しから「python学習」を探してブロックIDを返す（無ければ null）
function findPythonSectionHeading_(pageId) {
  var res = notionFetch_('get', '/blocks/' + pageId + '/children?page_size=100', null);
  var blocks = res.results || [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var t = b.type;
    if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') {
      var rich = (b[t] && b[t].rich_text) ? b[t].rich_text : [];
      var txt = rich.map(function (r) { return r.plain_text || (r.text && r.text.content) || ''; }).join('');
      if (txt.replace(/\s/g, '').toLowerCase().indexOf('python学習') !== -1) return b.id;
    }
  }
  return null;
}

// yyyy-MM-dd → 「YYYY/M/D」（先頭ゼロ無し。既存日記のタイトル書式に合わせる）
function diaryTitle_(today) {
  return today.slice(0, 4) + '/' + Number(today.slice(5, 7)) + '/' + Number(today.slice(8, 10));
}

// ---------------------------------------------------------------------
// Notion ブロック生成ヘルパー
// ---------------------------------------------------------------------
function rt_(text) {
  return [{ type: 'text', text: { content: String(text).slice(0, 1900) } }];
}
function bullet_(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt_(text) } };
}
function bulletWithChildren_(text, kids) {
  var b = { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt_(text) } };
  if (kids && kids.length) b.bulleted_list_item.children = kids;
  return b;
}
