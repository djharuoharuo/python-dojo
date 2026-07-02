// =====================================================================
// streak.test.js — ストリーク（❄️フリーズ＋週間ゴール）の純関数テスト。
// 実行: node tests/streak.test.js
// =====================================================================
const assert = require('assert');
const { streakInfo_, mondayOf_, streakAddDays_ } = require('../gas/streak.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.error('  NG  ' + name + '\n      ' + e.message); }
}

// 2026-07-01 は水曜日（週の月曜=2026-06-29）
const TODAY = '2026-07-01';

t('日付ヘルパー: addDays / mondayOf', () => {
  assert.strictEqual(streakAddDays_('2026-07-01', -1), '2026-06-30');
  assert.strictEqual(streakAddDays_('2026-07-01', 1), '2026-07-02');
  assert.strictEqual(mondayOf_('2026-07-01'), '2026-06-29'); // 水→その週の月曜
  assert.strictEqual(mondayOf_('2026-06-29'), '2026-06-29'); // 月曜自身
  assert.strictEqual(mondayOf_('2026-06-28'), '2026-06-22'); // 日曜は前週扱いでなく同週の月曜（月起点）
});

t('連続3日 → streak=3', () => {
  const r = streakInfo_(['2026-06-29', '2026-06-30', '2026-07-01'], TODAY, 5);
  assert.strictEqual(r.streak, 3);
  assert.strictEqual(r.freeze_used_this_week, false);
});

t('今日まだ解いていなくても昨日から生きている（猶予・フリーズ消費なし）', () => {
  const r = streakInfo_(['2026-06-29', '2026-06-30'], TODAY, 5);
  assert.strictEqual(r.streak, 2);
  assert.strictEqual(r.freeze_used_this_week, false);
});

t('❄️ 1日欠けても週1フリーズで生き残る', () => {
  // 6/28(日),6/29(月) 活動 → 6/30(火) 欠け → 7/1(水) 活動
  const r = streakInfo_(['2026-06-28', '2026-06-29', '2026-07-01'], TODAY, 5);
  assert.strictEqual(r.streak, 3); // 凍った日はカウントせず、前後の活動日はつながる
  assert.strictEqual(r.freeze_used_this_week, true); // 6/30 は今週
});

t('2日連続で欠けたら切れる（フリーズの連発は不可）', () => {
  const r = streakInfo_(['2026-06-27', '2026-06-28', '2026-07-01'], TODAY, 5);
  assert.strictEqual(r.streak, 1); // 7/1 のみ（6/29,6/30 の2連休は救えない）
});

t('同じ週で2回欠けたら1回分しか救えない', () => {
  // 週内: 月活動・火欠け・水活動・木欠け・金活動。
  const days = ['2026-06-29', '2026-07-01']; // 水曜時点: 火(6/30)凍結でつながり2
  const r1 = streakInfo_(days, '2026-07-01', 5);
  assert.strictEqual(r1.streak, 2);
  // 金曜時点: 週1回のフリーズは直近の欠け(木)に使われ、2つ目の欠け(火)で切れる → 水+金の2
  const r2 = streakInfo_(days.concat(['2026-07-03']), '2026-07-03', 5);
  assert.strictEqual(r2.streak, 2);
  assert.strictEqual(r2.freeze_used_this_week, true);
});

t('別々の週なら各週1回ずつ凍結できる', () => {
  // 先週水(6/24)活動→木(6/25)欠け(先週の凍結)→金土日(6/26-28)活動→
  // 月(6/29)欠け(今週の凍結)→火水(6/30,7/1)活動
  const days = ['2026-06-24', '2026-06-26', '2026-06-27', '2026-06-28', '2026-06-30', '2026-07-01'];
  const r = streakInfo_(days, TODAY, 5);
  assert.strictEqual(r.streak, 6);
});

t('昨日欠け（今日未活動）でも前日活動ならフリーズで生きる', () => {
  // 6/29(月)活動 → 6/30(火)欠け → 7/1(水)今日まだ → 猶予で6/30へ→凍結→6/29カウント
  const r = streakInfo_(['2026-06-28', '2026-06-29'], TODAY, 5);
  assert.strictEqual(r.streak, 2);
});

t('週間ゴール: 今週の活動日数（月〜今日）を数える', () => {
  const r = streakInfo_(['2026-06-28', '2026-06-29', '2026-07-01'], TODAY, 5);
  assert.strictEqual(r.week_days, 2); // 6/29(月)と7/1(水)。6/28(日)は先週
  assert.strictEqual(r.weekly_goal, 5);
});

t('活動ゼロ → streak=0・週0日', () => {
  const r = streakInfo_([], TODAY, 5);
  assert.strictEqual(r.streak, 0);
  assert.strictEqual(r.week_days, 0);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
