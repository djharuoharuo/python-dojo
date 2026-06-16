// =====================================================================
// tools.js — 「実用ツール解放」のカタログ（アイデンティティ報酬 §11）。
// 概念を習得するたびに、実際に使える小さなPythonスクリプトが解放される。
// LLM生成ではなく手書きの実物（読めて・コピーできて・改造できる品質）。
// 解放条件は concept（その概念を習得しているか）で、判定はフロントが行う。
// =====================================================================

const TOOLS = [
  {
    id: 'total_length', concept: 'total', conceptName: 'total累積', category: 'music',
    icon: '🎵', name: 'サンプル合計時間カウンター',
    desc: '各クリップの長さ（秒）を合計して「◯分◯秒」で表示。曲の尺チェックに。',
    how: '主役は total累積（forで足し込む）。clips の数字を自分の曲に書きかえて使う。',
    script: [
      '# クリップの長さ（秒）を合計して mm:ss で表示',
      'clips = [95, 130, 47, 200]  # ← 自分の曲の秒数に書きかえてOK',
      'total = 0',
      'for sec in clips:',
      '    total = total + sec',
      'print(f"合計 {total // 60}分{total % 60}秒")'
    ].join('\n')
  },
  {
    id: 'fail_count', concept: 'for_if', conceptName: 'for+if組合せ', category: 'security',
    icon: '🔐', name: '失敗ログイン集計',
    desc: 'ログから「失敗(FAIL)」の回数を数える。不正アクセスの気配を掴む第一歩。',
    how: '主役は for+if。logs を自分のログに差し替えれば実ログでも使える。',
    script: [
      '# ログから「失敗(FAIL)」の回数を数える',
      'logs = ["OK user1", "FAIL user2", "OK user1", "FAIL user2", "FAIL user3"]',
      'fail_count = 0',
      'for line in logs:',
      '    if "FAIL" in line:',
      '        fail_count = fail_count + 1',
      'print(f"失敗ログイン: {fail_count}回")'
    ].join('\n')
  },
  {
    id: 'bpm_ms', concept: 'mod', conceptName: '剰余（%）', category: 'music',
    icon: '🎵', name: 'BPM→1拍の長さ計算',
    desc: 'BPMから1拍のミリ秒を計算。剰余(%)で「ステップが何拍目か」も出す。打ち込みに。',
    how: '主役は 剰余(%)。bpm を変えれば自分のトラックの値が出る。',
    script: [
      '# BPMから1拍の長さ（ミリ秒）と、各ステップの拍位置を出す',
      'bpm = 128',
      'print(f"BPM{bpm} → 1拍 {60000 / bpm:.1f}ミリ秒")',
      'for step in range(8):',
      '    print(f"step{step} は 拍{step % 4}")'
    ].join('\n')
  },
  {
    id: 'top_sample', concept: 'max_search', conceptName: '最大値・最小値探索', category: 'music',
    icon: '🎵', name: '最多再生サンプルを特定',
    desc: '一番多く使った（再生した）サンプルを自分で探す。最多アクセス元IP探しと同じ仕組み。',
    how: '主役は 最大値探索（今の最大を覚えながら回す）。plays/names を差し替えて使う。',
    script: [
      '# 一番大きい数（最大値）を自分で探す＝最多再生のサンプルを特定',
      'plays = [12, 47, 9, 33]',
      'names = ["kick", "snare", "hat", "bass"]',
      'top_i = 0',
      'for i in range(len(plays)):',
      '    if plays[i] > plays[top_i]:',
      '        top_i = i',
      'print(f"最多再生: {names[top_i]}（{plays[top_i]}回）")'
    ].join('\n')
  },
  {
    id: 'setlist', concept: 'str_fstring', conceptName: '文字列・f-string', category: 'music',
    icon: '🎵', name: 'セットリスト整形',
    desc: '曲名リストを番号つきの綺麗なセットリストに整形。ライブやmix公開前に。',
    how: '主役は f-string（体裁を整える）。tracks を自分の曲順にするだけ。',
    script: [
      '# 曲名リストを番号つきセットリストに整形',
      'tracks = ["Intro", "Smoke", "Night Drive", "Outro"]',
      'for i in range(len(tracks)):',
      '    print(f"{i + 1:>2}. {tracks[i]}")'
    ].join('\n')
  },
  {
    id: 'rename', concept: 'list_basic', conceptName: 'list・append・index・slice', category: 'music',
    icon: '🎵', name: 'サンプル名一括リネーム',
    desc: 'サンプル名に通し番号とプレフィックスを一括付与。フォルダ整理が一瞬。',
    how: '主役は list（append で新しい名前を作る）。実ファイルに使う時は os.rename と組む。',
    script: [
      '# サンプル名を一括で整形リネーム（番号つきプレフィックス）',
      'names = ["kick1.wav", "snare2.wav", "hat3.wav"]',
      'renamed = []',
      'for i in range(len(names)):',
      '    renamed.append(f"KB_{i + 1:02d}_{names[i]}")',
      'for n in renamed:',
      '    print(n)'
    ].join('\n')
  },
  {
    id: 'policy', concept: 'dict_basic', conceptName: '辞書', category: 'security',
    icon: '🔐', name: '簡易ポリシーエンジン',
    desc: '「誰に何を許可するか」を辞書で持ち、許可/拒否を判定。ゼロトラストの心臓部。',
    how: '主役は 辞書（許可リスト）。policy を増やせば本物のアクセス制御の土台になる。',
    script: [
      '# 「誰に何を許可するか」を辞書で持ち、判定する',
      'policy = {"haruki": ["read", "write"], "guest": ["read"]}',
      'def can(user, action):',
      '    return action in policy.get(user, [])',
      'print("haruki write:", can("haruki", "write"))  # True',
      'print("guest write:", can("guest", "write"))    # False（許可リストに無い＝拒否）'
    ].join('\n')
  },
  {
    id: 'gate', concept: 'try_except', conceptName: 'エラー処理 try/except（fail closed）', category: 'security',
    icon: '🔐', name: 'fail-closed門番',
    desc: 'エラーが起きたら必ず「拒否」する安全な関数。迷ったら閉じる＝fail closed。',
    how: '主役は try/except。卒業制作のゼロトラスト門番に直結する考え方。',
    script: [
      '# エラーが起きたら必ず「拒否」する安全な関数（fail closed）',
      'def gate(token):',
      '    try:',
      '        if token == "secret123":',
      '            return "許可"',
      '        raise ValueError("不正なトークン")',
      '    except Exception:',
      '        return "拒否（fail closed）"',
      'print(gate("secret123"))',
      'print(gate("???"))'
    ].join('\n')
  },
  {
    id: 'log_anomaly', concept: 'file_io', conceptName: 'ファイル読み書き', category: 'security',
    icon: '🔐', name: 'アクセスログ異常検知',
    desc: '複数行のログから、失敗が多すぎるユーザーを警告。実際の監視の入り口。',
    how: '主役は 複数行テキストの処理（split）。実運用ではファイルを開いて log に読み込む。',
    script: [
      '# ログ（複数行テキスト）から、失敗が多すぎるユーザーを警告する',
      'log = """OK alice',
      'FAIL bob',
      'FAIL bob',
      'FAIL bob',
      'OK alice"""',
      'fails = {}',
      'for line in log.split("\\n"):',
      '    if line.startswith("FAIL"):',
      '        user = line.split(" ")[1]',
      '        fails[user] = fails.get(user, 0) + 1',
      'for user in fails:',
      '    if fails[user] >= 3:',
      '        print(f"⚠️ {user}: 失敗{fails[user]}回（怪しい）")'
    ].join('\n')
  }
];
