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

// =====================================================================
// 🛠 ゼロトラスト・コード演習（本命）。「ゼロトラストを取り入れたコードを書ける」になるための階段。
// 一段ずつ自分でPythonを書き、ブラウザのPyodideでテスト判定する（答えは見せない＝§11）。
// 全課題は python3 で実行検証済み（間違った課題を出さないため）。最後はミニ・ゼロトラストゲート。
// 各 tests の expected は判定用（UIには表示しない）。reference solution は同梱しない。
// =====================================================================
const ZT_CODING = [
  {
    id: 'gate', title: '① deny-by-default ゲート', tenet: '原則6・fail closed',
    spec: '正しいトークンの時だけ「許可」、それ以外は全部「拒否」を返す関数 gate(token) を書こう。' +
      '「既定は拒否（deny-by-default）」がゼロトラストの基本。正しいトークンは "secret123"。',
    function_name: 'gate',
    conditions: ['関数名は gate', '正しいトークン "secret123" のとき "許可" を返す', 'それ以外（空文字・誤り）は全部 "拒否"'],
    starter: 'def gate(token):\n    ',
    tests: [{ call: 'gate("secret123")', expected: '許可' }, { call: 'gate("wrong")', expected: '拒否' }, { call: 'gate("")', expected: '拒否' }],
    hint: 'if で正しいトークンの時だけ "許可" を return。関数の最後に return "拒否" を置くと、それ以外は全部拒否になる（deny-by-default）。'
  },
  {
    id: 'safe_gate', title: '② fail-closed（エラーでも拒否）', tenet: '原則6・fail closed',
    spec: '処理中にエラーが起きても【必ず "拒否"】を返す安全な門番 safe_gate(token) を書こう。' +
      'token を小文字にして "open" なら "許可"、それ以外は "拒否"。ただし token が文字列でない等で例外が出ても "拒否" にする（迷ったら閉じる）。',
    function_name: 'safe_gate',
    conditions: ['関数名は safe_gate', 'token.lower() が "open" なら "許可"', '例外が起きたら "拒否"（try/except）'],
    starter: 'def safe_gate(token):\n    ',
    tests: [{ call: 'safe_gate("OPEN")', expected: '許可' }, { call: 'safe_gate("nope")', expected: '拒否' }, { call: 'safe_gate(None)', expected: '拒否' }],
    hint: 'try: の中で token.lower() を使う。None だと .lower() で例外＝except Exception: で "拒否" を返す。'
  },
  {
    id: 'can', title: '③ ポリシーエンジン(PE)・最小権限', tenet: '原則4・最小権限',
    spec: '許可リスト（辞書）に基づき、user が action をしてよいか True/False を返す can(user, action, policy) を書こう。' +
      'policy は {"haruki": ["read","write"]} のような辞書。リストに無い／ユーザーが居なければ False（最小権限）。',
    function_name: 'can',
    conditions: ['関数名は can', 'policy[user] のリストに action があれば True', 'ユーザーが居ない時も False（落ちない）'],
    starter: 'def can(user, action, policy):\n    ',
    tests: [
      { call: 'can("haruki","read",{"haruki":["read","write"]})', expected: 'True' },
      { call: 'can("haruki","delete",{"haruki":["read","write"]})', expected: 'False' },
      { call: 'can("guest","read",{"haruki":["read"]})', expected: 'False' }
    ],
    hint: 'policy.get(user, []) で「居なければ空リスト」を取り出し、action in … を返すと1行で書ける。'
  },
  {
    id: 'verify', title: '④ 毎リクエスト検証', tenet: '原則3・6',
    spec: 'リクエスト辞書 req = {"token","user","action"} を1件検証する verify(req, policy) を書こう。' +
      'トークンが "t-"＋user と一致し、かつ policy で user が action 可能なら "許可"、どちらか欠ければ "拒否"。',
    function_name: 'verify',
    conditions: ['関数名は verify', 'req["token"] が "t-"+user なら本人とみなす', 'トークンOK かつ action 許可なら "許可"、でなければ "拒否"'],
    starter: 'def verify(req, policy):\n    user = req.get("user")\n    ',
    tests: [
      { call: 'verify({"token":"t-haruki","user":"haruki","action":"read"}, {"haruki":["read"]})', expected: '許可' },
      { call: 'verify({"token":"bad","user":"haruki","action":"read"}, {"haruki":["read"]})', expected: '拒否' },
      { call: 'verify({"token":"t-haruki","user":"haruki","action":"delete"}, {"haruki":["read"]})', expected: '拒否' }
    ],
    hint: 'まず req.get("token") != "t-" + str(user) なら "拒否"。次に action in policy.get(user, []) なら "許可"、最後に "拒否"。'
  },
  {
    id: 'issue', title: '⑤ トークン発行(PA)', tenet: 'PA・deny by default',
    spec: '既知のユーザーにだけセッショントークンを発行する issue(user, known) を書こう。' +
      'known（リスト）に居れば "t-"＋user を返し、居なければ "" を返す（発行しない＝拒否）。',
    function_name: 'issue',
    conditions: ['関数名は issue', 'user が known にあれば "t-"+user', '無ければ "" を返す（発行しない）'],
    starter: 'def issue(user, known):\n    ',
    tests: [{ call: 'issue("haruki", ["haruki","aoi"])', expected: 't-haruki' }, { call: 'issue("mallory", ["haruki"])', expected: '' }],
    hint: 'if user in known: return "t-" + user。最後に return "" で「知らない人には出さない」。'
  },
  {
    id: 'gate2', title: '⑥ 動的ロック（文脈を見る）', tenet: '原則4・動的ポリシー',
    spec: '失敗回数を見て判断する gate2(user, token, fails) を書こう。fails は {user: 失敗回数} の辞書。' +
      '失敗が3回以上のユーザーは正しいトークンでも "拒否（ロック）"。それ以外は正しいトークン "ok" なら "許可"、違えば "拒否"。',
    function_name: 'gate2',
    conditions: ['関数名は gate2', 'fails[user] が 3以上なら "拒否（ロック）"', 'token == "ok" なら "許可"、でなければ "拒否"'],
    starter: 'def gate2(user, token, fails):\n    ',
    tests: [
      { call: 'gate2("haruki","ok",{"haruki":0})', expected: '許可' },
      { call: 'gate2("haruki","ok",{"haruki":3})', expected: '拒否（ロック）' },
      { call: 'gate2("haruki","bad",{"haruki":0})', expected: '拒否' }
    ],
    hint: '最初に fails.get(user, 0) >= 3 を判定して "拒否（ロック）"。その後でトークンを見る＝順番が大事。'
  },
  {
    id: 'check_integrity', title: '⑦ 改ざん検知（hashlib）', tenet: '原則5・完全性',
    spec: 'データが改ざんされていないか確認する check_integrity(data, expected) を書こう。' +
      'data の SHA-256（16進文字列）が expected と一致すれば "OK"、違えば "改ざん検知" を返す。hashlib を使う。',
    function_name: 'check_integrity',
    conditions: ['関数名は check_integrity', 'hashlib.sha256(data.encode()).hexdigest() を使う', '一致で "OK"、不一致で "改ざん検知"'],
    starter: 'import hashlib\n\ndef check_integrity(data, expected):\n    ',
    tests: [
      { call: 'check_integrity("hello", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")', expected: 'OK' },
      { call: 'check_integrity("hello!", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")', expected: '改ざん検知' }
    ],
    hint: 'h = hashlib.sha256(data.encode()).hexdigest() を作り、h == expected を if で見て "OK"/"改ざん検知" を返す。'
  },
  {
    id: 'zt_gate', title: '⑧ 卒業：ミニ・ゼロトラストゲート', tenet: '原則3・4・6 全部入り',
    spec: '集大成。zt_gate(req, policy, known) を書こう。req = {"token","user","action"}。' +
      '①user が known に居る ②token が "t-"+user ③policy で action 可能、の【全部】を満たした時だけ "許可"。1つでも欠けたら "拒否"（deny-by-default）。これが NIST SP 800-207 の PEP の最小実装。',
    function_name: 'zt_gate',
    conditions: ['関数名は zt_gate', '未知のユーザー／トークン不一致／権限なし は "拒否"', '3つ全部OKの時だけ "許可"'],
    starter: 'def zt_gate(req, policy, known):\n    user = req.get("user")\n    ',
    tests: [
      { call: 'zt_gate({"token":"t-haruki","user":"haruki","action":"read"}, {"haruki":["read"]}, ["haruki"])', expected: '許可' },
      { call: 'zt_gate({"token":"t-haruki","user":"haruki","action":"read"}, {"haruki":["read"]}, [])', expected: '拒否' },
      { call: 'zt_gate({"token":"bad","user":"haruki","action":"read"}, {"haruki":["read"]}, ["haruki"])', expected: '拒否' },
      { call: 'zt_gate({"token":"t-haruki","user":"haruki","action":"delete"}, {"haruki":["read"]}, ["haruki"])', expected: '拒否' }
    ],
    hint: '前の④⑤⑥で書いた判定を順に重ねるだけ。user not in known → 拒否、token 不一致 → 拒否、action 許可 → "許可"、最後に "拒否"。'
  }
];

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

  let tab = 'code'; // 本命＝書く演習を最初に出す

  function open() {
    if (typeof show === 'function') show('screen-zt'); else { el('screen-zt').hidden = false; window.scrollTo(0, 0); }
    render();
  }

  function render() {
    const tabs = [['code', '🛠 書く'], ['learn', '📖 学ぶ'], ['recall', '🎯 思い出す'], ['career', '💼 進路']];
    el('zt-tabs').innerHTML = tabs.map(([k, label]) =>
      `<button class="zt-tab${k === tab ? ' active' : ''}" data-tab="${k}">${label}</button>`).join('');
    el('zt-tabs').querySelectorAll('.zt-tab').forEach((b) => {
      b.onclick = () => { tab = b.dataset.tab; render(); };
    });
    if (tab === 'code') renderCoding();
    else if (tab === 'learn') renderLearn();
    else if (tab === 'recall') renderRecall();
    else renderCareer();
  }

  // 出力の正規化（サーバ grade.js の normalizedEquals_ と同じ）
  function norm(s) {
    return String(s == null ? '' : s).replace(/\r\n/g, '\n').split('\n')
      .map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
  }
  const CODE_DONE_KEY = 'zt-coding-done';
  const codeKey = (id) => 'zt-code-' + id;
  function loadDone() { try { return JSON.parse(localStorage.getItem(CODE_DONE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function isDone(id) { return !!loadDone()[id]; }
  function markDone(id) { const d = loadDone(); d[id] = true; try { localStorage.setItem(CODE_DONE_KEY, JSON.stringify(d)); } catch (e) {} }

  // 🛠 書く：演習一覧。前を解くと次が開く（順番に積み上げる）
  function renderCoding() {
    const done = loadDone();
    let unlocked = true; // 先頭は常に開いている
    let h = '<p class="zt-note">ゼロトラストを取り入れたPythonを<strong>自分で書く</strong>階段。' +
      '一段ずつ書いてテストで判定（答えは出ません）。最後は NIST SP 800-207 の門番(PEP)の最小実装＝卒業制作。</p>';
    const total = ZT_CODING.length;
    const cleared = ZT_CODING.filter((e) => done[e.id]).length;
    h += `<div class="zt-quiz-head">クリア: ${cleared}/${total}</div>`;
    ZT_CODING.forEach((ex) => {
      const d = !!done[ex.id];
      const open = unlocked || d;
      const mark = d ? '✅' : (open ? '▶' : '🔒');
      h += `<button class="zt-ex-row${open ? '' : ' locked'}" data-id="${ex.id}"${open ? '' : ' disabled'}>` +
        `<span>${mark} ${zEsc(ex.title)}</span><span class="zt-ex-tenet">${zEsc(ex.tenet)}</span></button>`;
      if (!d) unlocked = false; // 未クリアならその先はロック
    });
    el('zt-body').innerHTML = h;
    el('zt-body').querySelectorAll('.zt-ex-row:not(.locked)').forEach((b) => {
      b.onclick = () => openExercise(ZT_CODING.filter((e) => e.id === b.dataset.id)[0]);
    });
  }

  let curEx = null;
  function openExercise(ex) {
    curEx = ex;
    const saved = (() => { try { return localStorage.getItem(codeKey(ex.id)); } catch (e) { return null; } })();
    const code = (saved != null && saved !== '') ? saved : ex.starter;
    el('zt-body').innerHTML =
      `<button id="zt-ex-back" class="btn-small">← 演習一覧</button>` +
      `<div class="zt-card"><div class="zt-q">${zEsc(ex.title)} <span class="zt-ex-tenet">${zEsc(ex.tenet)}</span></div>` +
      `<div class="zt-a">${zEsc(ex.spec)}</div>` +
      `<ul class="zt-cond">${ex.conditions.map((c) => `<li>${zEsc(c)}</li>`).join('')}</ul></div>` +
      `<textarea id="zt-editor" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"></textarea>` +
      `<div class="run-row"><button id="zt-run" class="btn-primary">▶ 実行</button>` +
      `<button id="zt-test" class="btn-accent">✓ テストで判定</button></div>` +
      `<div id="zt-run-status" class="loading" hidden></div>` +
      `<pre id="zt-run-out" hidden></pre>` +
      `<button id="zt-hint-btn" class="btn-ghost">💡 ヒント</button>` +
      `<div id="zt-hint" class="zt-note" hidden></div>` +
      `<div id="zt-test-result"></div>`;
    const ed = el('zt-editor');
    ed.value = code;
    // Tabキーで2スペース字下げ（既存エディタと同じ操作感）
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const p = ed.selectionStart; ed.value = ed.value.slice(0, p) + '  ' + ed.value.slice(ed.selectionEnd); ed.selectionStart = ed.selectionEnd = p + 2; }
    });
    ed.addEventListener('input', () => { try { localStorage.setItem(codeKey(ex.id), ed.value); } catch (e2) {} });
    el('zt-ex-back').onclick = () => renderCoding();
    el('zt-run').onclick = runExercise;
    el('zt-test').onclick = testExercise;
    el('zt-hint-btn').onclick = () => { const hb = el('zt-hint'); hb.textContent = '💡 ' + ex.hint; hb.hidden = false; el('zt-hint-btn').hidden = true; };
  }

  async function runExercise() {
    const code = el('zt-editor').value;
    if (!code.trim()) { el('zt-run-out').textContent = 'コードが空です。まず書いてみよう'; el('zt-run-out').hidden = false; return; }
    setBusy(true);
    const r = await Runner.run(code, (m) => { el('zt-run-status').textContent = m; });
    setBusy(false);
    const text = (r.stdout || '') + (r.stderr || '') + (r.error && r.stdout === undefined ? r.error : '');
    el('zt-run-out').textContent = text || '(出力なし。関数を定義しただけなら、print(...) で呼び出して試そう)';
    el('zt-run-out').className = (r.stderr || r.error) ? 'has-error' : '';
    el('zt-run-out').hidden = false;
  }

  // §2 と同じ精神：テストはPyodideでユーザーのコードをN回実行して機械判定（合否確定）。答えは出さない
  async function testExercise() {
    const code = el('zt-editor').value;
    if (!code.trim()) { showTestMsg('まずコードを書いてみよう'); return; }
    setBusy(true);
    const rows = [];
    let allPass = true;
    for (const t of curEx.tests) {
      el('zt-run-status').textContent = 'テスト実行中…';
      const r = await Runner.run(code + '\nprint(' + t.call + ')', (m) => { el('zt-run-status').textContent = m; });
      const err = (r.stderr || '').indexOf('Traceback') !== -1 || (r.error && r.stdout === undefined);
      const pass = !err && !r.timeout && norm(r.stdout) === norm(t.expected);
      if (!pass) allPass = false;
      // 入力(call)と合否だけ見せる。期待値は出さない（自分で考える §1/§11）
      rows.push(`<div class="build-test ${pass ? 'pass' : 'fail'}">${pass ? '✓' : '✗'} ${zEsc(t.call)}</div>`);
    }
    setBusy(false);
    let h = rows.join('');
    if (allPass) {
      markDone(curEx.id);
      const idx = ZT_CODING.findIndex((e) => e.id === curEx.id);
      const next = ZT_CODING[idx + 1];
      h = `<div class="zt-pass">🎉 全テスト通過！ ${zEsc(curEx.title)} クリア</div>` + h +
        (next ? `<button id="zt-next-ex" class="btn-primary">次の演習へ ▶</button>` : `<div class="zt-done">🏆 全演習クリア！ ゼロトラストの門番を自分で書けるようになった。卒業制作レベルです。</div>`) +
        `<button id="zt-back2" class="btn-ghost">演習一覧へ</button>`;
    } else {
      h = `<div class="zt-fail">まだ通らないテストがある。条件を見直して直そう（答えは出ません＝自分で組む段）。詰まったら💡ヒント。</div>` + h;
    }
    el('zt-test-result').innerHTML = h;
    if (allPass) {
      const nb = el('zt-next-ex'); if (nb) nb.onclick = () => openExercise(ZT_CODING[ZT_CODING.findIndex((e) => e.id === curEx.id) + 1]);
      el('zt-back2').onclick = () => renderCoding();
    }
  }
  function showTestMsg(msg) { el('zt-test-result').innerHTML = `<div class="zt-fail">${zEsc(msg)}</div>`; }
  function setBusy(b) {
    el('zt-run-status').hidden = !b;
    const run = el('zt-run'), test = el('zt-test');
    if (run) run.disabled = b; if (test) test.disabled = b;
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
