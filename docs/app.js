// =====================================================================
// app.js — 画面遷移と状態管理（すべてコードが持つ。LLMには持たせない）。
// 画面は3つ：ホーム / 問題 / 今日の進歩サマリ。
// =====================================================================

const $ = (id) => document.getElementById(id);

const state = {
  problems: [],      // 未回答問題 [{problem_id, type, payload}]
  masteredConcepts: [], // 習得済み概念ID（解放ツールの判定用 §11）
  serverDrafts: {},  // サーバ保存の下書き（getTodayが返す。PC↔スマホ共有）
  current: null,     // いま解いている問題
  practice: false,   // 過去問の再挑戦（練習モード）か。記録は残すが学習計画には反映しない
  ran: false,        // [実行]済みか（採点ボタンの活性条件 §7）
  lastRun: { stdout: '', stderr: '' },
  hintUsed: false,   // この問題で一度でもヒント・質問を使ったか
  hints: [],         // この問題で表示したヒント（途中保存・復元用）
  hintLevel: 0,      // 段階ヒントの到達レベル（押すほど詳しく 1→2→3）
  gradedCode: '',    // 採点したコード（結果画面で正解と見比べる）
  asks: [],          // この問題で先生にした質問と回答（途中保存・復元用）
  attemptId: null,   // full採点が発番したID（saveSelfNote用）
  session: { total: 0, correct: 0, close: 0, hintCorrect: 0, changes: [] } // 今日の進歩サマリ素材
};

// ---------------------------------------------------------------------
// 解答の途中保存（下書き）。ブラウザ内（localStorage）に問題ごとに保存する。
// コード・もらったヒント・した質問をまとめて残し、同じ問題を開くと続きから再開できる。
// 通信もGASも使わないので、圏外でも保存でき、サーバ更新も不要。
// ---------------------------------------------------------------------
const DRAFT_PREFIX = 'dojo-draft-';
const draftKey = (id) => DRAFT_PREFIX + id;

function saveDraft(showStatus) {
  if (!state.current) return;
  // 再挑戦（練習モード）は下書きを残さない＝次に開いた時もまっさらにするため
  if (state.practice) return;
  try {
    localStorage.setItem(draftKey(state.current.problem_id), JSON.stringify({
      code: $('editor').value,
      hints: state.hints,
      hintLevel: state.hintLevel,
      asks: state.asks,
      hintUsed: state.hintUsed,
      savedAt: Date.now()      // どちらが新しいか比較するため（PC↔スマホ）
    }));
    if (showStatus) flashDraftSaved();
  } catch (e) {
    // 保存容量超過などでも学習は止めない（黙って失敗しない方針だが下書きは補助機能）
  }
  scheduleServerSync(); // サーバにも反映（少し待ってまとめて送る）
}

function loadDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); }
  catch (e) { return null; }
}

function clearDraft(id) {
  try { localStorage.removeItem(draftKey(id)); } catch (e) { /* 無くてもよい */ }
}

// 下書きをサーバ（スプレッドシート）へ同期する。別端末から続きを開けるようにする。
// 失敗（オフライン等）してもlocalStorageには残るので学習は止まらない
let serverSyncTimer = null;
function scheduleServerSync() {
  clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(syncDraftToServer, 1500);
}
async function syncDraftToServer() {
  if (!state.current) return;
  try {
    await api('saveDraft', {
      problem_id: state.current.problem_id,
      code: $('editor').value,
      hints: state.hints,
      asks: state.asks,
      hint_used: state.hintUsed
    });
  } catch (e) { /* オフライン等はlocalStorageが受け持つ */ }
}
// 解き終えた問題の下書きをサーバからも消す（空で保存＝サーバ側で行削除）
async function clearServerDraft(problemId) {
  try {
    await api('saveDraft', { problem_id: problemId, code: '', hints: [], asks: [], hint_used: false });
  } catch (e) { /* 消せなくても次回上書きで整う */ }
}

// サーバ下書きとローカル下書きの新しい方を選ぶ（updated_at / savedAt で比較）
function pickNewerDraft(server, local) {
  if (server && local) {
    const st = server.updated_at ? Date.parse(server.updated_at) : 0;
    const lt = local.savedAt || 0;
    return st >= lt ? normalizeServerDraft(server) : local;
  }
  if (server) return normalizeServerDraft(server);
  return local;
}
function normalizeServerDraft(s) {
  return {
    code: s.code || '',
    hints: Array.isArray(s.hints) ? s.hints : [],
    asks: Array.isArray(s.asks) ? s.asks : [],
    hintUsed: s.hint_used === true,
    savedAt: s.updated_at ? Date.parse(s.updated_at) : 0
  };
}

let draftStatusTimer = null;
function flashDraftSaved() {
  const el = $('draft-status');
  el.hidden = false;
  clearTimeout(draftStatusTimer);
  draftStatusTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

// ---------------------------------------------------------------------
// バナー（通知・エラー）
// ---------------------------------------------------------------------
function showError(message) {
  $('error-text').textContent = message;
  $('error-banner').hidden = false;
}
$('error-close').onclick = () => { $('error-banner').hidden = true; };

function showNotice(text) {
  if (!text) return;
  $('notice-text').textContent = text;
  $('notice-banner').hidden = false;
}
$('notice-ok').onclick = async () => {
  $('notice-banner').hidden = true;
  try { await api('clearNotice'); } catch (e) { /* 通知クリア失敗は次回再表示されるだけ */ }
};

function show(screen) {
  ['screen-home', 'screen-problem', 'screen-summary', 'screen-history', 'screen-tools'].forEach((id) => {
    $(id).hidden = (id !== screen);
  });
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// ホーム画面
// ---------------------------------------------------------------------
async function loadHome() {
  show('screen-home');
  $('home-loading').hidden = false;
  $('btn-generate').hidden = true;
  $('problem-list').innerHTML = '';
  try {
    const data = await api('getToday');
    state.problems = data.problems;
    state.serverDrafts = data.drafts || {}; // PC↔スマホ共有の下書き
    state.masteredConcepts = data.mastered_concepts || []; // 解放ツール判定用
    renderHome(data);
  } catch (e) {
    showError(e.message);
  } finally {
    $('home-loading').hidden = true;
  }
}

function renderHome(data) {
  const s = data.summary;
  $('streak').textContent = s.streak > 0 ? `🔥 ${s.streak}日連続` : '';
  $('progress').textContent = `習得 ${s.mastered}/${s.total} ・ 今日の復習対象 ${s.due_count}件`;
  if (s.bottleneck) {
    $('bottleneck').textContent = `今日はこれを潰すと効く：${s.bottleneck}`;
    $('bottleneck').hidden = false;
  } else {
    $('bottleneck').hidden = true;
  }
  showNotice(data.notice);
  renderProblemList();
}

function renderProblemList() {
  const list = $('problem-list');
  list.innerHTML = '';
  if (state.problems.length === 0) {
    $('btn-generate').hidden = false;
    $('btn-generate').textContent = '問題を作る';
    return;
  }
  $('btn-generate').hidden = true;
  state.problems.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'problem-card';
    btn.innerHTML = `<span>${p.payload.number}. ${escapeHtml(p.payload.title)}</span>` +
      `<span class="chip type-${p.type}">${p.type}・${escapeHtml(p.payload.theme || '')}</span>`;
    btn.onclick = () => openProblem(p);
    list.appendChild(btn);
  });
}

$('btn-generate').onclick = async () => {
  $('btn-generate').disabled = true;
  $('home-loading').textContent = '問題を生成中…（30秒ほどかかることがあります）';
  $('home-loading').hidden = false;
  try {
    const data = await api('generate', {});
    state.problems = data.problems;
    renderProblemList();
  } catch (e) {
    showError(e.message);
    $('btn-generate').textContent = 'もう一度';
  } finally {
    $('btn-generate').disabled = false;
    $('home-loading').hidden = true;
    $('home-loading').textContent = '読み込み中…';
  }
};

// ---------------------------------------------------------------------
// 履歴画面（過去問・自分の解答・した質問を見返す §5 getHistory）
// ---------------------------------------------------------------------
$('btn-history').onclick = loadHistory;
$('btn-history-back').onclick = loadHome;

async function loadHistory() {
  show('screen-history');
  $('history-loading').hidden = false;
  $('history-list').innerHTML = '';
  try {
    const data = await api('getHistory', { limit: 40 });
    renderHistory(data.items || []);
  } catch (e) {
    showError(e.message);
  } finally {
    $('history-loading').hidden = true;
  }
}

function renderHistory(items) {
  const list = $('history-list');
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<p class="progress">まだ解答の記録がありません。問題を解くとここに残ります。</p>';
    return;
  }
  items.forEach((it) => {
    // <details> でタップ開閉（JSなしで軽い）
    const det = document.createElement('details');
    det.className = 'history-item';
    const mark = it.verdict === '正解' ? '✅' : (it.verdict === '惜しい' ? '🟡' : '❌');
    const hint = it.hint_used ? ' 💡' : '';
    const practice = it.practice ? ' 🔁練習' : '';
    const date = String(it.timestamp || '').slice(5, 10).replace('-', '/');
    const num = it.number ? `問${it.number} ` : '';
    const asks = (it.asks || []).map((a) =>
      `<div class="hist-q">❓ ${escapeHtml(a.question)}</div>` +
      `<div class="hist-a">${escapeHtml(a.answer)}</div>`).join('');
    // この問題の通算成績（再挑戦も含む）。2回以上挑戦している時だけ「正解率」も添える
    const rate = it.tries ? Math.round((it.corrects / it.tries) * 100) : 0;
    const stat = it.tries
      ? `<div class="hist-stat">この問題の通算: ${it.corrects}/${it.tries} 正解` +
        (it.tries >= 2 ? `（正解率 ${rate}%）` : '') + `</div>`
      : '';
    const canRetry = it.problem_id && it.payload;
    det.innerHTML =
      `<summary>${mark} <b>${num}${escapeHtml(it.title)}</b>` +
      `<span class="hist-meta">${date} ・ ${escapeHtml(it.type)}${hint}${practice}</span></summary>` +
      `<div class="hist-body">` +
        stat +
        (canRetry ? `<button class="btn-small hist-retry">🔁 この問題にもう一度挑戦</button>` : '') +
        (it.statement ? `<p class="hist-statement">${escapeHtml(it.statement)}</p>` : '') +
        `<div class="expl-label">自分の解答</div><pre>${escapeHtml(it.code || '(なし)')}</pre>` +
        historyFeedbackHtml(it) +
        (it.self_note ? `<div class="expl-label">原因メモ</div><p>${escapeHtml(it.self_note)}</p>` : '') +
        (asks ? `<div class="expl-label">先生にした質問</div>${asks}` : '') +
      `</div>`;
    if (canRetry) {
      det.querySelector('.hist-retry').onclick = () => rechallenge(it);
    }
    list.appendChild(det);
  });
}

// 過去問の「再挑戦」: 履歴の1件から同じ問題をそのまま開き直す（練習モード）。
// 記録は履歴とストリークに残るが、FSRS・昇級・難易度には反映されない（grade.js 参照）
function rechallenge(it) {
  if (!it.problem_id || !it.payload) {
    showError('この問題は古い記録のため再挑戦できません');
    return;
  }
  openProblem({ problem_id: it.problem_id, type: it.type, payload: it.payload }, { practice: true });
}

// 履歴の1件にもらったヒント・Geminiの解説（間違えた時）を組み立てる。
// 古い記録（保存前）はどちらも空なので、その時は何も出ない
function historyFeedbackHtml(it) {
  let html = '';
  if (it.hints && it.hints.length) {
    html += `<div class="expl-label">💡 もらったヒント</div>` +
      it.hints.map((h) => `<div class="hint-block-body">${hintToHtml(h)}</div>`).join('');
  }
  const ex = it.explanation;
  if (ex) {
    if (ex.what_differs) html += `<div class="expl-label">どこが惜しい？</div><p>${escapeHtml(ex.what_differs)}</p>`;
    if (ex.correct_code) html += `<div class="expl-label">正解コード</div><pre>${escapeHtml(ex.correct_code)}</pre>`;
    if (Array.isArray(ex.line_by_line) && ex.line_by_line.length) {
      html += `<div class="expl-label">1行ずつ解説</div><ul>` +
        ex.line_by_line.map((l) => `<li>${escapeHtml(l)}</li>`).join('') + `</ul>`;
    }
    if (ex.why) html += `<div class="expl-label">なぜそう書くのか</div><p>${escapeHtml(ex.why)}</p>`;
    if (ex.one_point) html += `<div class="expl-label">次に活きる一言</div><p>💬 ${escapeHtml(ex.one_point)}</p>`;
  }
  return html;
}

// ---------------------------------------------------------------------
// 解放ツール画面（アイデンティティ報酬 §11）。
// 習得した概念に対応するツールを「解放済み（使える）」、未習得を「🔒（解放条件）」で出す。
// ---------------------------------------------------------------------
$('btn-tools').onclick = loadTools;
$('btn-tools-back').onclick = loadHome;

function loadTools() {
  show('screen-tools');
  const list = $('tools-list');
  list.innerHTML = '';
  const mastered = state.masteredConcepts || [];
  const unlocked = TOOLS.filter((t) => mastered.indexOf(t.concept) !== -1);
  const locked = TOOLS.filter((t) => mastered.indexOf(t.concept) === -1);

  if (unlocked.length === 0) {
    const p = document.createElement('p');
    p.className = 'progress';
    p.textContent = 'まだ解放ツールはありません。概念を「習得」すると、ここに使える道具が増えていきます。';
    list.appendChild(p);
  }
  unlocked.forEach((t) => list.appendChild(unlockedToolEl(t)));

  if (locked.length > 0) {
    const h = document.createElement('h3');
    h.textContent = '🔒 これから解放';
    list.appendChild(h);
    locked.forEach((t) => list.appendChild(lockedToolEl(t)));
  }
}

function unlockedToolEl(t) {
  const det = document.createElement('details');
  det.className = 'tool-item';
  det.innerHTML =
    `<summary><span class="tool-name">${t.icon} ${escapeHtml(t.name)}</span>` +
    `<span class="tool-cat">${t.category === 'music' ? '音楽' : 'セキュリティ'}</span></summary>` +
    `<div class="tool-body">` +
      `<p>${escapeHtml(t.desc)}</p>` +
      `<pre class="tool-code">${escapeHtml(t.script)}</pre>` +
      `<div class="btn-row">` +
        `<button class="btn-small tool-copy">📋 コピー</button>` +
        `<button class="btn-small tool-run">▶ 試す</button>` +
      `</div>` +
      `<pre class="tool-output" hidden></pre>` +
      `<div class="expl-label">仕組み・使い方</div><p class="tool-how">${escapeHtml(t.how)}</p>` +
    `</div>`;
  det.querySelector('.tool-copy').onclick = () => copyText(t.script, det.querySelector('.tool-copy'));
  det.querySelector('.tool-run').onclick = () => runTool(t.script, det.querySelector('.tool-output'), det.querySelector('.tool-run'));
  return det;
}

function lockedToolEl(t) {
  const div = document.createElement('div');
  div.className = 'tool-item locked';
  div.innerHTML =
    `<div class="tool-locked-name">🔒 ${t.icon} ${escapeHtml(t.name)}` +
    `<span class="tool-cat">${t.category === 'music' ? '音楽' : 'セキュリティ'}</span></div>` +
    `<div class="tool-unlock">「${escapeHtml(t.conceptName)}」を習得すると解放</div>`;
  return div;
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = '✓ コピーした';
    setTimeout(() => { btn.textContent = old; }, 1500);
  } catch (e) {
    showError('コピーできませんでした。コードを長押しで選択してください');
  }
}

async function runTool(script, outEl, btn) {
  btn.disabled = true;
  outEl.hidden = false;
  outEl.textContent = 'Python起動中…';
  const result = await Runner.run(script, (msg) => { outEl.textContent = msg; });
  btn.disabled = false;
  if (result.error && result.stdout === undefined) {
    outEl.textContent = result.error;
  } else {
    outEl.textContent = (result.stdout || '') + (result.stderr || '') || '(出力なし)';
  }
}

// ---------------------------------------------------------------------
// 問題画面
// ---------------------------------------------------------------------
function openProblem(p, opts) {
  state.current = p;
  state.practice = !!(opts && opts.practice); // 履歴からの「再挑戦」は練習モード
  state.ran = false;
  state.hintUsed = false;
  state.hints = [];
  state.hintLevel = 0;
  state.asks = [];
  state.attemptId = null;
  state.lastRun = { stdout: '', stderr: '' };

  const pl = p.payload;
  $('problem-title').textContent = `${pl.number}. ${pl.title}`;
  $('problem-type').textContent = p.type;
  $('problem-type').className = `chip type-${p.type}`;
  $('problem-statement').textContent = pl.statement;
  const ul = $('problem-conditions');
  ul.innerHTML = '';
  (pl.conditions || []).forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c;
    ul.appendChild(li);
  });
  $('problem-example').textContent = pl.example_call;
  $('problem-expected').textContent = pl.expected_output;
  $('revenge-note').hidden = !pl.is_revenge; // 🔁 前回間違いの類題なら案内を出す
  $('practice-note').hidden = !state.practice; // 🔁 履歴からの再挑戦なら練習の案内を出す

  // デバッグ問題は buggy_code を最初からエディタに入れて「修正する」体験にする
  $('editor').value = p.type === 'デバッグ' && pl.buggy_code ? pl.buggy_code : '';

  $('run-output').hidden = true;
  $('run-status').hidden = true;
  $('hint-area').hidden = true;
  $('result-area').hidden = true;
  $('easy-wrap').hidden = true;
  $('easy-check').checked = false;
  $('btn-grade').disabled = true;
  $('self-note-input').value = '';
  // 質問欄・ヒント表示をまっさらに戻す
  $('ask-input').value = '';
  $('ask-answers').innerHTML = '';
  $('ask-status').hidden = true;
  $('hint-badge').hidden = true;
  $('hint-blocks').innerHTML = '';
  $('draft-status').hidden = true;
  // 練習モードは下書きを使わない（毎回まっさら）ので、下書き保存UIは隠す
  $('draft-row').hidden = state.practice;
  updateHintButtonLabel();

  // 途中保存（下書き）があれば、コード・ヒント・質問を復元して続きから再開する。
  // サーバ（別端末で保存）とローカルの新しい方を採用する（PC↔スマホで継げる）。
  // ただし再挑戦（練習モード）は毎回まっさらにする＝自分の力を試し直すのが目的なので、
  // 前回の解答・もらったヒント・質問は一切復元しない（下書きも保存しない）
  const draft = state.practice ? null : pickNewerDraft(state.serverDrafts[p.problem_id], loadDraft(p.problem_id));
  if (draft) {
    if (typeof draft.code === 'string' && draft.code !== '') $('editor').value = draft.code;
    if (Array.isArray(draft.hints) && draft.hints.length) {
      state.hints = draft.hints.slice();
      state.hintLevel = typeof draft.hintLevel === 'number' ? draft.hintLevel : draft.hints.length;
      draft.hints.forEach((h, i) => renderHintBlock(h, '💡 ヒント ' + (i + 1)));
      updateHintButtonLabel();
    }
    if (Array.isArray(draft.asks)) {
      draft.asks.forEach((a) => { state.asks.push(a); renderAsk(a.question, a.answer, false); });
    }
    if (draft.hintUsed) markHintUsed();
  }
  show('screen-problem');
}

$('btn-back').onclick = () => loadHome();

// textarea のTabキーで2スペース字下げ（§8-2）
$('editor').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target;
    const pos = t.selectionStart;
    t.value = t.value.slice(0, pos) + '  ' + t.value.slice(t.selectionEnd);
    t.selectionStart = t.selectionEnd = pos + 2;
  }
});

// 入力するたびに下書きを自動保存（打鍵のたびに書かないよう少し待つ）
let draftSaveTimer = null;
$('editor').addEventListener('input', () => {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => saveDraft(true), 600);
});
// 明示的な「下書き保存」ボタン（押した手応えが欲しい人向け。中身は自動保存と同じ）
$('btn-save-draft').onclick = () => saveDraft(true);

// ---- 実行（Pyodide / オフライン可 §8-5） ----
$('btn-run').onclick = async () => {
  const code = $('editor').value;
  if (!code.trim()) { showError('コードが空です。まずはコードを書いてみよう'); return; }
  $('btn-run').disabled = true;
  $('run-status').hidden = false;
  $('run-status').textContent = '準備中…';
  const result = await Runner.run(code, (msg) => { $('run-status').textContent = msg; });
  $('btn-run').disabled = false;
  $('run-status').hidden = true;

  if (result.error && result.stdout === undefined) {
    // タイムアウト・input()検知・起動失敗
    $('run-output').textContent = result.error;
    $('run-output').className = 'has-error';
    $('run-output').hidden = false;
    if (!result.timeout) return; // 実行結果なし＝採点不可のまま
    state.lastRun = { stdout: '', stderr: 'TimeoutError: 5秒以内に終了しませんでした' };
  } else {
    const text = (result.stdout || '') + (result.stderr || '');
    $('run-output').textContent = text || '(出力なし)';
    $('run-output').className = result.stderr ? 'has-error' : '';
    $('run-output').hidden = false;
    state.lastRun = { stdout: result.stdout || '', stderr: result.stderr || '' };
  }
  state.ran = true; // 実行結果が出て初めて採点できる（§7の前提）
  $('btn-grade').disabled = false;
  $('easy-wrap').hidden = false;
};

// ---- 採点 ----
$('btn-grade').onclick = () => {
  // 新規＝最初からfull（worked example）。それ以外＝まずヒント段階（§7）
  const stage = state.current.type === '新規' ? 'full' : 'hint';
  grade(stage);
};
$('btn-reveal').onclick = () => grade('full');   // 答えを見る
$('btn-retry').onclick = () => {                 // 修正して再実行
  $('hint-area').hidden = true;
  state.ran = false;
  $('btn-grade').disabled = true;
  $('editor').focus();
};

async function grade(stage) {
  if (!state.ran) { showError('先に[▶ 実行]してから採点してください'); return; }
  state.gradedCode = $('editor').value; // 採点したコードを保持（結果で正解と見比べる）
  $('btn-grade').disabled = true;
  $('run-status').hidden = false;
  $('run-status').textContent = '採点中…';
  try {
    const res = await api('grade', {
      problem_id: state.current.problem_id,
      code: $('editor').value,
      stdout: state.lastRun.stdout,
      stderr: state.lastRun.stderr,
      stage: stage,
      hint_used: state.hintUsed,
      hints: state.hints,           // もらったヒントを履歴に残すため一緒に送る
      easy: $('easy-check').checked,
      mode: state.practice ? 'practice' : 'normal' // 再挑戦は練習として記録（学習計画に混ぜない）
    });
    if (res.stage === 'hint') {
      markHintUsed(); // 一度でもヒントを見たら最終 hint_used=true（§7）
      renderHints(res.hints);
    } else {
      renderFullResult(res);
    }
  } catch (e) {
    showError(e.message);
    $('btn-grade').disabled = false;
  } finally {
    $('run-status').hidden = true;
  }
}

// ---- 段階ヒント（押すほど詳しく 1→2→3。例はこの問題に即して出す §hint.js） ----
const HINT_LABELS = {
  0: '💡 ヒントをもらう',
  1: '💡 もう少し詳しいヒント',
  2: '💡 穴埋めヒントを見る',
  3: '💡 穴埋めヒントをもう一度'
};
const HINT_BLOCK_TITLES = { 1: '💡 ヒント（方針）', 2: '💡 ヒント（骨組み）', 3: '💡 ヒント（穴埋め）' };

function updateHintButtonLabel() {
  $('btn-hint').textContent = HINT_LABELS[Math.min(state.hintLevel, 3)];
}

$('btn-hint').onclick = requestHint;

async function requestHint() {
  const level = Math.min(state.hintLevel + 1, 3); // 押すほど深く。穴埋め(3)で頭打ち
  $('btn-hint').disabled = true;
  $('ask-status').hidden = false;
  $('ask-status').textContent = 'ヒントを考えています…';
  try {
    const res = await api('hint', {
      problem_id: state.current.problem_id,
      code: $('editor').value,
      level
    });
    state.hintLevel = level;
    const h = { hint: res.hint, code: res.code || null, steps: res.steps || null };
    state.hints.push(h);
    renderHintBlock(h, HINT_BLOCK_TITLES[level] || '💡 ヒント');
    markHintUsed();           // ヒントを見たらこの問題はヒントありで記録（§7）
    updateHintButtonLabel();
    saveDraft();              // もらったヒントも下書きに残す
  } catch (e) {
    showError(e.message);     // 予算超過などは日本語メッセージがそのまま出る
  } finally {
    $('btn-hint').disabled = false;
    $('ask-status').hidden = true;
  }
}

// ヒントを開閉できるブロック（<details>）として積む。増えても畳めるのでスクロールが楽
function renderHintBlock(h, title) {
  const det = document.createElement('details');
  det.className = 'hint-block';
  det.open = true;
  det.innerHTML = `<summary>${escapeHtml(title)}</summary><div class="hint-block-body">${hintToHtml(h)}</div>`;
  $('hint-blocks').appendChild(det);
  det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ヒント1件をHTML化（worked example形式）。
// 方針(散文) → コード(monospace・①②③付き) → 番号つき解説、の順で読みやすく分ける。
// 文字列（旧形式・grade段階のヒント）もそのまま表示できる
const HINT_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
function hintToHtml(h) {
  if (typeof h === 'string') return `<div class="hint-text">${escapeHtml(h)}</div>`;
  if (!h || typeof h !== 'object') return '';
  let html = '';
  if (h.hint) html += `<div class="hint-text">${escapeHtml(h.hint)}</div>`;
  if (h.code) html += `<pre class="hint-code">${escapeHtml(h.code)}</pre>`;
  if (Array.isArray(h.steps) && h.steps.length) {
    html += '<div class="hint-steps">' + h.steps.map((s, i) =>
      `<div class="hint-step"><span class="hint-mark">${HINT_MARKS[i] || (i + 1) + '.'}</span>` +
      `<span>${escapeHtml(s)}</span></div>`).join('') + '</div>';
  }
  return html;
}

// ---- 自由質問（先生に聞く） ----
$('btn-ask').onclick = () => askTutor($('ask-input').value.trim());

async function askTutor(question) {
  if (!question) { showError('質問を入力してから送ってください'); return; }
  $('btn-hint').disabled = true;
  $('btn-ask').disabled = true;
  $('ask-status').hidden = false;
  $('ask-status').textContent = '先生に聞いています…';
  try {
    const res = await api('ask', {
      problem_id: state.current.problem_id,
      code: $('editor').value,
      question
    });
    state.asks.push({ question, answer: res.answer });
    renderAsk(question, res.answer, true);
    markHintUsed();        // 質問したら、この問題はヒントありで記録される（§7）
    $('ask-input').value = '';
    saveDraft();           // 質問と回答も下書きに残す
  } catch (e) {
    showError(e.message);  // 予算超過などは日本語メッセージがそのまま出る
  } finally {
    $('btn-hint').disabled = false;
    $('btn-ask').disabled = false;
    $('ask-status').hidden = true;
  }
}

// 質問と回答を1件描画する（開閉できる。復元時は scroll=false で静かに並べ直す）
function renderAsk(question, answer, scroll) {
  const det = document.createElement('details');
  det.className = 'ask-answer';
  det.open = true;
  det.innerHTML = `<summary class="ask-q">❓ ${escapeHtml(question)}</summary>` +
    `<div class="ask-a">${escapeHtml(answer)}</div>`;
  $('ask-answers').appendChild(det);
  if (scroll) det.scrollIntoView({ behavior: 'smooth' });
}

// ヒント・質問・答えを見る のいずれかを使ったら印を付ける（記録と見た目を一致させる）
function markHintUsed() {
  state.hintUsed = true;
  $('hint-badge').hidden = false;
}

// 採点段階のヒント（誘導質問）も、段階ヒントと同じ開閉ブロックで積む＝保存もされる
function renderHints(hints) {
  (hints || []).forEach((h) => {
    state.hints.push(h);
    renderHintBlock(h, '💡 ヒント（採点）');
  });
  $('hint-area').hidden = false; // [修正して再実行][答えを見る] の操作ボタン
  $('hint-area').scrollIntoView({ behavior: 'smooth' });
  saveDraft();
}

function renderFullResult(res) {
  state.attemptId = res.attempt_id;
  $('hint-area').hidden = true;

  const v = $('verdict');
  if (res.verdict === '正解') { v.textContent = '✅ 正解！'; v.className = 'verdict ok'; }
  else if (res.verdict === '惜しい') { v.textContent = '🟡 惜しい！'; v.className = 'verdict close'; }
  else { v.textContent = '❌ 不正解'; v.className = 'verdict ng'; }

  if (res.state_change) {
    const sc = res.state_change;
    let msg = sc.to === '習得'
      ? `🎓 「${sc.concept}」を習得しました！`
      : `「${sc.concept}」: ${sc.from} → ${sc.to}`;
    // 習得した概念に対応するツールがあれば「解放」を祝う（アイデンティティ報酬 §11）
    if (sc.to === '習得') {
      const tool = (typeof TOOLS !== 'undefined') && TOOLS.find((t) => t.conceptName === sc.concept);
      if (tool) msg += `　🎁 新ツール解放：${tool.icon} ${tool.name}（ホームの「解放ツール」から使えます）`;
    }
    $('state-change').textContent = msg;
    $('state-change').hidden = false;
  } else {
    $('state-change').hidden = true;
  }

  // 正解コード・解説はトグルで開閉できるようにする（不正解時のみ畳む価値があるので details 化）
  if (res.verdict === '正解') {
    $('explanation').innerHTML = buildExplanationHtml(res);
  } else {
    $('explanation').innerHTML =
      `<details class="reveal" open><summary>📖 解説・正解コード（タップで開閉）</summary>` +
      `<div class="reveal-body">${buildExplanationHtml(res)}</div></details>`;
  }
  $('result-area').hidden = false;
  $('result-area').scrollIntoView({ behavior: 'smooth' });

  // 今日の進歩サマリ用に記録（練習＝再挑戦は今日の問題と無関係なので集計に入れない）
  if (!state.practice) {
    state.session.total++;
    if (res.verdict === '正解') {
      state.session.correct++;
      if (state.hintUsed) state.session.hintCorrect++; // ヒントありの正解を別カウント
    }
    if (res.verdict === '惜しい') state.session.close++;
    if (res.state_change) state.session.changes.push(res.state_change);
  }
}

function buildExplanationHtml(res) {
  if (res.verdict === '正解') {
    // 正解は「正解！」で十分。改善提案が来た時だけ一言添える
    if (res.suggestion) return `<div class="expl-label">💡 もっと良くするなら</div><p>${escapeHtml(res.suggestion)}</p>`;
    return '';
  }
  if (!res.explanation) {
    return `<p>判定は確定しています（出力の比較）。期待される出力と自分の出力を見比べてみてください。</p>` +
      `<div class="expl-label">期待される出力</div><pre>${escapeHtml(res.expected_output)}</pre>`;
  }
  const ex = res.explanation;
  // 自分のコードと正解コードを並べて見比べる（違う行をハイライト）
  let html = codeCompareHtml(state.gradedCode, ex.correct_code);
  if (ex.what_differs) html += `<div class="expl-label">どこが違う？</div><p>${escapeHtml(ex.what_differs)}</p>`;
  if (ex.one_point) html += `<p class="one-point">💬 ${escapeHtml(ex.one_point)}</p>`;
  // 長くなりがちな詳細は折りたたみ（必要な人だけ開く）
  const lines = (ex.line_by_line || []).filter(Boolean).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  if (lines || ex.why) {
    html += `<details class="more-expl"><summary>もっと詳しく</summary>`;
    if (lines) html += `<div class="expl-label">気をつける行</div><ul>${lines}</ul>`;
    if (ex.why) html += `<div class="expl-label">なぜそう書くのか</div><p>${escapeHtml(ex.why)}</p>`;
    html += `</details>`;
  }
  return html;
}

// 自分のコードと正解コードを縦に並べ、行ごとに違う所をハイライトする
function codeCompareHtml(userCode, correctCode) {
  const u = String(userCode || '').split('\n');
  const c = String(correctCode || '').split('\n');
  const n = Math.max(u.length, c.length);
  const line = (s, diff) => `<div class="${diff ? 'cmp-diff' : ''}">${escapeHtml(s) || '&nbsp;'}</div>`;
  let ul = '', cl = '';
  for (let i = 0; i < n; i++) {
    const a = i < u.length ? u[i] : '';
    const b = i < c.length ? c[i] : '';
    const diff = a !== b;
    ul += line(a, diff);
    cl += line(b, diff);
  }
  return `<div class="code-compare">` +
    `<div class="cmp-col"><div class="expl-label">あなたのコード</div><pre class="cmp cmp-you">${ul}</pre></div>` +
    `<div class="cmp-col"><div class="expl-label">正解コード</div><pre class="cmp cmp-ans">${cl}</pre></div>` +
    `</div>`;
}

// ---- 保存して次へ（原因1行メモ §7-5） ----
$('btn-next').onclick = async () => {
  const note = $('self-note-input').value.trim();
  if (note && state.attemptId) {
    try {
      await api('saveSelfNote', { attempt_id: state.attemptId, note });
    } catch (e) {
      showError(e.message); // メモ保存失敗でも先には進める
    }
  }
  // 解き終えたので下書きは破棄する（ローカル＋サーバ）
  clearDraft(state.current.problem_id);
  clearServerDraft(state.current.problem_id);
  // 再挑戦（練習）は今日のリストと無関係。履歴に戻って最新の挑戦記録を反映する
  if (state.practice) {
    loadHistory();
    return;
  }
  // 今日の問題はリストから外して次へ
  delete state.serverDrafts[state.current.problem_id];
  state.problems = state.problems.filter((p) => p.problem_id !== state.current.problem_id);
  if (state.problems.length > 0) {
    openProblem(state.problems[0]);
  } else {
    showSummary();
  }
};

// ---------------------------------------------------------------------
// 今日の進歩サマリ（小さな勝利の可視化 §11）
// ---------------------------------------------------------------------
function showSummary() {
  const s = state.session;
  const changes = s.changes.map((c) =>
    `<li>${escapeHtml(c.concept)}: ${c.from} → <b>${c.to}</b></li>`).join('');
  const nohint = s.correct - s.hintCorrect; // ヒントなしで解けた数（昇級の材料になる §7）
  $('summary-body').innerHTML = `
    <p>解いた問題: <b>${s.total}問</b></p>
    <p>正解 <b>${s.correct}</b> ・ 惜しい <b>${s.close}</b> ・ 不正解 <b>${s.total - s.correct - s.close}</b></p>
    <p class="summary-sub">うちノーヒント正解 <b>${nohint}</b> ・ ヒントあり正解 <b>${s.hintCorrect}</b></p>
    ${changes ? `<p>概念の変化:</p><ul>${changes}</ul>` : ''}
    <p>${s.correct === s.total ? '全問正解！この調子 💪' : '間違えた問題こそ伸びしろ。明日の出題に反映されます'}</p>`;
  show('screen-summary');
}

$('btn-summary-home').onclick = () => {
  state.session = { total: 0, correct: 0, close: 0, hintCorrect: 0, changes: [] };
  loadHome();
};

// ---------------------------------------------------------------------
// 勉強タイマー（スキマ時間用）。終了時刻を localStorage に持つので
// 画面遷移や再読み込みをまたいでも動き続ける。終了で音＋バイブ＋通知。
// ---------------------------------------------------------------------
const TIMER_KEY = 'dojo-timer-end';
let timerInterval = null;
let timerAudioCtx = null;

function timerEnd() { return Number(localStorage.getItem(TIMER_KEY) || 0); }
function timerRunning() { return timerEnd() > Date.now(); }

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function startTimer(minutes) {
  const min = Math.max(1, Math.min(180, Math.floor(minutes)));
  localStorage.setItem(TIMER_KEY, String(Date.now() + min * 60000));
  // 音を鳴らす許可をユーザー操作中に取得しておく（後の自動再生制限を回避）
  try { timerAudioCtx = timerAudioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 音なしでも可 */ }
  runTimerLoop();
}

function stopTimer() {
  localStorage.removeItem(TIMER_KEY);
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  renderTimer();
}

function runTimerLoop() {
  if (timerInterval) clearInterval(timerInterval);
  renderTimer();
  timerInterval = setInterval(() => {
    if (!timerEnd()) { stopTimer(); return; }
    if (Date.now() >= timerEnd()) { onTimerEnd(); return; }
    renderTimer();
  }, 1000);
}

function renderTimer() {
  const running = timerRunning();
  const remain = fmtTime(timerEnd() - Date.now());
  $('timer-display').hidden = !running;
  $('timer-presets').hidden = running;
  $('timer-stop').hidden = !running;
  if (running) $('timer-display').textContent = remain;
  $('timer-float').hidden = !running;
  if (running) $('timer-float-time').textContent = remain;
}

function onTimerEnd() {
  localStorage.removeItem(TIMER_KEY);
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  renderTimer();
  try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) { /* 非対応端末は無視 */ }
  beepTimer();
  $('timer-overlay').hidden = false; // 全画面で知らせる（どこを見ていても気づく）
}

// 気づきやすいよう短い音を3回鳴らす
function beepTimer() {
  try {
    const ctx = timerAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 350, 700].forEach((delay) => {
      setTimeout(() => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.09;
        o.start();
        setTimeout(() => o.stop(), 220);
      }, delay);
    });
  } catch (e) { /* 音が出せない環境でもバイブ/全画面通知で気づける */ }
}

document.querySelectorAll('.timer-preset').forEach((b) => {
  b.onclick = () => startTimer(Number(b.dataset.min));
});
$('timer-start').onclick = () => {
  const v = Number($('timer-custom').value);
  if (v > 0) { startTimer(v); $('timer-custom').value = ''; }
  else showError('タイマーの分数を入力してください（例: 5）');
};
$('timer-stop').onclick = stopTimer;
$('timer-overlay-ok').onclick = () => { $('timer-overlay').hidden = true; };

// ---------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* SWなしでも動作はする */ });
}
if (timerRunning()) runTimerLoop(); // 再読み込み前のタイマーを引き継ぐ
loadHome();
