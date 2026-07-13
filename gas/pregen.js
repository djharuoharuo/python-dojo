// =====================================================================
// pregen.js — 毎朝の自動プリ生成（§11 P1: 習慣の合図・摩擦ゼロ）。
// 朝の時間トリガーで「今日の問題」を先に作っておく＝アプリを開いた瞬間に
// 問題が待っている状態にする（生成の30秒待ちを体感ゼロにする）。
//
// 導入手順（1回だけ・GASエディタで）:
//   1. 関数一覧から setupMorningTrigger を選んで実行
//   2. 権限の承認ダイアログが出たら許可（トリガー作成の権限 script.scriptapp が必要）
//   → 以後、毎朝 config.pregen_hour 時台（既定6時台）に自動で問題が用意される
// 何時に変えたい時は config の pregen_hour を書き換えて setupMorningTrigger を再実行。
// =====================================================================

// 時間トリガーを設定する（GASエディタから1回実行。再実行すると張り直し＝重複しない）
function setupMorningTrigger() {
  var hour = Number(getConf_('pregen_hour', 6));
  // 既存の同トリガーを消してから作る（何度実行しても1本だけ）
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'morningPregenerate') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('morningPregenerate').timeBased().everyDays(1).atHour(hour).create();
  Logger.log('毎朝 ' + hour + '時台の自動プリ生成を設定しました（変更は config.pregen_hour → 再実行）');
}

// トリガー本体：未回答が無い朝だけ、その日の問題を作っておく。
// 失敗しても学習は止めない（開いた時に従来どおり手動[問題を作る]ができる）
function morningPregenerate() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60 * 1000)) return; // 何かが実行中の朝はスキップ（次の朝がある）
  try {
    var unanswered = readRows_('problems').filter(function (p) { return p.status === '未回答'; }).length;
    if (unanswered > 0) return; // 解き残しがある日は積まない（山にしない＝赦しの設計）
    actionGenerate_({});
  } catch (e) {
    // 朝のプリ生成は補助。失敗は黙って見送り、次の朝また試す
  } finally {
    lock.releaseLock();
  }
}
