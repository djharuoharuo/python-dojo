// =====================================================================
// worker.js — Pyodide を動かす Web Worker。
// メインスレッドでは絶対にPythonを実行しない（UIを固めない §8-4）。
// 無限ループ時はメインスレッド側がこのWorkerごと terminate() する。
// =====================================================================

const PYODIDE_VERSION = 'v0.26.4';
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/' + PYODIDE_VERSION + '/full/';

importScripts(PYODIDE_BASE + 'pyodide.js');

// ロードは初回1回だけ。Service Worker がCDN応答をキャッシュするので2回目以降はオフライン可
const pyodideReady = loadPyodide({ indexURL: PYODIDE_BASE });

// stdout/stderr を StringIO で捕まえ、例外は traceback 全文を stderr に流す（§8-4）
const HARNESS = `
import sys, io, json, traceback
_out, _err = io.StringIO(), io.StringIO()
_orig_out, _orig_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _out, _err
try:
    exec(compile(__user_code, "<あなたのコード>", "exec"), {"__name__": "__main__"})
except BaseException:
    traceback.print_exc()
finally:
    sys.stdout, sys.stderr = _orig_out, _orig_err
json.dumps({"stdout": _out.getvalue(), "stderr": _err.getvalue()})
`;

self.onmessage = async (event) => {
  if (event.data.type !== 'run') return;
  try {
    self.postMessage({ type: 'loading' });
    const pyodide = await pyodideReady;
    // ここから先が「実行中」。メインスレッドはこの合図から5秒タイマーを開始する
    self.postMessage({ type: 'started' });
    pyodide.globals.set('__user_code', event.data.code);
    const result = JSON.parse(pyodide.runPython(HARNESS));
    self.postMessage({ type: 'result', stdout: result.stdout, stderr: result.stderr });
  } catch (e) {
    // Pyodide本体のロード失敗など（初回はネット接続が必要）
    self.postMessage({
      type: 'error',
      message: 'Pythonの起動に失敗しました。初回はネット接続が必要です（' + e.message + '）'
    });
  }
};
