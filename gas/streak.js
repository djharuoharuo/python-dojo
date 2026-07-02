// =====================================================================
// streak.js — ストリーク計算（❄️フリーズ＋週間ゴール §11 Phase2）。
// 「1日切れたら全部やめる」完璧主義離脱を防ぐ赦しの設計：
//   ・欠けた日は【週1回まで自動で身代わり（フリーズ）】＝ストリークが切れない
//   ・フリーズの連発は不可（身代わりの日の前日は必ず活動日であること）
//   ・あわせて「今週 n/週間ゴール日」を返す（切れても週目標が生きる二重の赦し）
// 状態は持たない＝attempts の日付から毎回決定的に再計算する（ズレが構造的に起きない）。
// 純関数（GAS API不使用）＝Nodeスモークテストでそのまま検証できる。
// =====================================================================

// 'yyyy-MM-dd' に日数を足す（負も可）
function streakAddDays_(dateStr, n) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

// その日の属する週の月曜日（週の一意キーとして使う）
function mondayOf_(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  var back = (d.getDay() + 6) % 7; // 月=0, …, 日=6
  return streakAddDays_(dateStr, -back);
}

// dayList: 活動した日（'yyyy-MM-dd'）の配列 / today: 今日 / weeklyGoal: 週の目標日数
// 戻り値: { streak, week_days, weekly_goal, freeze_used_this_week }
function streakInfo_(dayList, today, weeklyGoal) {
  var days = {};
  (dayList || []).forEach(function (d) { if (d) days[String(d).slice(0, 10)] = true; });

  // --- 今週の活動日数（月曜〜今日） ---
  var weekStart = mondayOf_(today);
  var weekDays = 0;
  for (var d = weekStart; d <= today; d = streakAddDays_(d, 1)) {
    if (days[d]) weekDays++;
  }

  // --- ストリーク（フリーズつき） ---
  var streak = 0;
  var freezeByWeek = {};      // 週（月曜キー）ごとに1回まで
  var freezeUsedThisWeek = false;
  var cur = today;
  // 今日まだ解いていなくてもストリークは昨日まで生きている扱い（既存仕様を踏襲・フリーズは消費しない）
  if (!days[cur]) cur = streakAddDays_(cur, -1);

  while (true) {
    if (days[cur]) { streak++; cur = streakAddDays_(cur, -1); continue; }
    // 欠けた日：その週のフリーズが未使用で、かつ前日（より古い側）が活動日なら身代わりで継続。
    // 「前日が活動日」条件＝フリーズの連発（2日以上サボっても生きる）を構造的に防ぐ
    var w = mondayOf_(cur);
    var prev = streakAddDays_(cur, -1);
    if (streak > 0 || cur === streakAddDays_(today, -1)) { // 進行中 or 昨日のみ（未来を凍らせない）
      if (!freezeByWeek[w] && days[prev]) {
        freezeByWeek[w] = true;
        if (w === weekStart) freezeUsedThisWeek = true;
        cur = prev;
        continue;
      }
    }
    break;
  }

  return {
    streak: streak,
    week_days: weekDays,
    weekly_goal: Number(weeklyGoal) > 0 ? Number(weeklyGoal) : 5,
    freeze_used_this_week: freezeUsedThisWeek
  };
}

// Nodeスモークテスト用（GAS/ブラウザでは無視される）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { streakInfo_: streakInfo_, mondayOf_: mondayOf_, streakAddDays_: streakAddDays_ };
}
