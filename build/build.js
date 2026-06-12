// ts-fsrs を GAS（V8ランタイム・モジュール不可）で使える単一ファイルに変換する。
// 実行方法: build/ ディレクトリで `npm install && npm run build`
// 出力: ../gas/fsrs.bundle.js（グローバル変数 FSRS にライブラリ全体が入る）
const esbuild = require("esbuild");

esbuild
  .buildSync({
    entryPoints: ["entry.js"],
    bundle: true,
    format: "iife",
    globalName: "FSRS",
    // GAS の V8 は ES2019 相当をサポート。古めに倒して安全側にする
    target: "es2019",
    outfile: "../gas/fsrs.bundle.js",
    banner: {
      js: "/* ts-fsrs バンドル（自動生成）。手で編集しない。再生成は build/README 参照 */\nvar FSRS;",
    },
    // GAS のグローバルに直接代入させるため、var 宣言は banner 側で行う
    minify: false,
    logLevel: "info",
  });
