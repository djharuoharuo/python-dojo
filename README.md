# Python道場（python-dojo）

スマホ完結型・自己適応Python学習アプリ。月額¥0で動く。

- **フロント**: GitHub Pages のPWA（vanilla HTML/CSS/JS・ビルド不要）。Pythonの実行はブラウザ内のPyodide
- **バックエンド**: Google Apps Script（GAS）のWeb API。出題・採点にGemini APIを使用
- **データ**: Googleスプレッドシート1つ（正誤・ミス傾向・FSRS復習スケジュール）

設計の全体像は [CLAUDE.md](CLAUDE.md) を参照。

---

## セットアップ手順（初回のみ・PCで約30分）

### 1. GASプロジェクトを作って紐付ける

```bash
npm install -g @google/clasp
clasp login                       # ブラウザでGoogleアカウント認証
cd gas
clasp create --type standalone --title python-dojo
clasp push                        # gas/ のソースをアップロード
```

> `clasp push` の前に、初回は https://script.google.com/home/usersettings で
> 「Google Apps Script API」をオンにしておくこと。

### 2. シートの自動作成（setup を1回実行）

1. `clasp open` でGASエディタを開く
2. 関数一覧から **`setup`** を選んで実行（初回は権限の承認ダイアログが出る）
3. ログに出るスプレッドシートURLを控える（タブとシードデータが自動投入されている）

### 3. キーとトークンを設定してデプロイ

1. GASエディタ → プロジェクトの設定 → **スクリプト プロパティ** に2つ追加:
   - `GEMINI_API_KEY` … [Google AI Studio](https://aistudio.google.com/apikey) で無料発行
   - `APP_TOKEN` … 長いランダム文字列（例: `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` で生成）
2. デプロイ → 新しいデプロイ → 種類「**ウェブアプリ**」
   - 実行ユーザー: **自分**
   - アクセスできるユーザー: **全員**
3. 発行された **ウェブアプリURL**（`https://script.google.com/macros/s/…/exec`）を控える

### 4. GitHub Pages を設定

1. リポジトリの Settings → **Pages** → Source を「**GitHub Actions**」に変更
2. Settings → Secrets and variables → **Actions** に2つ登録:
   - `GAS_URL` … 手順3のウェブアプリURL
   - `APP_TOKEN` … 手順3と同じ値
3. mainブランチにpushすると `deploy.yml` が `docs/config.js` を生成してPagesへ自動デプロイ

> **重要**: `config.js` はリポジトリに存在しない。Actionsがデプロイのたびに
> Secretsから生成する方式（コミット履歴含め、秘密は一切リポジトリに置かない）。

### 5. スマホに入れる

1. スマホのChromeで `https://<ユーザー名>.github.io/python-dojo/` を開く
2. メニュー →「ホーム画面に追加」
3. ホームの[問題を作る]をタップ → 解く → [▶ 実行] → [採点する]、で学習開始

---

## 日々の使い方

| 操作 | 動き |
|---|---|
| アプリを開く | 今日の問題・ストリーク・「今日のボトルネック」が出る |
| [問題を作る] | 復習1問＋練習中/新規2問を自動生成（弱点・復習期限を自動反映） |
| [▶ 実行] | ブラウザ内でPythonが動く。**圏外でも実行だけは可**（2回目以降） |
| [採点する] | 出力の機械比較で正誤確定。不正解ならまずヒント、[答えを見る]で全解説 |
| ❓ 先生に聞く | 詰まったら自由に質問（or ワンタップでヒント）。AIが**答えは教えず**次の一歩を導く。使うとその問題は「ヒントあり」で記録され、復習が早めに回ってくる |
| 原因1行メモ | 「なぜ間違えたか」を自分の言葉で残す（次の伸びに効く） |
| 📖 これまでの履歴 | ホーム下部のボタン。過去に解いた問題・自分の解答コード・先生にした質問と回答を新しい順に見返せる（タップで展開） |
| 📔 日記に記録 | その日の問題を解き終えると、**Notion日記の当日ページ「python学習」欄に学習内容を自動追記**（解いた問題・正誤・もらったヒント/質問・原因メモ・次に必要なこと）。設定は下記「日記連携」 |

- 無限ループを書いても5秒で自動停止するので、whileも安心して試してOK
- 採点・出題はネット接続が必要（オフライン時はその旨が表示される）

## 日記連携（Notionに学習を自動記録）

「今日の進歩」画面に来ると、その日の学習を **Notionの日記（当日ページの `python学習` セクション）** へ自動で追記する。1日1ブロック（折りたたみトグル）にまとまり、同じ日に何度解いても**古い記録を消して置き換える**ので重複しない。当日ページがまだ無ければ自動で作る。

> サマリ本文は**コードが組み立てる**（LLMは使わない）。Gemini予算を消費せず、固有名詞も含めない。

### 設定（初回のみ）

1. **Notionインテグレーションを作る**: [notion.so/my-integrations](https://www.notion.so/my-integrations) →「New integration」→ 名前を付けて作成 → **Internal Integration Token**（`secret_…` または `ntn_…`）を控える
   - 既存の日記システムとは**別の専用インテグレーション**にする（漏れても被害が日記DBの追記だけに限定される）
2. **日記DBにそのインテグレーションを招待**: 日記データベースを開く → 右上「…」→「コネクト」→ 作ったインテグレーションを追加（これをしないとAPIから見えない）
3. **日記DBのIDを控える**: 日記DBをブラウザで開いたURL `https://www.notion.so/xxxx?v=yyyy` の **`xxxx` の32桁**がデータベースID
4. **GASのスクリプト プロパティに登録**（フロントには置かない）:
   - `NOTION_TOKEN` … 手順1のトークン
   - `NOTION_DIARY_DB_ID` … 手順3のID
5. これで完了。未設定のままでも学習自体は動き、「📔 日記への記録はスキップされました」と表示されるだけ。

> 日記ページのタイトルは `YYYY/M/D` 形式、または `作成日` プロパティで当日を判定する。`python学習` という見出し（heading）があればその直下に、無ければ末尾に追記する。

## モデル名は変わるもの（メンテナンス手順）

Geminiのモデル名は廃止・改名されることがある。本アプリは:

- 週1回自動で `models.list` を照合し、消えたモデルをチェーンから外して画面に通知する
- 呼び出しが429/404/5xxで失敗したら自動で次のモデルに切り替えて通知する

**手動でモデルを変えたい時**は、スプレッドシートの `config` タブで
`model_chain` の1セルを書き換えるだけ（例: `gemini-3-flash,gemini-2.5-flash-lite`）。
コードの変更・再デプロイは不要。

## セキュリティ設計（侵害前提の被害想定）

「決して信頼せず、常に検証する」をこの規模に翻訳して実装している（詳細はCLAUDE.md §9）。

| 何が漏れたら | 被害 | 対処 |
|---|---|---|
| フロント（Pages）のソース | `APP_TOKEN` のみ露出。GeminiキーはGAS内で無事 | 下記「TOKENローテ手順」を即実行 |
| TOKEN悪用でAPI乱用 | LLM呼び出しは日次予算（既定60回）で頭打ち。被害は最大1日分 | TOKENローテ＋必要ならGeminiキーも再発行 |
| スプレッドシート | 学習ログのみ。**個人情報は設計段階で一切入れていない** | 共有設定を確認。実害なし |
| Gemini無料枠の学習利用 | 入力が学習に使われ得る前提で、固有名詞・個人情報を問題文/コードに含めない | 設計で対応済み |

**TOKENローテ手順（5分）**:
1. 新しいランダム文字列を生成
2. GASのスクリプト プロパティ `APP_TOKEN` を新値に更新
3. GitHubの Secrets `APP_TOKEN` も新値に更新 → 空コミットをpushして再デプロイ
4. スマホでアプリを再読み込み（Service Workerが新config.jsを取得）

## 開発メモ

```
docs/   … PWA本体。ビルド不要、pushすれば配信される
gas/    … claspで管理。変更したら gas/ で `clasp push`
build/  … ts-fsrs のバンドル生成（npm install && npm run build → gas/fsrs.bundle.js）
          アイコン再生成は `node make-icons.js`
```

- `gas/fsrs.bundle.js` は生成物だが、clasp pushに必要なのでコミットしている
- フロントを更新したら `docs/sw.js` のキャッシュ名（`dojo-shell-v1` の数字）を上げると全端末に行き渡る
- **データ構造を増やした時**（タブやconfigキーの追加）は、GASエディタで **`migrate()` を1回実行**すると既存のスプレッドシートに不足タブ・設定を安全に足せる（`setup()` と違い既存データは消さない）
- 受け入れ基準・フェーズ計画は CLAUDE.md §12
