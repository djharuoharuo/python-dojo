// =====================================================================
// zt.js — 🛡 ゼロトラスト道場（NIST SP 800-207 への道）。
// 人生目標「800-207を完全理解 → 就職 → 年収を上げる」をアプリの北極星として常設する。
//
// 設計原則（§2の精神を概念にも適用）:
//   標準の事実（7原則・PE/PA/PEP 等）は【手書きで固定した権威コンテンツ】にする。
//   LLMに事実を作らせない＝間違いを正しいものとして覚える事故を防ぐ。出典は NIST SP 800-207 ほか。
//
// 構成（自己完結・バックエンド不要・localStorageのみ）:
//   📖 学ぶ   … 800-207を分解した地図＋各項目を「Pythonの卒業制作でどう実装するか」に接続
//   🎯 思い出す … 上の知識を間隔反復で想起するリコール・クイズ（Leitner方式・localStorage）
//   💼 進路   … 資格と職種のはしご・年収レンジ（動機の可視化）
// =====================================================================

const ZT = {
  // 出典・前提（決して信頼せず、常に検証する / John Kindervag 2010 / Forrester）
  intro: {
    title: 'ゼロトラスト（Zero Trust）とは',
    body: '「決して信頼せず、常に検証する（never trust, always verify）」。' +
      'ネットワークの内側だからといって信頼しない。すべてのアクセスを毎回・最小権限で検証し、' +
      '前提として侵害されているものとして設計する。提唱者は John Kindervag（2010年・Forrester）。' +
      'NIST SP 800-207（2020年8月）はこれを米国政府標準として体系化した文書。あなたの卒業制作' +
      '「ミニ・ゼロトラストゲート」はこの考えをPythonで自作する到達点（CLAUDE.md §11）。',
    src: 'NIST SP 800-207'
  },

  // === 800-207 セクション2.1：ゼロトラストの7原則（覚える核） ===
  tenets: {
    title: 'NIST SP 800-207 ― ゼロトラストの7原則',
    src: 'NIST SP 800-207 §2.1',
    cards: [
      { q: '原則1', a: 'すべてのデータソースとコンピューティングサービスを「リソース」とみなす。',
        py: 'gate()が守る対象を「ファイル・API・関数」など何でもリソースとして一般化して扱う。' },
      { q: '原則2', a: 'ネットワークの場所に関わらず、すべての通信を保護する（内側ネットワークを信頼しない）。',
        py: 'LAN内からの呼び出しでも検証を省かない＝「社内だから素通し」を作らない。' },
      { q: '原則3', a: 'リソースへのアクセスは【セッション単位】で許可する。',
        py: '1リクエスト＝1判定。トークンを毎回検証し、セッションをまたいで暗黙に信頼しない。' },
      { q: '原則4', a: 'アクセスは【動的ポリシー】で決める（クライアントID・アプリ/サービス・要求資産の観測状態＋行動・環境属性）。',
        py: 'policy辞書＋状態（時刻・失敗回数など）で許可/拒否を動的に決める。' },
      { q: '原則5', a: '保有・関連するすべての資産の【完全性とセキュリティ態勢】を監視・測定する。',
        py: '資産の状態（更新済みか・改ざんされていないか）を採点に入れる。hashlibで改ざん検知。' },
      { q: '原則6', a: 'リソースの認証・認可は【動的かつ厳格】に、アクセスを許す前に必ず実施する。',
        py: 'gate()は「許可を出す前」に検証する。fail closed＝迷ったら拒否。' },
      { q: '原則7', a: '資産・ネットワーク・通信の現在状態を【できる限り収集】し、セキュリティ態勢の改善に使う。',
        py: 'アクセスログを残し（§11 ログ異常検知ツール）、次の判定・改善の材料にする。' }
    ]
  },

  // === 800-207 セクション3.1：論理コンポーネント（PE/PA/PEP）＝卒業制作の設計図 ===
  components: {
    title: '中核コンポーネント（PE / PA / PEP）',
    src: 'NIST SP 800-207 §3.1',
    note: 'PE＋PA＝制御プレーン（Policy Decision Point, PDP）。PEP＝データプレーン。' +
      'あなたのゲートはこの3つを小さく自作することがゴール。',
    cards: [
      { q: 'Policy Engine（PE）とは', a: 'アクセスを許可/拒否する【決定】を下す頭脳。企業ポリシー＋トラストアルゴリズム＋外部入力（脅威情報・CDM等）で判断する。',
        py: 'def decide(request) -> bool: …  許可/拒否を返す純粋な判断関数。' },
      { q: 'Policy Administrator（PA）とは', a: 'PEの決定を【実行】する。通信経路を確立/遮断し、セッション専用の資格情報/トークンを発行し、PEPに「通せ/拒否しろ」と指示する。',
        py: 'トークンを発行し、PEPに渡す。decideがTrueなら通行証を作る役。' },
      { q: 'Policy Enforcement Point（PEP）とは', a: 'サブジェクトとリソースの間の接続を【有効化・監視・終了】する関所。データプレーンに位置する。',
        py: '実際の門番gate()。リクエストを受け、PA発行の通行証を確認して通す/閉じる。' }
    ]
  },

  // === 800-207 セクション3.3：トラストアルゴリズム ===
  trustAlgo: {
    title: 'トラストアルゴリズム（信頼の計算）',
    src: 'NIST SP 800-207 §3.3',
    cards: [
      { q: 'トラストアルゴリズムの入力（5つ）', a: '①アクセス要求 ②サブジェクトDB（ID・属性・権限）③資産DB（資産の観測状態）④リソースポリシー要件 ⑤脅威インテリジェンス。',
        py: 'decide()に渡す材料＝user, action, 資産状態, policy, 脅威フラグ。' },
      { q: '基準ベース vs スコアベース', a: '基準ベース＝満たすべき条件の集合をすべて満たせば許可。スコアベース＝重み付き信頼スコアが閾値を超えれば許可。',
        py: 'まずは基準ベース（if 全条件: 許可）。慣れたらスコア（合計 >= 閾値）。' },
      { q: '単発 vs 文脈的（contextual）', a: '単発＝1リクエストを独立評価。文脈的＝過去の振る舞い履歴も加味して評価する。',
        py: '失敗回数fails[user]など履歴を見て判定＝文脈的。' }
    ]
  },

  // === 800-207 セクション3.2：配備モデル ===
  deployments: {
    title: '配備モデル（どう置くか）',
    src: 'NIST SP 800-207 §3.2',
    cards: [
      { q: 'デバイスエージェント/ゲートウェイ型', a: '端末のエージェントとリソース前のゲートウェイが連携してアクセスを仲介する。' },
      { q: 'エンクレーブ型', a: 'リソース群（エンクレーブ）の前に1つのゲートウェイを置いて守る。個々の資産にエージェントを置けない時に有効。' },
      { q: 'リソースポータル型', a: 'ポータル（入口）経由でのみアクセスさせる。端末にエージェント不要だが可視性は下がる。' },
      { q: 'デバイスアプリのサンドボックス型', a: '承認済みアプリを隔離環境で動かし、侵害された他アプリから資産を守る。' }
    ]
  },

  // === 800-207 セクション5：ZTAに関連する脅威 ===
  threats: {
    title: 'ZTAに関連する脅威（守る側が知るべき弱点）',
    src: 'NIST SP 800-207 §5',
    cards: [
      { q: 'PE/PAの決定プロセスの破壊', a: 'PE/PAが乗っ取られると全ての判定が汚染される＝最重要防御対象。設定変更は厳格に。' },
      { q: 'PA/PEPへのDoS・経路妨害', a: 'PAやPEPを停止/輻輳させるとアクセス不能に。冗長化と監視が要る。' },
      { q: '資格情報の窃取・内部不正', a: '盗まれた認証情報・内部者。だから動的ポリシー（行動・環境）で異常を捉える。' },
      { q: 'ネットワークの可視性', a: '暗号化で中身が見えず検査しづらい。メタデータ・ログで補う。' },
      { q: 'システム/ネットワーク情報の保存', a: 'ポリシーや資産情報の保管先が漏れると攻撃の地図になる。最小化と保護。' },
      { q: '独自データ形式への依存', a: 'ベンダー固有形式に縛られると相互運用・移行が困難に。標準形式を志向。' },
      { q: '管理に非人間エンティティ(NPE/AI)を使う', a: '自動化・AIが管理に関わると、その乗っ取り・誤作動が新たな攻撃面になる。' }
    ]
  },

  // === 2026年の全体像：CISA ZTMM と DoD（リサーチで確認） ===
  landscape: {
    title: '2026年の全体像（800-207の周辺）',
    cards: [
      { q: 'CISA ゼロトラスト成熟度モデル(ZTMM v2.0) 5本柱', a: '①Identity ②Devices ③Networks ④Applications & Workloads ⑤Data。横断3能力＝Visibility & Analytics / Automation & Orchestration / Governance。成熟段階＝Traditional→Initial→Advanced→Optimal。',
        py: 'まず Identity（誰か）と Data（何を守るか）を固めるのが王道。' },
      { q: 'DoD ゼロトラスト 7本柱', a: 'User / Device / Applications & Workloads / Data / Network & Environment / Automation & Orchestration / Visibility & Analytics。Target Levelは FY2027、Advancedは FY2032 が目標。' },
      { q: 'SDP（Software Defined Perimeter）', a: 'CSA発（2013）。「接続前に認証（authenticate-before-connect）」「deny-by-default」。ゼロトラストの源流の一つで、CCZT資格の中核モジュール。',
        py: 'gate()の既定を「拒否」にする＝deny-by-default の実装。' }
    ]
  }
};

// 進路（資格・職種・年収）。リサーチ結果（2026・主に米国）。動機づけの情報的フィードバック（§11）。
const ZT_CAREER = {
  certs: [
    { name: 'ISC2 CC / CompTIA Security+', note: '入口の基礎。CCは約$199（無料枠は2026/5終了）、Security+は約$425。まず用語の土台。' },
    { name: '★ CSA CCZT', note: 'ゼロトラスト専用・ベンダー中立の本命資格。$175・オープンブック・初心者可。中身は NIST 800-207＋CISA ZTMM＋SDP＋Kindervag＝この道場とそのまま重なる。' },
    { name: 'Microsoft SC-300（Identity）', note: 'ゼロトラストの心臓＝アイデンティティ。次の一歩。' },
    { name: 'SC-100 / CISSP（数年先）', note: 'アーキテクト級。CISSPは実務5年。ZTAも出題範囲に入っている。' }
  ],
  jobs: [
    { name: 'SOC アナリスト / GRC アナリスト（入口）', pay: '$50k–$80k〜', note: '初心者の現実的な入口。GRCは800-207/RMFへの統制マッピング。' },
    { name: 'セキュリティ/クラウドセキュリティエンジニア', pay: '$120k–$190k', note: '中堅の中核。ZT統制を実装する。' },
    { name: 'IAM エンジニア', pay: '$110k–$170k', note: 'アイデンティティ＝ZTの制御プレーン。' },
    { name: 'セキュリティ/ゼロトラスト アーキテクト', pay: '$140k–$240k+（クリアランス有で$200k+）', note: '到達点。800-207を設計に落とす。' }
  ],
  note: '出典: Robert Half / Glassdoor / ZipRecruiter / BLS / ISC2 ほか 2026。米国・幅あり。' +
    '世界のサイバー人材不足は約480万人（ISC2 2025）＝追い風。'
};

// ---------------------------------------------------------------------
// ZTDojo — 画面コントローラ（自己完結）。app.js からは ZTDojo.open() だけ呼ぶ。
// ---------------------------------------------------------------------
const ZTDojo = (function () {
  const SECTIONS = ['tenets', 'components', 'trustAlgo', 'deployments', 'threats', 'landscape'];
  const INTERVALS = [0, 1, 3, 7, 16, 40]; // Leitner: box→次回までの日数
  const SRS_KEY = 'zt-srs';

  function zEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const el = (id) => document.getElementById(id);
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  // 全セクションの暗記カードを一列に（思い出すクイズの母集合）
  function allCards() {
    const out = [];
    SECTIONS.forEach((key) => {
      const sec = ZT[key];
      (sec.cards || []).forEach((c, i) => out.push({ id: key + ':' + i, section: sec.title, src: sec.src || '', q: c.q, a: c.a, py: c.py || '' }));
    });
    return out;
  }
  function loadSrs() { try { return JSON.parse(localStorage.getItem(SRS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveSrs(s) { try { localStorage.setItem(SRS_KEY, JSON.stringify(s)); } catch (e) { /* 容量超過でも学習は止めない */ } }

  let tab = 'learn';

  function open() {
    if (typeof show === 'function') show('screen-zt'); else { el('screen-zt').hidden = false; window.scrollTo(0, 0); }
    render();
  }

  function render() {
    const tabs = [['learn', '📖 学ぶ'], ['recall', '🎯 思い出す'], ['career', '💼 進路']];
    el('zt-tabs').innerHTML = tabs.map(([k, label]) =>
      `<button class="zt-tab${k === tab ? ' active' : ''}" data-tab="${k}">${label}</button>`).join('');
    el('zt-tabs').querySelectorAll('.zt-tab').forEach((b) => {
      b.onclick = () => { tab = b.dataset.tab; render(); };
    });
    if (tab === 'learn') renderLearn();
    else if (tab === 'recall') renderRecall();
    else renderCareer();
  }

  // 📖 学ぶ：800-207を分解した地図＋Python実装への接続
  function renderLearn() {
    let h = `<div class="zt-intro"><h3>${zEsc(ZT.intro.title)}</h3><p>${zEsc(ZT.intro.body)}</p>` +
      `<div class="zt-src">出典: ${zEsc(ZT.intro.src)}</div></div>`;
    SECTIONS.forEach((key) => {
      const sec = ZT[key];
      h += `<details class="zt-sec" open><summary>${zEsc(sec.title)}${sec.src ? ` <span class="zt-src">${zEsc(sec.src)}</span>` : ''}</summary>`;
      if (sec.note) h += `<p class="zt-note">${zEsc(sec.note)}</p>`;
      (sec.cards || []).forEach((c) => {
        h += `<div class="zt-card"><div class="zt-q">${zEsc(c.q)}</div>` +
          `<div class="zt-a">${zEsc(c.a)}</div>` +
          (c.py ? `<div class="zt-py">🐍 Pythonでは: ${zEsc(c.py)}</div>` : '') + `</div>`;
      });
      h += `</details>`;
    });
    el('zt-body').innerHTML = h;
  }

  // 🎯 思い出す：間隔反復リコール（期限が来たカードを優先。覚えてた/あやふや/忘れた で再スケジュール）
  let quizQueue = [];
  let quizCard = null;
  function renderRecall() {
    const srs = loadSrs();
    const today = todayStr();
    const cards = allCards();
    // 期限到来（未学習含む）を優先、無ければ全部から
    const due = cards.filter((c) => !srs[c.id] || !srs[c.id].due || srs[c.id].due <= today);
    quizQueue = (due.length ? due : cards).slice();
    // 軽くシャッフル（出題順を固定化しない）
    for (let i = quizQueue.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); const t = quizQueue[i]; quizQueue[i] = quizQueue[j]; quizQueue[j] = t; }
    const learned = cards.filter((c) => srs[c.id] && srs[c.id].box >= 1).length;
    el('zt-body').innerHTML =
      `<div class="zt-quiz-head">覚えた: ${learned}/${cards.length} ・ 今日の復習: ${due.length}件</div>` +
      `<div id="zt-quiz"></div>`;
    nextCard();
  }
  function nextCard() {
    if (!quizQueue.length) {
      el('zt-quiz').innerHTML = `<div class="zt-done">✅ 今日のリコールは完了！ よく思い出せた。<br>また間隔をあけて出します（長期記憶へ）。</div>`;
      return;
    }
    quizCard = quizQueue.shift();
    el('zt-quiz').innerHTML =
      `<div class="zt-card zt-quiz-card"><div class="zt-q-sec">${zEsc(quizCard.section)}</div>` +
      `<div class="zt-q-big">${zEsc(quizCard.q)}</div>` +
      `<button id="zt-reveal" class="btn-primary">答えを見る</button>` +
      `<div id="zt-ans" hidden></div></div>`;
    el('zt-reveal').onclick = reveal;
  }
  function reveal() {
    const ans = el('zt-ans');
    ans.innerHTML =
      `<div class="zt-a">${zEsc(quizCard.a)}</div>` +
      (quizCard.py ? `<div class="zt-py">🐍 ${zEsc(quizCard.py)}</div>` : '') +
      `<div class="zt-grade-q">思い出せた？</div>` +
      `<div class="zt-grade"><button class="btn-small" data-g="2">✅ 覚えてた</button>` +
      `<button class="btn-small" data-g="1">🤔 あやふや</button>` +
      `<button class="btn-small" data-g="0">❌ 忘れた</button></div>`;
    ans.hidden = false;
    el('zt-reveal').hidden = true;
    ans.querySelectorAll('.zt-grade button').forEach((b) => {
      b.onclick = () => gradeCard(Number(b.dataset.g));
    });
  }
  function gradeCard(g) {
    const srs = loadSrs();
    const cur = srs[quizCard.id] || { box: 0, due: '' };
    let box = cur.box || 0;
    if (g === 2) box = Math.min(box + 1, INTERVALS.length - 1); // 覚えてた→次の箱
    else if (g === 0) box = 0;                                  // 忘れた→最初に戻す
    // あやふや(1)は箱据え置き
    srs[quizCard.id] = { box: box, due: addDays(INTERVALS[box]) };
    saveSrs(srs);
    nextCard();
  }

  // 💼 進路：資格・職種・年収（動機の可視化）
  function renderCareer() {
    let h = `<p class="zt-note">「800-207を完全理解 → 就職 → 年収を上げる」への現実的な道。情報は2026年・主に米国。</p>`;
    h += `<h3>🎓 資格のはしご</h3>`;
    ZT_CAREER.certs.forEach((c) => {
      h += `<div class="zt-card"><div class="zt-q">${zEsc(c.name)}</div><div class="zt-a">${zEsc(c.note)}</div></div>`;
    });
    h += `<h3>💼 職種と年収の目安</h3>`;
    ZT_CAREER.jobs.forEach((j) => {
      h += `<div class="zt-card"><div class="zt-q">${zEsc(j.name)} <span class="zt-pay">${zEsc(j.pay)}</span></div><div class="zt-a">${zEsc(j.note)}</div></div>`;
    });
    h += `<div class="zt-src">${zEsc(ZT_CAREER.note)}</div>`;
    el('zt-body').innerHTML = h;
  }

  return { open: open };
})();
