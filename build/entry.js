// ts-fsrs の全エクスポートを 1 つのグローバルオブジェクトにまとめる入口ファイル。
// esbuild が IIFE 形式で gas/fsrs.bundle.js に変換し、GAS のグローバル変数
// `FSRS` として読めるようにする（GAS はモジュールを使えないため）。
export * from "ts-fsrs";
