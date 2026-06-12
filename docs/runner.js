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
  }
};
