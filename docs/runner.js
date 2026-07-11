// =====================================================================
// runner.js — Worker の管理と安全装置（§8-4）。
// ・初回[実行]タップ時に遅延ロード（Pyodideは重いので先読みしない）
// ・実行開始から5秒でタイムアウト → Workerをterminateして作り直す
//   （whileの無限ループを書いてもUIは固まらない、が受け入れ基準）
// =====================================================================

const Runner = {
  worker: null,
  busy: false,
  TIMEOUT_MS: 5000,

  // code を実行して {stdout, stderr, timeout} を返す。失敗も日本語messageで返す
  run(code, onStatus) {
    return new Promise((resolve) => {
      if (this.busy) {
        resolve({ error: '前の実行が終わっていません。少し待ってからもう一度押してください' });
        return;
      }
      // input() はPyodideでは止まってしまうため実行前に検知して案内（§8-4）
      if (/\binput\s*\(/.test(code)) {
        resolve({ error: 'このアプリでは input() は使えません。値は引数や変数で渡してください' });
        return;
      }
      this.busy = true;
      if (!this.worker) this.worker = new Worker('worker.js');
      const worker = this.worker;
      let timer = null;

      const finish = (result) => {
        if (timer) clearTimeout(timer);
        worker.onmessage = null;
        this.busy = false;
        resolve(result);
      };

      worker.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === 'loading') {
          onStatus('Python起動中…（初回は10秒ほどかかります）');
        } else if (msg.type === 'started') {
          onStatus('実行中…');
          // 実行が始まってから5秒のタイムアウト（ロード時間は含めない）
          timer = setTimeout(() => {
            worker.terminate();
            this.worker = null; // 次回実行用に作り直す
            finish({
              timeout: true,
              error: '実行が5秒を超えました。無限ループ（whileの条件が常にTrueなど）かもしれません。条件を見直してみよう'
            });
          }, this.TIMEOUT_MS);
        } else if (msg.type === 'result') {
          finish({ stdout: msg.stdout, stderr: msg.stderr });
        } else if (msg.type === 'error') {
          this.worker = null;
          worker.terminate();
          finish({ error: msg.message });
        }
      };

      worker.postMessage({ type: 'run', code });
    });
  },

  // 全角記号の検出。スマホのキーボードが `"`→`”`、`(`→`（` 等に自動変換すると
  // Python が「unterminated string literal」等の分かりにくいエラーを出す（初心者殺しの罠）。
  // スマート引用符・全角括弧・全角コロン・全角スペースだけを対象にする
  // （文字列の中の日本語「許可」等は誤検知しない）。問題があれば日本語の警告、無ければ null。
  checkInput(code) {
    var bad = [];
    if (/[“”]/.test(code)) bad.push('“ ” → 半角の "');
    if (/[‘’]/.test(code)) bad.push("‘ ’ → 半角の '");
    if (/[（）]/.test(code)) bad.push('（ ） → 半角の ( )');
    if (/：/.test(code)) bad.push('： → 半角の :');
    if (/　/.test(code)) bad.push('全角スペース → 半角スペース');
    if (!bad.length) return null;
    return '全角の記号が混じっています（スマホのキーボードが自動変換したのかも）。次を直すと動きます:\n・' + bad.join('\n・');
  },

  // 上記の全角記号を半角へ置換して返す（ワンタップ自動修正用）
  fixInput(code) {
    return String(code)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/：/g, ':')
      .replace(/　/g, ' ');
  },

  // テスト判定で「関数の呼び出し結果だけ」を取り出すためのマーカー。
  // 学習者が動作確認用に自分で print(...) を書いていても、その出力に惑わされないため
  // （マーカーの後＝そのテスト呼び出しの出力だけを正解と比較する）。
  RUN_MARKER: '___DOJO_TEST_MARK___',

  // stdout からマーカー以降（＝テスト呼び出しの出力だけ）を取り出す純関数。テスト可能
  afterMarker(stdout) {
    if (typeof stdout !== 'string') return stdout;
    var i = stdout.lastIndexOf(this.RUN_MARKER);
    if (i < 0) return stdout; // マーカーが無い（エラーで到達しなかった等）はそのまま
    return stdout.slice(i + this.RUN_MARKER.length).replace(/^\r?\n/, '');
  },

  // ユーザーのコードを実行し、call（例 'gate("x")'）の出力【だけ】を返す。
  // 手順: コード → マーカーをprint → print(call)。学習者の余分なprintはマーカーの前に来るので混ざらない。
  // 戻り値は run と同じ形 { stdout, stderr, timeout, error }（stdout は切り出し済み）
  runCall: function (code, call, onStatus) {
    var self = this;
    return this.run(code + '\nprint("' + this.RUN_MARKER + '")\nprint(' + call + ')', onStatus)
      .then(function (r) {
        if (r && typeof r.stdout === 'string') {
          return { stdout: self.afterMarker(r.stdout), stderr: r.stderr, timeout: r.timeout, error: r.error };
        }
        return r;
      });
  }
};

// Nodeスモークテスト用（ブラウザでは無視される）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Runner: Runner };
}
