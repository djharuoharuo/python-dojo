# CLAUDE.md — Python道場（python-dojo）

スマホ完結型・自己適応Python学習アプリ。
設計思想：**「ワークフロー型」**（Anthropic "Building Effective Agents" 準拠）。状態管理と手順はすべてコードが持ち、LLMは「問題を生成する」「採点する」だけのステートレスな関数として使う。AIチャットへの運用指示・状態記憶への依存をゼロにする。

---

## 0. 背景（なぜ作るか）

- 利用者（はるき）はPython初心者。これまでChatGPT＋Notionで学習システムを運用していたが、LLMに状態管理をさせる構造のため「指示無視」「読み書き失敗」「番号重複」が頻発した
- Claude（Pro）は開発専用にしたい。日常学習はサブスク不要・月額¥0で回したい
- 学習は**スマホ（Galaxy Z Fold 3 / Android / Chrome）だけで完結**させる。開発はPC
- **最終目標**：基礎修了後、ゼロトラストの原則（毎リクエスト検証・最小権限・fail closed）をPythonで**自作デモできる**状態に到達する。カリキュラムの終点は§11の卒業制作

## 1. 譲れない要件（非交渉）

1. 学習者のレベル・苦手傾向に合わせた問題の自動生成
2. 採点と完全初心者向けの解説
3. 学習データ（正誤・ミス傾向・復習スケジュール）の自動蓄積
4. 蓄積データが次の出題に自動反映される
5. 日常操作はスマホのボタンタップのみ（プロンプト手打ち不要）
6. ランニングコスト ¥0/月

---

## 2. アーキテクチャ

```
[スマホPWA]  GitHub Pages（docs/ 配下・無料）
  ├ 出題リスト / 問題画面 / コードエディタ(textarea)
  ├ Pyodide（CDN・ブラウザ内でCPython実行→stdout/traceback自動取得）
  └ fetch → GAS Web API（JSON）
        │
[GAS Web API]  新規スタンドアロンプロジェクト（claspで同リポジトリ管理）
  ├ 認証: リクエスト毎に APP_TOKEN 照合（Script Properties）
  ├ Gemini API 呼び出し（キーはScript Propertiesのみ。クライアントに置かない）
  ├ FSRSスケジューラ（ts-fsrsをesbuildでバンドルして同梱）
  └ Googleスプレッドシート読み書き（学習者モデルの唯一の保存先）
        │
[データ]  1つのスプレッドシート（タブ: concepts / problems / attempts / mistakes / config）
```

- **Notionは使わない**（Phase 2で週次サマリのミラー出力のみ検討）。旧Notionシステムは閲覧用アーカイブとして残す
- 既存GASプロジェクト（notion-diary-auto-summary）には**一切手を入れない**。完全新規

## 3. リポジトリ構成

```
python-dojo/
├ CLAUDE.md            ← 本ファイル
├ README.md            ← セットアップ手順（人間向け・日本語）
├ docs/                ← GitHub Pages 公開ディレクトリ（PWA本体）
│  ├ index.html
│  ├ app.js
│  ├ tools.js          ← 「実用ツール解放」カタログ（手書きの実物スクリプト §11）
│  ├ style.css
│  ├ manifest.json     ← ホーム画面追加用
│  └ sw.js             ← キャッシュ用Service Worker（Pyodide本体もキャッシュ）
├ gas/                 ← clasp管理のGASソース
│  ├ appsscript.json
│  ├ main.js           ← doPost ルーター
│  ├ llm.js            ← Gemini呼び出し（モデルチェーン・日次予算・週次ヘルスチェック）
│  ├ generate.js       ← 出題ロジック＋Gemini呼び出し
│  ├ grade.js          ← 採点ロジック＋Gemini呼び出し
│  ├ ask.js            ← 自由質問（詰まったら先生に聞く・答えは明かさない）
│  ├ hint.js           ← 段階ヒント（押すほど詳しく 方針→骨組み→穴埋め・hint）
│  ├ revenge.js        ← リベンジ再テスト（間違えた問題を数日後に類題で再出題）
│  ├ history.js        ← 過去問・自分の解答・した質問を見返す（getHistory）
│  ├ drafts.js         ← 解答の途中保存をサーバにも持つ（saveDraft・PC↔スマホ共有）
│  ├ store.js          ← Sheets読み書き
│  ├ fsrs.bundle.js    ← ts-fsrsバンドル（build/で生成）
│  └ setup.js          ← 初回セットアップ＋migrate（タブの後付け追加）
├ build/               ← esbuild設定（ts-fsrs → fsrs.bundle.js）
└ .github/workflows/
   └ deploy.yml        ← Pagesデプロイ（SecretsからconfigJSを生成して注入）
```

技術制約：フロントはビルド不要のvanilla HTML/CSS/JS（保守性最優先）。フレームワーク・npm依存はフロントに持ち込まない。Pyodideは jsDelivr CDN から読み込み。

---

## 4. データモデル（スプレッドシート）

### concepts タブ
| 列 | 内容 |
|---|---|
| concept_id | 一意ID（例: `for_range`） |
| name | 表示名（例: `for / range`） |
| state | `未` / `練習中` / `習得` |
| prereq | 前提concept_id（カンマ区切り。スキルツリー） |
| no_review | TRUEなら復習対象外（printなど常用概念） |
| due / stability / difficulty / reps / lapses / last_review | FSRSカード状態 |
| nohint_streak | ノーヒント連続正解数（種別切替判定用） |
| nohint_correct_days | ノーヒント正解した日付リスト（昇級判定用） |

### problems タブ
problem_id / number（通し番号） / concept_id / type（新規・復習・ノーヒント・デバッグ） / payload_json（問題全文） / status（未回答・採点済） / created_at

### attempts タブ
attempt_id（採点時にコードが発番。UI→saveSelfNoteで使用） / timestamp / problem_id / concept_id / type / verdict（正解・惜しい・不正解） / hint_used（bool） / error_pattern / self_note（本人記入の原因1行・初期空） / code / stdout / stderr / model_used / feedback_json（もらったヒント配列とフル解説をJSONで保存。履歴で振り返れるように §5 getHistory） / mode（`本番`／`練習`。過去問の**再挑戦**は `練習` として記録だけ残し、FSRS・昇級/降格・難易度クランプ・mistakes集計・リベンジには一切混ぜない＝詰め込み正解でスケジュールを乱さない／遊びの誤答で降格させないため。ストリーク（calcStreak_）と履歴・問題ごとの通算正解率にだけ反映。空欄は本番扱いで後方互換。列は必ず末尾に追加）

### revenge タブ
problem_id（元の間違えた問題） / concept_id / due（再出題する日） / status（待機・出題済）
> リベンジ再テスト（テスト効果 §6/§11）。grade が不正解/惜しい確定時に `enqueueRevenge_`（同概念は1件に集約）。generate が due到来分を `pickDueRevenges_` で取り出し、元問題の【類題】（数値・題材だけ変えた変種）を1問だけ復習枠で出題する（答えは先に見せない）。payloadに `is_revenge:true` が付きUIで「🔁 リベンジ」と案内。migrate未実行でも採点は止めない

### drafts タブ
problem_id / updated_at / code / hints_json / asks_json / hint_used
> 解答の途中保存をサーバにも持ち、PC↔スマホで続きから再開できるようにする（§5 saveDraft が1問1行でupsert、空になったら行削除）。localStorageが即時・圏外を担い、こちらが端末間共有を担う。getToday が未回答問題ぶんをまとめて返す

### asks タブ
ask_id / timestamp / problem_id / concept_id / question（本人の質問） / answer（先生の回答） / model_used
> 「詰まったら先生に聞く」（§5 ask）が1問1行で追記する。履歴画面（getHistory）の素材。**正解コードは含まない**（家庭教師プロンプトが担保）。migrate未実行でも ask 自体は動くよう、保存失敗は飲み込む

### mistakes タブ
pattern / count / last_seen（error_patternの集計。デバッグ問題の素材）

### config タブ（key-value形式）
| key | 既定値 | 用途 |
|---|---|---|
| last_problem_number | 30 | 次の発番はこれ+1 |
| daily_count | 3 | 1セッションの問題数 |
| theme_weights | 基礎:0.6,音楽:0.3,日常:0.1 | 題材ローテの重み。超初心者期は「基礎（素朴な数の問題）」主軸・セキュリティ題材は0（基礎が固まるまで温存。卒業目標は§11 capstone_ztに残す） |
| target_acc_low / target_acc_high | 0.75 / 0.90 | 難易度クランプの目標帯 |
| nohint_threshold | 5 | この連続正解数で足場外し（超初心者期は長め。実装精度が固まる前に構文を自分で選ばせない） |
| daily_llm_budget | 60 | 1日のLLM呼び出し上限（乱用ガード） |
| model_chain | gemini-3.5-flash,gemini-2.5-flash,gemini-2.5-flash-lite | 試行順（カンマ区切り）。モデル名はハードコード禁止＝このセルだけで更新（§5b/§6） |
| model_last_used / model_checked_at / model_notice | — | §5b |
| theme_ramp_done | （空） | TRUEなら「セキュリティ題材の自動解放」は実行済み（二度発火させない）。§6 |
| theme_notice | （空） | 自動解放時のお祝いバナー文。getToday が model_notice と合わせて `notice` で返す |
| streak_freeze_used_week | — | Phase2 |

> 補足：「今日のボトルネック」は専用列を持たず、getToday時に**直近20件のattemptsのerror_patternから最頻パターン1つ**を返す（苦手を克服すると表示も切り替わる＝“いまの弱点”を指す）。直近にミスが無ければ mistakes 通算トップにフォールバック（情報を空にしない）

## 5. GAS Web API 仕様

- デプロイ：ウェブアプリ（実行ユーザー＝自分、アクセス＝全員）。URLは1本
- **CORS対策（重要）**：GASはOPTIONSプリフライトを処理できないため、クライアントは `Content-Type: text/plain` で `JSON.stringify(body)` をPOSTする（simple requestにしてプリフライト回避）。GASは `e.postData.contents` をparseし、`ContentService` でJSON文字列を返す
- 全リクエスト共通body：`{ token, action, ...params }`。token不一致は `{error:"unauthorized"}`
- **競合制御**：書き込み系（generate / grade / saveSelfNote）は `LockService.getScriptLock()` で直列化し、`last_problem_number` の採番やFSRS更新の競合を防ぐ（番号重複を構造的に根絶）。読み取り（getToday）はロック不要
- **エラー応答の統一**：全actionは失敗時 `{error: "種別", message: "日本語の対処"}` を返し、フロントは§8の方針で表示（黙って失敗しない）
- **日次予算（乱用ガード）**：LLM呼び出しは1日 `daily_llm_budget`（既定60）回まで。超過は `{error:"budget"}` を返しnoticeに記録。TOKENが漏れた場合でもGemini無料枠の枯渇を1日分で食い止める

### action 一覧
| action | 入力 | 出力 | 処理 |
|---|---|---|---|
| `getToday` | なし | 未回答問題リスト＋現在地サマリ（習得数・本日の復習対象・ストリーク日数・**今日のボトルネック**）＋各問題の`drafts`（PC↔スマホ共有）＋`mastered_concepts`（習得済み概念ID＝解放ツール判定用 §11） | 読み取りのみ。§5bヘルスチェックもここで |
| `generate` | `count`(既定3) | 生成された問題配列 | §6の出題ロジック→Gemini→検証→problemsに保存→last_number更新 |
| `grade` | `problem_id, code, stdout, stderr, stage("hint"/"full"), hint_used, mode("normal"/"practice")` | §7の採点JSON（full時は `attempt_id` を必ず含めて返す。`practice` フラグも返す） | stage=fullの時のみ：attempts追記（attempt_id発番）・FSRS更新・mistakes集計・昇級判定。**mode=practice（過去問の再挑戦）の時は attempts に `mode=練習` で記録するだけで、FSRS・昇級/降格・mistakes・リベンジ・問題statusには触れない**（履歴とストリークにだけ残す） |
| `saveSelfNote` | `attempt_id, note` | ok | grade(full)が返したattempt_idの行のself_noteを更新 |
| `ask` | `problem_id, code, question` | `{answer, model_used}` | 自由質問。Geminiが【正解コードは出さず】次の一歩を導く。ステートレス（会話履歴なし）。daily_llm_budgetを消費。質問と回答を asks に保存。フロントは使用時に当該問題を `hint_used=true` 扱いで記録（§7） |
| `hint` | `problem_id, code, level(1-3)` | `{hint, level, model_used}` | 段階ヒント。levelが上がるほど詳しく（1=方針＋この問題に沿った小例 / 2=骨組み / 3=穴埋め）。完成コードは出さない（穴埋めも全部は埋めない）。ステートレス（levelだけ受け取る）。daily_llm_budgetを消費。`hint_used=true` 扱い。もらったヒントはgrade時に attempts.feedback_json へ保存される |
| `getHistory` | `limit`(既定30) | `{items:[…]}`（新しい順。各itemに問題文・自分のcode・verdict・hint_used・self_note・もらったヒント・Geminiの解説・した質問・`practice`（再挑戦か）・`tries`/`corrects`（その問題の通算成績）・`problem_id`/`payload`（再挑戦で開き直す用）） | 読み取りのみ。attempts に problems・asks を結合し、feedback_jsonからヒント/解説を復元。履歴画面の素材＝ここから**過去問の再挑戦**（練習モード）を起動する |
| `saveDraft` | `problem_id, code, hints, asks, hint_used` | `{ok}`（空内容なら`{ok,cleared}`で行削除） | 下書きを drafts タブにupsert（PC↔スマホ共有）。空（コード/ヒント/質問すべて無し）なら行を削除して掃除 |
| `clearNotice` | なし | ok | model_notice をクリア |

> 解答の途中保存（下書き）は**localStorage（即時・圏外可）とサーバ（drafts タブ）の二段**で持つ。コード・もらったヒント・した質問を問題ごとに残し、同じ問題を開くと続きから再開できる。サーバにも持つことでPCで書いた下書きをスマホで継げる（開く時は updated_at/savedAt の新しい方を採用）。採点完了時にその問題の下書きはローカル・サーバ両方から破棄する（§8-2）

### 5b. モデル管理（変更検知・自動切替・ユーザー通知）
- `config` に追加：`model_chain`（優先順）/ `model_last_used` / `model_checked_at` / `model_notice`
- **週次ヘルスチェック**：`getToday` 時に `model_checked_at` が7日以上前なら Gemini の `models.list` を呼び、チェーン内モデルの存在を検証。消えたモデルはチェーンから外して `model_notice` に記録
- **自動切替**：呼び出し失敗（404=廃止／429=枯渇／5xx）は次のモデルへ。実際に使ったモデルが `model_last_used` と異なれば `model_notice` を更新
- **ユーザー通知**：`getToday` レスポンスに `notice` を含め、フロントは画面上部にバナー表示（例：「⚠️ gemini-2.5-flash が利用不可のため flash-lite で動作中」）。[OK]タップで `clearNotice` action を呼びクリア
- READMEに「モデル名は変わるもの」という前提と、チェーン更新手順（configの1セル書き換えのみ）を明記

## 6. 出題ロジック（すべてコード側で決定。LLMには完成した仕様を渡すだけ）

1. **構成（3問）**：復習1問＋新規 or 練習中2問
   - 復習枠：`due <= 今日` の習得概念のうち最も期限超過が古いもの。該当なしなら mistakes 上位パターンに関連する練習中概念
   - 新規/練習枠：スキルツリーで前提を満たし `state=未 or 練習中` の概念（未は同時に1つまで新規解放）
2. **種別の自動切替**：対象概念の `nohint_streak >= nohint_threshold`（既定5。超初心者期は長め）→ 以後その概念は「ノーヒント」と「デバッグ」を交互に出題（足場外し）
   - デバッグ問題のバグは mistakes 上位パターンから1つ選んで仕込む
3. **題材**：**超初心者期は「基礎（素朴な数の問題：1からnまでの合計・偶数だけ足す・倍数を数える・最大値を返す）」を主軸**にする。Notionで実際にできていたのはこの素朴な型で、音楽（BPM計算）やセキュリティ（ログ集計）という"知らない題材"が syntax の上に乗ると難しすぎたため。配分は `theme_weights`（既定 基礎0.6／音楽0.3／日常0.1）。音楽はBPM→1拍ミリ秒など**計算1ステップ**の身近な題材に留める。**セキュリティ／ゼロトラスト題材は基礎が固まるまで一旦0**（卒業目標としては §11 capstone_zt に温存）。**基礎（max_search/total/for_if/def_args_return/for_range/if_else/mod）が全部「習得」になったら、generate が自動でセキュリティ比率を戻す**（`maybeRestoreSecurityTheme_`：theme_weights を `基礎:0.4,音楽:0.3,セキュリティ:0.3` にし、`theme_ramp_done=TRUE` で二度は発火させず、`theme_notice` にお祝いを書いてホームのバナーで通知）＝「同じ文法をセキュリティ文脈でも出す」へ自動移行：for+if＝失敗ログインの回数カウント、最大値探索＝最多アクセスIPの特定。手動で前後させたい時は theme_weights のセルを書き換えればよい（theme_ramp_done が TRUE なら自動上書きはもう起きない）
4. 問題番号は `config.last_problem_number + 1` から連番
5. **難易度クランプ（85%ルール）**：直近20問の正答率（惜しい=0.5換算）が90%超→ノーヒント/デバッグ比率を上げる。75%未満→新規解放を止め、復習と練習中の比率を上げる（目標帯75〜90%。§11参照）

### Gemini 生成呼び出し
- モデルは**ハードコード禁止**。`config` タブの `model_chain`（既定: `gemini-2.5-flash → gemini-2.5-flash-lite`。3系の正式GA名は実装時に `models.list` で確認して先頭に追加）を上から順に試行。429/404/5xxは指数バックオフ→次のモデルへ
- レスポンスに必ず `model_used` を含め、attemptsにも記録（§5bのモデル管理参照）
- `generationConfig`: `responseMimeType: "application/json"` + responseSchema、temperature 0.7
- システム指示（要旨）：

```
あなたはPython完全初心者向けの問題作成者。渡された仕様（概念・種別・テーマ・番号）に
厳密に従い、JSONのみを出力する。
- 日本語。問題文は2〜3文。専門用語には短い説明を添える
- 種別がノーヒントの場合、conditionsは「関数名は `xxx`」の1項目のみ
- 種別がデバッグの場合、buggy_codeに指定されたerror_patternのバグを1つだけ仕込む
- example_callは print() を含む完全な呼び出し、expected_outputは厳密な出力
```

- 出力スキーマ：
```json
{"problems":[{"number":31,"title":"","concept_id":"while","type":"新規",
"statement":"","conditions":["関数名は `count_up`","while を使う"],
"example_call":"print(count_up(5))","expected_output":"1\n2\n3\n4\n5",
"buggy_code":null,"theme":"音楽"}]}
```
- 検証：JSONパース失敗・number重複・スキーマ不一致は1回だけ再生成、それでも失敗ならエラーを返す（クライアントに「もう一度」ボタン表示）
- **expected_output は採点の機械的正解として problems に保存する**（§7でコードが文字列比較に使う。デバッグ種別では「修正後の正しい出力」を保存）

## 7. 採点ロジック

**前提：実行結果なしでは採点リクエスト自体を送らない**（フロント側で[実行]未実施なら[採点]ボタンを無効化）。

### 正誤はコードが決める（LLMに委ねない）
- **一次判定はコードが `stdout` と保存済み `expected_output` を正規化比較**（末尾改行・行末空白を吸収）して 正解/不正解 を出す。LLMの気分で正誤が揺れる事故を防ぐ
- stderr が空でなくTracebackがある → 自動的に不正解（実行時エラー）
- `verdict` の「惜しい」は、出力は不一致だが LLM が「方針は合っている」と判定した場合にコードが格上げする補助ラベル。**正解/不正解の確定はコードの比較結果が最終**
- LLMの役割は**ヒント生成と解説のみ**。正誤フラグはコードが付けてからLLMに渡す（LLMには「この回答は不正解だった。なぜか初心者向けに説明して」と既に判定済みで依頼する）

### 2段階方式（ヒント先行）
- type が **復習・ノーヒント・デバッグ** → まず `stage="hint"`：コードが正誤を出し、不正解なら誘導質問のみ返す（正解コードは返さない）。本人が修正して再実行・再採点、または「答えを見る」タップで `stage="full"`。hint段階では attempts に書かない（full確定時にまとめて記録）
- type が **新規** → 最初から `stage="full"`（worked example方式）
- ※ hint段階で一度でもヒントを見たら、その問題の最終 `hint_used=true` として記録

### Gemini 採点呼び出し（解説生成）
- temperature 0.2、responseSchema必須。入力：問題payload＋本人コード＋**実際のstdout/stderr＋コードが出した正誤フラグ**
- hint出力スキーマ：`{"hints": ["最大2つ。答えは明かさない。stderrがあればTracebackの読み方を1つ含める"]}`
- full出力スキーマ：
```json
{"verdict_hint":"惜しい|不正解",
"correct_code":"...",
"what_differs":"どこが合っていてどこが惜しいか",
"line_by_line":["1行ずつの解説。用語・関数の意味を毎回添える"],
"why":"なぜそう書くのか（概念理解）",
"error_pattern":"未定義変数|range+1忘れ|更新方向逆|比較対象ミス|return忘れ|スペルミス|初期値設計|その他|なし",
"one_point":"次に活きる一言"}
```
- 正解時はLLMを呼ばず、コードが定型の「正解！」＋保存済みexpected_outputとの一致を表示（API節約。任意で短い称賛のみLLM）

### full採点後のコード側処理（LLMに任せない）
1. attempts に1行追記し **attempt_id を発番**（応答に含めUIへ返す）
2. **FSRS rating**：不正解→Again / 惜しい→Hard / ヒントあり正解→Hard / ノーヒント正解→Good（UIの「余裕だった」タップ時のみEasy）→ conceptsのカード状態更新
3. **昇級判定**：ノーヒント正解日が**異なる日付で2日分**揃ったら `練習中→習得`（同日2回は不可）。習得概念で 惜しい/不正解 → `習得→練習中` に降格＋due=7日後。さらに正解時は `nohint_streak` を更新、不正解で0リセット
4. error_pattern ≠ なし → mistakes 集計更新（count++、last_seen更新）
5. UIに「原因を自分の言葉で1行」入力欄を表示 → attempt_id付きで `saveSelfNote`（スキップ可だが毎回促す）

## 8. フロントエンド仕様（スマホ最優先・1画面遷移）

1. **ホーム**：「今日の問題」リスト（getToday）。未回答0なら[問題を作る]ボタン → generate。上部に**ストリーク日数**と**今日のボトルネック1つ**（「今日はこれを潰すと効く：range の +1 忘れ」）を表示。modelの`notice`があればバナー
2. **問題画面**：問題文・条件・実行例 → `textarea`（monospace・スペルチェックoff・autocapitalize/autocorrect off・Tabで字下げ2スペース挿入）→ [▶ 実行] → 出力/Traceback表示エリア → [採点する]（実行済みのみ活性）
3. **採点結果**：hint段階＝ヒント表示＋[修正して再実行][答えを見る]。full段階＝判定・正解コード・解説 → 原因1行入力（grade応答の `attempt_id` を保持して送信）→ [保存して次へ]
4. **Pyodideと安全装置（whileを学ぶため必須）**：
   - 初回[実行]タップ時に遅延ロード（「Python起動中…」表示）
   - **実行は必ず Web Worker 内**。メインスレッドで走らせない（UIが固まらない）
   - **無限ループ対策**：実行に5秒のタイムアウトを設け、超過したらWorkerを `terminate()` して「実行が5秒を超えました。無限ループ（whileの条件が常にTrueなど）かもしれません」と表示。次回実行用にWorkerを再生成
   - `sys.stdout`/`stderr` を `io.StringIO` にリダイレクトして取得、例外は `traceback.format_exc()` で全文取得
   - `input()` は問題側で使わせない（§6のシステム指示で禁止済み）。万一コードに含まれたら実行前に検知して注意表示
5. **オフライン時の挙動**：getToday/generate/grade は通信必須。オフラインなら「採点にはネット接続が必要です」と明示（黙って失敗しない）。**Pyodideでの[実行]だけはオフライン可**なので、圏外でも書いて試すことはできる旨を案内
6. **PWA**：manifest＋Service WorkerでアプリシェルとPyodideをキャッシュ（2回目以降の[実行]はオフライン可）。ホーム画面追加を初回案内。Foldの内外画面の幅変化に追従するレスポンシブ
7. UIテキストは全て日本語。配色はダーク基調（深夜の練習を想定）

## 9. セキュリティ（ゼロトラスト設計）

原則「**決して信頼せず、常に検証する**」を個人アプリ規模に翻訳して実装する。

1. **明示的な検証（Verify explicitly）**：全リクエストで毎回APP_TOKEN照合（セッションという暗黙の信頼を作らない）。**LLMも信頼しない**——応答はスキーマ検証を通るまで保存禁止。クライアント入力（コード文字列等）は長さ・型を検証してからプロンプトに渡す
2. **最小権限（Least privilege）**：GeminiキーはGAS Script Propertiesのみ、フロントには秘密を一切置かない。`appsscript.json` の `oauthScopes` は `spreadsheets` と `script.external_request` の2つに限定明記。既存の日記GASとはプロジェクト・鍵・シートを完全分離（侵害の横展開を遮断）
3. **侵害前提（Assume breach）**：構成要素ごとの被害想定と対処をREADMEに明記——フロント流出→TOKENのみ露出（キーは無事。即ローテ手順記載）／シート流出→学習ログのみ（**個人情報を最初から入れないデータ最小化**で被害を設計段階で限定）／Gemini無料枠は入力が学習利用され得る前提で、固有名詞・個人情報を問題文やコードに含めない
4. **信頼境界の一点集約**：公開側（GitHub Pages＝静的・秘密なし）と実行側（GAS＝ポリシー施行点）を分離し、検証はGASの入口1箇所に集約
5. **クライアント設定の扱い（重要）**：`config.js`（GAS URLとTOKEN）はソースに置かない。**GitHub ActionsがRepository Secrets（`GAS_URL` / `APP_TOKEN`）からデプロイ時に生成してPagesへ注入**する（.gitignoreのままではPagesに届かず動かないため、この方式が必須）。なお**ブラウザに配信された時点でTOKENは公開情報とみなす**——その役割は乱用への摩擦であり、本丸の防御は§5の日次予算・即ローテ手順・個人情報ゼロ設計。よってリポジトリはpublicで問題ない（コミット履歴含め秘密を一切置かないこと）
6. **GAS自動デプロイ（任意・オプトイン）**：`.github/workflows/deploy-gas.yml` が、Secrets（`CLASP_CREDENTIALS`/`GAS_SCRIPT_ID`/`GAS_DEPLOYMENT_ID`）設定時のみ、`gas/`へのmain push/マージで`clasp push`＋既存デプロイ更新を自動実行する（README §4.5）。これはclasp認証情報がユーザーのPCだけでなくGitHub Secretsにも存在する状態への拡張であり、トレードオフは：①mainへの書き込み権限を持つ者は次のclasp pushで同じコードを反映できるため実質的な信頼境界は変わらない、②`CLASP_CREDENTIALS`はAPP_TOKENより強い権限（GASプロジェクト自体の書き換え）を持つため漏洩時はGoogleアカウント側のサードパーティアクセス取消＋再ログインで即ローテ、③forkからのpull_requestでは発火せずSecretsも渡らない（GitHubの仕様）。**未設定の場合は従来の手動`clasp push`手順のみが有効**で、設定は完全に任意

## 10. シードデータ（setup.jsで投入。Notion問題集①〜⑥の**実際の答案**で校正した「ホントの現在地」）

> 校正の根拠：📊学習ステータスの**ラベル**（✅/🔧）ではなく、答案で実際に起きたことに合わせる。
> total・for+if は📊では✅だったが、答案には `return total` 忘れ・`range(1,n)` の+1忘れ・問題読み違いが残るため**練習中に降格**（足場を外さない）。最大値探索は㉒でヒント要・㉗誤読・㉘で3箇所同時崩壊＝**未定着の最優先弱点**。while は㉙㉚を作っただけで未着手。→ 概念は分かるが**実装精度（スペル・+1・初期値・比較対象）でこける段階**なので、超初心者向けに足場固めを優先する。

concepts 初期状態（練習中は弱い順に並べる＝pickSlots_が上から練習対象にする）：
```
print: 習得, no_review=TRUE
max_search(最大値/最小値探索): 練習中   ← 最優先弱点（練習中の先頭）
total(total累積): 練習中             ← ✅から降格
for_if(for+if組合せ): 練習中          ← ✅から降格
def_args_return(def/引数/return): 練習中
for_range: 練習中
if_else: 練習中
mod(剰余%): 練習中
traceback(Tracebackを読む): 未, prereq=なし（常時並行扱い・新規解放の対象外でhint側で育てる）
while: 未, prereq=for_range            ← 次に解放される唯一の新規概念
str_fstring(文字列/f-string): 未, prereq=for_range（printからfor_rangeに変更＝基礎が習得になるまで新規を出さない）
list_basic(list/append/index/slice): 未, prereq=for_range
dict_basic(辞書): 未, prereq=list_basic
try_except(エラー処理try/except・fail closed): 未, prereq=list_basic
file_io(ファイル読み書き): 未, prereq=str_fstring, list_basic
sec_stdlib(セキュリティ標準ライブラリ入門: hashlib/secrets/datetime/re): 未, prereq=dict_basic, try_except
capstone_zt(卒業制作: ミニ・ゼロトラストゲート): 未, prereq=file_io, sec_stdlib
```
mistakes 初期値（答案の実頻度で校正・多い順）：`スペルミス(4) / range+1忘れ(3) / 比較対象ミス(2) / 更新方向逆(2) / 未定義変数(2) / return忘れ(2) / 初期値設計(2)`
config：`last_problem_number=30`（旧Notion問題集の㉚まで使用済み。本アプリは㉛=31から）

> **reseed()（setup.js）**：運用後に「現在地が合っていない」と分かったら、GASエディタから `reseed()` を一度実行する。problems / attempts / drafts / revenge / asks（運用で溜まった不適合な蓄積）を全消去し、concepts / mistakes / config を上記ベースで作り直す（setup() と違いスプレッドシート自体は残す＝破壊的だが復旧不要）。

## 11. モチベーション設計（行動科学レイヤー）

長期記憶はFSRSが担い、継続意欲はこのレイヤーが担う。設計原則：**報酬で釣らず、自律性と有能感を支える「情報的フィードバック」に徹する**（統制的な報酬は内発的動機を毀損し得るため、ポイント・バッジの乱発は採用しない）。

**Phase 1 に含めるもの：**
- **ストリーク表示**：attemptsの日付から連続学習日数を算出しホームに表示（追加テーブル不要）
- **完了サマリ（小さな勝利の可視化）**：その日の問題を解き終えたら「今日の進歩」を1画面表示——正答数・昇級した概念・前回からの改善点をコードが組み立てる（進歩の感覚こそ最大の動機）
- **難易度モニタリング**：§6の難易度クランプ（正答率75〜90%帯の維持）

**Phase 2 に含めるもの：**
- **ストリークフリーズ**：週1回まで自動で穴埋め（完璧主義による「1日切れたら全部やめる」離脱を防ぐ赦しの設計）
- **実用ツール解放（アイデンティティ報酬・本命）**：節目の概念を習得するたび、実際に使えるスクリプトを「解放」。音楽系——str_fstring習得→セットリスト整形／list習得→サンプル名一括リネーム／dict習得→BPM・キー管理帳。セキュリティ系——dict習得→簡易ポリシーエンジン（誰に何を許可するかの判定表）／try_except習得→fail closedの門番関数／file_io習得→アクセスログ異常検知／sec_stdlib習得→トークン生成器・ファイル改ざん検知（hashlib）。学習が「KemuriBeatの道具」と「セキュリティの腕」の両方に直結する
- **卒業制作（全ツリー踏破の最終解放）＝ミニ・ゼロトラストゲート**：毎リクエストのトークン検証・許可リスト判定・失敗ログ記録・fail closedを備えた小さな門番をPythonで自作する。**参考実装はpython-dojo自身のGAS門番（§5・§9）**——自分が毎日使ってきた学習アプリの守りを、卒業時には自分で読めて、作り直せるようになるのがゴール
- **テーマ選択（自律性）**：その日の題材（音楽／日常／おまかせ）を本人がタップで選択
- **週次ふりかえり**：日曜に1週間の進歩サマリを自動生成（Notion日記ミラーと統合）
- **デロード週**：高負荷が3週続いたら4週目は復習のみの軽い週をコードが提案（スポーツ科学のピリオダイゼーション。燃え尽き防止）

## 12. フェーズ分割

**Phase 1（MVP・最優先）**：§2〜§11(Phase1分)の全コアループ。受け入れ基準：
- スマホChromeでホーム→生成→解答→[実行]→（不正解なら）ヒント→修正→full採点→原因1行保存まで一気通貫で通る
- **正誤がコードのstdout比較で確定**し、LLMが落ちても正解/不正解は判定できる
- **whileの無限ループを書いても5秒でWorkerが止まり、UIが固まらない**
- attemptsに行が増え（attempt_id発番）、conceptsのdue/stateが更新され、再度generateすると復習・難易度に反映されている
- ホームにストリーク日数と今日のボトルネックが出る
- Gemini 429/404時にmodel_chainのフォールバックが動き、必要なら通知バナーが出る
- 個人情報・固有名詞が問題文／コードに含まれない（§9のデータ最小化）
- リポジトリ内（コミット履歴含む）にTOKEN・APIキーが一切存在しない

**Phase 2（MVP動作確認後）**：
- 毎朝7時の時間トリガーで自動プリ生成（開いたら今日の問題が待っている状態）
- 統計画面（習得マップ・正答率推移・ミスパターン推移）
- 週次サマリをNotion日記へミラー（既存日記DBへ。別トークン）
- CodeMirror 6導入（シンタックスハイライト）／Groqフォールバック追加

## 13. 開発・デプロイ手順（README.mdに詳述すること）

1. `clasp login` → `clasp create --type standalone --title python-dojo` → gas/と紐付け → `clasp push`
2. GASエディタで `setup()` を1回実行（シート自動作成＋シード投入＋SPREADSHEET_ID保存）
3. Script Properties に `GEMINI_API_KEY` / `APP_TOKEN` を設定 → ウェブアプリとしてデプロイ → URL取得
4. GitHubリポジトリの Settings → Secrets and variables → Actions に `GAS_URL` と `APP_TOKEN` を登録 → pushすると deploy.yml がconfig.jsを生成しGitHub Pagesへ自動デプロイ（PagesのソースはGitHub Actionsを選択）
4.5. （任意）`CLASP_CREDENTIALS`/`GAS_SCRIPT_ID`/`GAS_DEPLOYMENT_ID` もSecretsに登録すると、以後 `gas/` の変更もmainへのpush/マージで `deploy-gas.yml` が自動デプロイする（README §4.5）。未設定なら手順1の `clasp push` を変更ごとに手動実行する従来運用のまま
5. スマホでURLを開き、ホーム画面に追加

## 14. コーディング方針

- コメントは日本語。初心者の持ち主が後から読んで追える粒度で
- 1ファイル300行以内目安・関数は単一責務
- LLM応答は必ずスキーマ検証してから保存（信用しない）
- 失敗時はユーザーに日本語で「何をどう再試行すべきか」を表示（黙って失敗しない）

## 15. スキルラダー拡張（v2・調整版）

CS教育研究のはしご（**構文 → 読む/トレース → 並べる(Parsons) → 書く → 組む**）を導入する。読む・トレース・EiPEは「書く力」を予測し、それを伸ばす（Lopez & Lister hierarchy／EiPE↔code-writing相関／adaptive Parsons）。インターリービング＋FSRSで段と概念を混ぜる。

**この学習者向けの calibration（重要・元仕様からの調整）:**
- **下の段から**入れる（元仕様の「Stage 4最優先」は採らない）。今は"書く"段でこける段階（スペル・+1・初期値）なので、読む/トレースで実装精度を低負荷に鍛えるのが最優先。
- **「習得」バーは当面 Stage 3（書く=スニペット）**に据える。Stage 4（組む）は後のレベル連動マイルストーン。Stage 1/2 の成功は習得に算入しない。
- Stage 4 は **Pyodideで動くメモリ内ロジック限定**（実ファイル/フォルダ操作は不可）。サイズはレベル連動（最初5〜12行）。

| Stage | 名前 | 状態 |
|---|---|---|
| 0 | ウォームアップ（お手本＋穴埋め=`穴埋め`・新規概念の初回） | **実装済** |
| 1 | 読む（出力予測=`予測` / EiPE=`説明` / 行ごと和訳=`和訳` / 変数トレース表=`トレース`） | **実装済** |
| 2 | 並べる（Parsons=`並べ替え`・distractorなし） | **実装済** |
| 3 | 書く（スニペット） | 既存＝当面の習得バー |
| 4 | 組む（`組む`・白紙＋テスト検証・答えを出さない） | **実装済（基礎習得で自動点火・ゼロトラスト題材）** |

**実装済みの種別と採点（読む/並べる/組む）:**
- `予測`：code_to_readをPyodideで実行→実際の出力と予測を比較（LLM不使用）。習得に非算入(isTrace)。
- `説明`(EiPE)：LLMが寛容採点＋必ず模範の一言。習得に非算入。
- `和訳`：コードを1行ずつ日本語に訳す。LLMが各行を寛容採点＋必ず各行のお手本和訳。習得に非算入（読む力の核・Block Model）。
- `トレース`：1行ずつ各変数の値を表に埋める。フロントが Pyodide の `sys.settrace` で真の変数推移を取得し、サーバがセル比較（LLM不使用）。習得に非算入（notional machine を作る）。
- `並べ替え`(Parsons)：↑↓で並べ→実行結果がexpected_outputと一致で正解（LLM不使用）。習得に非算入。distractorなし(`parsons_distractors=FALSE`)。
- `組む`(Stage4)：仕様＋判定テスト(`tests`)＋`function_name`。白紙のエディタ（足場なし §1）。複数テストをPyodideで回しサーバが合否確定。**不正解でも正解コードは出さない**。クリアは習得に算入。`stage4_enabled` が `maybeRestoreSecurityTheme_`（基礎全習得）で自動TRUE＝永久後回しにしない。
- `穴埋め`(Stage0)：新規概念の初回。完成お手本コードの重要部分1〜2か所を `___1___` で空欄化＋`blanks`に答え。埋めて実行→出力一致で正解（LLM不使用）。足場ありなので `hint_used` 扱い＝習得(nohint)には算入しないが「未→練習中」の進行はする。`stage0_enabled`（既定TRUE）。
- 下の段（予測/説明/和訳/トレース/並べ替え）は1セッション1問だけ、`pickReadType_` が数で均して交互（インターリービング）。各 `trace_enabled`/`eipe_enabled`/`wayaku_enabled`/`tracetable_enabled`/`parsons_enabled` でON/OFF。Stage0「穴埋め」は新規枠を `decideType_` が差し替える（`stage0_enabled`）。

**Stage 1 実装（予測/トレース）:**
- 新problem `type='予測'`（スキーマ変更なし＝migrate不要）。payloadに `code_to_read`（読む完成コード）を持つ。`expected_output`は答えなのでUIで隠す。
- generate：`config.trace_enabled`（既定TRUE）が真なら、1セッションの練習スロット1つを `予測` にする（インターリービング）。`code_to_read` に概念を使う5〜10行の完成コード＋その厳密な出力を生成。
- 採点：**LLM不使用**。フロントが `code_to_read` をPyodideで実行→実際の出力、ユーザーの予測と正規化比較。grade に `{prediction, actual}` を送り、正誤を記録。
- **トレースは習得（昇級）に算入しない**：`updateConceptAfterAttempt_` は `isTrace` でFSRSスケジュールだけ更新し、`nohint_streak`/`nohint_correct_days`/状態遷移には触れない。外しても**リベンジに積まない・mistakesを増やさない**（種別がちぐはぐになるため）。ストリーク・履歴・FSRS間隔にだけ効く。

**フェーズ計画:** Phase 1=Stage 1（済）→ Phase 2=Stage 2(Parsons) → Phase 3=Stage 0(ワークトエグザンプル＋フェード) → Phase 4=Stage 4(組む・レベル連動)。各フェーズは migrate非破壊・既存を壊さない・答えを出さない原則を厳守。

## 16. 学習キャプチャ（本で読む→捕捉→FSRS復習キュー→検証済み問題）

「本で新項目を読む→その場で分かる→キューに入る経路が無く忘れる」という、中心ループの欠けた配線を埋める機能（アクセサリではなく根幹）。忘却対策は再読でもマーカーでもなく**間隔をあけた想起(spaced retrieval)**だけ＝FSRSは既に載っているので、足りない**入口**を足す。自由欄に「学んだことを自分の言葉で書く」行為自体が**自己説明(generation effect)**で定着を上げる（記録と学習の二役）。

### 16.1 絶対原則 — §2 検証ゲート（安全性の全て）
**Geminiが生成した問題は、表示・保存の前に必ずPyodideで実行し正解を確定する。** 学習者は今日習ったばかりで、正解が間違っていても見抜けない＝未検証の問題を出すと「間違いを正しいものとして」覚える最悪の事故になる。Stage1で確立した「**Pyodideを正とし、答えにLLMを使わない**」原則を**生成側にも適用**する。Geminiは問題を提案するだけ、真偽はPyodideが決める。コードはブラウザのPyodideでしか実行できないので、検証は**フロントが担う**：
- `captureCandidates`（GAS）= Geminiで“たね”（完成コード）を作る・**未検証**・problemsには保存しない
- フロントが各コードを `Runner.run` で実行 → タイムアウト無し・Traceback無し・出力が空でない → **実stdoutを正解(expected_output)に確定**。落ちたら破棄→最大 `capture_regen_retries` 回再生成→それでもダメならスキップ（ユーザーをブロックしない §11）
- `commitProblems`（GAS）= 検証済みだけ `verified='TRUE', source='capture'` で保存
- 生成コードの制約：`input()`・乱数・日時・ファイル/ネット/OS依存を禁止（`captureCodeAllowed_` がGAS側でも多層で弾く）。決定的＝Pyodideで検証可能にするため

### 16.2 v1の範囲（予測型のみ）
v1の問題タイプは**「予測（Stage1: 出力予測/読む段）」のみ**。理由：(a)読んだコードの出力を当てる練習は本で読んだ直後の定着に最適（§15の下段＝書く力を予測する）、(b)検証が最も安全（実行した実stdoutがそのまま正解＝模範解答が要らない）、(c)既存の `予測` 描画・採点を100%再利用。**「組む（白紙で書く）」型の捕捉**はこの予測経路が実機で確認できてから次段で足す（参照解＋テスト検証が要るため）。

### 16.3 概念の扱い（§5 名寄せ・recurrence）
- **名寄せ**（`matchConcepts_`・LLM不使用・決定的）：入力名を既存concepts（name/concept_id/aliases）と突き合わせ候補を提示。**最終決定はユーザーの1タップ**（「既存に紐づけ／新規作成」）。同義概念の二重登録を防ぐ＝習得モデルは概念単位が命。既存に紐づけた時は今回の言い方を `aliases` に足す
- **新規概念**：`state=練習中, source=capture, due=今日`、FSRSカードは初回採点で初期化（`loadCard_` が reps=0 で createEmptyCard）。**first-classの繰り返しカード**として復習に乗る（「一門だけやって終わり」にしない＝ユーザー要件）
- **§2を破らないための隔離**：capture概念は**通常の（未検証）generateから除外**（`pickSlots_` が `source==='capture'` を弾く）。出題は必ず検証パイプライン経由。recurrenceは「検証済みバッチの消費」＋FSRSの due 到来で棚に出る「🔁もう一度作る」（検証ループを再実行）で回す

### 16.4 データ構造（migrate非破壊・§8）
- 新タブ `learning_log`：log_id / timestamp / raw_text / self_explanation / source_ref / concept_id / generated_problem_ids
- `concepts` に列追加：`source`（空=シード, 'capture'）/ `aliases`（名寄せ別名）
- `problems` に列追加：`verified`（'TRUE'=Pyodide検証済み）/ `source`（'capture'）
- `config`：capture_enabled / capture_predict_count / capture_build_count / capture_regen_retries / capture_immediate_count。**`migrate()` が `ensureConfigDefaults_` で既存シートに不足キーを足す**（既存値は上書きしない）
- ⚠️**新機能なので導入後に GASエディタで `migrate()` を1回**（learning_logタブ・新列・新configキーを足す）。未実行でも概念登録は止めないが、機能を完全に使うには migrate 必須

### 16.5 受け入れ基準（§11該当分）
未検証の生成問題が一切表示されない／予測はPyodideの実stdoutを正解にしている／禁止要素混入コードは破棄／破棄→再生成→スキップでブロックされない／名寄せで同義概念が二重登録されない／捕捉概念がFSRSキューに乗り後日出題される／日次予算到達時も**捕捉とFSRS登録は動く**（生成だけ保留）／既存(Stage1/ヒント/履歴/下書き/解放ツール)がデグレしない／**Notion非連携**（dojo内で完結）

## 17. ゼロトラスト道場（NIST SP 800-207 → 「書ける」へ）

利用者の人生目標「NIST SP 800-207 を完全理解 → それで就職 → 年収を上げる」をアプリの北極星として常設する（`docs/zt.js`・フロント自己完結・バックエンド不要・localStorageのみ）。**本命は「ゼロトラストを取り入れたコードを書けるようになる」**ことで、暗記や進路情報はそれを支える背景。

- **🛠 書く（本命・コード演習）**：deny-by-default → fail-closed → ポリシーエンジン(PE) → 毎リクエスト検証 → トークン発行(PA) → 動的ロック → 改ざん検知(hashlib) → **ミニ・ゼロトラストゲート(PEP最小実装＝卒業制作)** の8段の階段。各段は自分でPythonを書き、ブラウザのPyodideでテスト判定（**答えは出さない** §1/§11）。前を解くと次が開く。**全課題は python3 で実行検証済み**＝間違った課題を出さない（§2の精神）。
- **📖 学ぶ**：800-207を分解した地図（7原則 / PE・PA・PEP / トラストアルゴリズム / 配備モデル / 脅威 / CISA ZTMM 5本柱 / DoD 7本柱 / SDP）。各項目に「Pythonでどう実装するか」を併記＝理論とコードを接続。
- **🎯 思い出す**：上の知識を間隔反復で想起するリコール・クイズ（Leitner・localStorage）。
- **💼 進路**：資格（本命=CCZT）・職種・年収の目安（動機の可視化 §11）。

事実は**手書きで固定した権威コンテンツ**にしてLLMに事実を作らせない（§2を概念にも適用）。将来の発展：この8段をサーバ側 problems/FSRS に正式に載せ、卒業制作 `capstone_zt` と進捗連動させる（§10/§11）。

## 18. 習慣化メカニズム（§11 Phase2 の実装）と転移の橋

2026年再監査（習慣科学・転移研究）を受けて実装した2本柱：

- **❄️ ストリークフリーズ＋週間ゴール**（`gas/streak.js`・純関数・Nodeテストあり）：欠けた日は**週1回まで自動で身代わり**（フリーズの連発は不可＝身代わり日の前日は活動日必須）。あわせて「今週 n/`weekly_goal_days`日」を表示（毎日でなく**週5日でOK**＝切れても週目標が生きる二重の赦し）。状態は持たず attempts から毎回決定的に再計算（ズレが構造的に起きない）。getToday の summary が `streak_freeze_used` / `week_days` / `weekly_goal` / `build_day` を返す。
- **🏗 週1ビルド日→卒業制作を実GitHubリポジトリへ**（`docs/zt.js` の「制作」タブ）：`build_day`（既定6=土曜）にホームへバナー。道場の8段と対応する**9歩のロードマップ**で卒業制作 zt-gate を本物のリポジトリとして構築（第0歩=repo作成 → 門番/テスト/PE分離/毎回検証/secretsトークン/ログ+ロック/改ざん検知 → README=800-207対応表で公開）。**自分が道場で書いたコードを自分の手で移植**＝答えを渡さず再構築が復習になる。狙いはドリル→実物の転移と就活ポートフォリオ。APIヒントは python3 検証済み。進捗は localStorage（コードの正はGitHub側）。

config追加: `weekly_goal_days`(5) / `build_day`(6)。**フォールバック付きで読むため migrate 未実行でも動く**（セルを手で変えたい場合のみ migrate 推奨）。

## 19. 応答速度（§5 競合制御の改定）と毎朝の自動プリ生成

- **§5改定：LLM呼び出し系はロックを取らない**。以前は全actionを1本のScriptLockで直列化しており、LLM応答（10〜30秒）の間じゅう他の操作が「別の処理が実行中」で弾かれていた。`hint` / `ask` / `captureCandidates` は採番・FSRS・問題statusを書かないためロック不要（budgetカウンタは最悪1回の数え漏れ、asks追記はappendRowが行単位で安全）。`grade` はLLM解説を済ませた後の **`finalizeAttempt_` 内部だけ**短くロックする。採番がある `generate` / `commitProblems` と他の書き込み系は従来どおり直列化。
- **毎朝の自動プリ生成**（`gas/pregen.js`・§11 P1）：GASエディタで `setupMorningTrigger` を1回実行すると、毎朝 `pregen_hour`（既定6）時台に未回答0の時だけ自動生成。解き残しがある朝は積まない（山にしない）。失敗しても手動[問題を作る]は従来どおり。**`appsscript.json` に script.scriptapp スコープを追加**（トリガー作成に必要な最小権限 §9）。
