# ベースTAB譜エディタ 実装設計書（Phase 1）

## 1. ファイル構成

```
/
├── index.html
├── css/
│   ├── main.css       # アプリ全体のスタイル
│   └── print.css      # 印刷用スタイル（@media print）
└── js/
    ├── app.js         # エントリーポイント・初期化
    ├── model.js       # データクラス定義（Score / Measure / Note）
    ├── store.js       # 状態管理・LocalStorage保存
    ├── renderer.js    # VexFlow描画ロジック
    ├── editor.js      # 編集操作ロジック（カーソル・音符追加・削除）
    ├── ui.js          # 入力パネル・ヘッダーUIの制御
    └── exporter.js    # PNG出力・印刷トリガー
```

---

## 2. データモデル（`model.js`）

```javascript
// 音符の長さ（VexFlow互換のキー）
const DURATION = {
  WHOLE:     'w',
  HALF:      'h',
  QUARTER:   'q',
  EIGHTH:    '8',
  SIXTEENTH: '16',
};

// 奏法記号
const TECHNIQUE = {
  HAMMER_ON:  'H',
  PULL_OFF:   'P',
  SLIDE:      'S',
  BEND:       'B',
  PALM_MUTE:  'PM',
  GHOST:      'X',   // ゴーストノート（×）
};

// 4弦ベース標準チューニング（MIDI音高、低弦から順に）
// E1=28, A1=33, D2=38, G2=43
const STANDARD_BASS_TUNING = [28, 33, 38, 43];
const MAX_FRET = 20;

class Note {
  constructor({
    duration = 'q',
    dotted   = false,
    isRest   = false,
    string   = 0,      // 0=最低弦(E), 3=最高弦(G)
    fret     = 0,
    pitch    = null,   // { name:'E', octave:1 } ← string/fretから自動算出
    techniques = [],   // TECHNIQUE[]
  }) {
    this.duration   = duration;
    this.dotted     = dotted;
    this.isRest     = isRest;
    this.string     = string;
    this.fret       = fret;
    this.pitch      = pitch ?? midiToPitch(STANDARD_BASS_TUNING[string] + fret);
    this.techniques = techniques;
  }
}

class Measure {
  constructor({ timeSignature = { beats: 4, value: 4 }, notes = [] } = {}) {
    this.timeSignature = timeSignature;
    this.notes = notes; // Note[]
  }
}

class Score {
  constructor({ title = '無題', tuning = STANDARD_BASS_TUNING, measures = [] } = {}) {
    this.title   = title;
    this.tuning  = tuning;
    this.measures = measures.length > 0 ? measures : [new Measure()];
  }
}
```

### ピッチ変換ユーティリティ

```javascript
// MIDI音高 → { name, octave }
function midiToPitch(midi) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return { name: names[midi % 12], octave: Math.floor(midi / 12) - 1 };
}

// { name, octave } → VexFlow用キー文字列（例: 'b/2'）
function pitchToVexKey(pitch) {
  return `${pitch.name.toLowerCase().replace('#','#')}/${pitch.octave}`;
}

// 五線譜で指定した音高 → 最適な (string, fret) を返す
function autoAssign(midiPitch, tuning, previousNote = null) {
  const candidates = tuning
    .map((open, strIdx) => ({ string: strIdx, fret: midiPitch - open }))
    .filter(({ fret }) => fret >= 0 && fret <= MAX_FRET);

  if (candidates.length === 0) return null;
  if (!previousNote) return candidates.reduce((a, b) => a.fret <= b.fret ? a : b);

  return candidates.reduce((best, c) =>
    Math.abs(c.fret - previousNote.fret) < Math.abs(best.fret - previousNote.fret) ? c : best
  );
}
```

---

## 3. 状態管理（`store.js`）

```javascript
const STORAGE_KEY = 'bass_tab_score_v1';

const state = {
  score: new Score(),

  cursor: {
    measureIndex: 0,
    beatPosition: 0,   // 小節内の拍位置（0.0 〜 拍子-1）
  },

  selection: {
    measureIndex: -1,
    noteIndex:    -1,  // -1 = 未選択
  },

  input: {
    duration:     'q', // 現在選択中の音符長さ
    pendingFret:  '',  // テンキーで入力中の数字列（最大2桁）
    awaitingFret: false, // 弦タップ後にフレット入力待ちか否か
    targetString: -1,  // タップされた弦番号（フレット入力待ち中）
  },
};

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.score));
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  // JSON → Score インスタンスに復元
  const data = JSON.parse(raw);
  state.score = deserializeScore(data);
}

function dispatch(action) {
  editor.handle(action, state);
  save();
  renderer.render(state.score, state.cursor, state.selection);
  ui.update(state);
}
```

### アクション一覧

| アクション | 内容 |
|---|---|
| `SELECT_DURATION` | 音符長さを変更 |
| `TAP_STRING` | 弦をタップ → `awaitingFret = true`、`targetString` セット |
| `INPUT_FRET_DIGIT` | テンキー数字 → `pendingFret` に追記（最大2桁） |
| `CONFIRM_FRET` | フレット確定 → 音符を小節に追加、カーソル前進 |
| `CLEAR_FRET` | 入力中フレットを消去 |
| `SELECT_NOTE` | 既存音符をタップして選択 |
| `DELETE_NOTE` | 選択中の音符を削除 |
| `ADD_TECHNIQUE` | 選択中の音符に奏法記号を付加/解除 |
| `ADD_MEASURE` | 末尾に小節を追加 |
| `DELETE_MEASURE` | 選択中の小節を削除 |
| `SET_TITLE` | 曲タイトルを変更 |
| `UNDO` | 直前の操作を取り消し（スタック管理） |

---

## 4. 画面レイアウト

```
┌─────────────────────────┐  ← 固定ヘッダー（~50px）
│ [≡] 曲タイトル  [↓][⎙] │     ≡=メニュー ↓=PNG出力 ⎙=印刷
├─────────────────────────┤
│                         │
│  五線譜（ヘ音記号）     │  ← 譜面エリア（縦の約45%）
│  ─ ─ ─ ─ ─ ─ ─ ─     │     五線譜 + TAB を縦に並べ
│                         │     横スクロールで小節を閲覧
│  TAB（4本線）           │     ※両者は同期スクロール
│  5   7H  9   7P        │
│                         │
├─────────────────────────┤
│ ①音符長さ選択           │  ← 入力パネル（縦の約55%）
│  ♩  ♪  ♫  𝅗𝅥  𝅝  ─   │     ① 音符長さ（常時表示）
│ ②フレット入力           │     ② テンキー（awaitingFret時に強調）
│  [7][8][9][⌫]          │     ③ 奏法記号（音符選択時に有効化）
│  [4][5][6][ ]          │
│  [1][2][3][✓]          │
│  [0][  ][ ][ ]         │
│ ③奏法記号               │
│  [H][P][S][B][PM][X]   │
└─────────────────────────┘
```

### CSS ブレークダウン

```css
body { display: flex; flex-direction: column; height: 100dvh; }

#header      { flex: 0 0 50px; }
#score-area  { flex: 1 1 0; overflow-x: auto; overflow-y: hidden; }
#input-panel { flex: 0 0 auto; }  /* コンテンツ高さに合わせる */
```

---

## 5. 操作フロー

### 5-1. 音符の入力（基本フロー）

```
① 入力パネルで音符の長さをタップ（♩/♪/♫ など）
   → state.input.duration を更新、ボタンをハイライト

② TAB譜の弦をタップ（小節内の目的の位置付近をタップ）
   → state.input.awaitingFret = true
   → state.input.targetString = タップした弦番号
   → テンキーエリアをアクティブ表示（枠で強調）

③ テンキーで数字を入力（1〜2桁）
   → state.input.pendingFret に追記
   → テンキー上部にプレビュー表示（例：「12」）

④ [✓] で確定
   → Note を生成してカーソル位置の小節に追加
   → カーソルを次の拍へ前進
   → state.input.pendingFret = ''、awaitingFret = false
   → 再描画
```

### 5-2. 休符の入力

```
① 音符長さを選択
② 入力パネルの [─] ボタン（休符ボタン）をタップ
   → isRest=true の Note を生成してカーソルに挿入
```

### 5-3. 既存音符の編集・削除

```
① TAB譜または五線譜の音符をタップ
   → selection.noteIndex が設定され、音符をハイライト表示

② 入力パネルで操作
   - 長さボタンタップ → 選択音符の長さを変更
   - 奏法記号ボタン → 付加/解除をトグル
   - [⌫] キー → 選択音符を削除
```

### 5-4. 五線譜からの入力（TAB→五線譜 同期）

```
五線譜の任意の音符位置をタップ
   → 音高（半音）を選択するミニパネルを表示
   → 音高確定 → autoAssign() で弦・フレットを決定
   → Note 生成 → 再描画（TABにも即反映）
```

---

## 6. VexFlow 統合方針（`renderer.js`）

### 6-1. 基本セットアップ

```javascript
// CDN経由で読み込み（index.htmlで）
// <script src="https://cdn.jsdelivr.net/npm/vexflow@4/build/cjs/vexflow.js"></script>

const { Renderer, Stave, TabStave, StaveNote, TabNote,
        Voice, Formatter, Beam, GhostNote } = Vex.Flow;
```

### 6-2. レンダリング構造

各小節を以下の構造で描画する。五線譜とTAB譜は縦に配置し、X位置を揃えて同期スクロールさせる。

```
y=0      ┌─── Stave（五線譜, height≈90px）───┐
         │   StaveNote × n                 │
y=110    ├─── TabStave（TAB, height≈90px） ──┤
         │   TabNote × n                   │
y=200    └─────────────────────────────────┘
         ↑
         この縦セットが小節ごとに横に並ぶ
```

### 6-3. 1小節の描画コード（概略）

```javascript
function renderMeasure(ctx, measure, x, isFirst) {
  const Y_STAFF = 20;
  const Y_TAB   = 130;
  const width   = calcMeasureWidth(measure);

  // 五線譜
  const stave = new Stave(x, Y_STAFF, width);
  if (isFirst) stave.addClef('bass').addTimeSignature('4/4');
  stave.setContext(ctx).draw();

  // TAB譜
  const tabStave = new TabStave(x, Y_TAB, width);
  if (isFirst) tabStave.addTabGlyph();
  tabStave.setContext(ctx).draw();

  // 音符変換
  const staveNotes = measure.notes.map(noteToStaveNote);
  const tabNotes   = measure.notes.map(noteToTabNote);

  // Voice・フォーマット・描画
  const voice    = new Voice({ num_beats: 4, beat_value: 4 }).addTickables(staveNotes);
  const tabVoice = new Voice({ num_beats: 4, beat_value: 4 }).addTickables(tabNotes);

  new Formatter()
    .joinVoices([voice])
    .joinVoices([tabVoice])
    .format([voice, tabVoice], width - 20);

  voice.draw(ctx, stave);
  tabVoice.draw(ctx, tabStave);

  // 連桁
  Beam.generateBeams(staveNotes.filter(n => !n.isRest())).forEach(b => b.setContext(ctx).draw());
}
```

### 6-4. 奏法記号の描画（TAB専用）

| 記号 | VexFlow API |
|---|---|
| H（ハンマリング） | `TabTie` を隣接する2音符間に追加 |
| P（プリング） | `TabTie`（同上、下向き） |
| S（スライド） | `TabSlide` |
| B（ベンド） | `tabNote.addModifier(new Bend('Full'))` |
| PM（パームミュート） | `Annotation`でテキスト「PM」を追加 |
| X（ゴーストノート） | `TabNote` の `fret` を `'x'` に設定 |

### 6-5. カーソル・選択の表示

VexFlowのSVG要素の上に半透明の`<rect>`をオーバーレイしてカーソル位置を示す。  
音符選択時はハイライト色の`<rect>`を音符のX位置に重ねる。  
（VexFlowのSVG要素は`getBBox()`でXY座標を取得できる）

---

## 7. エクスポート実装（`exporter.js`）

### 7-1. PNG出力

```javascript
async function exportPNG(svgElement) {
  const svgData   = new XMLSerializer().serializeToString(svgElement);
  const svgBlob   = new Blob([svgData], { type: 'image/svg+xml' });
  const svgUrl    = URL.createObjectURL(svgBlob);

  const img = await loadImage(svgUrl);
  const canvas  = document.createElement('canvas');
  canvas.width  = svgElement.viewBox.baseVal.width  * 2; // Retina対応
  canvas.height = svgElement.viewBox.baseVal.height * 2;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${score.title}.png`;
    a.click();
  });
  URL.revokeObjectURL(svgUrl);
}
```

### 7-2. 印刷（→ PDF）

```javascript
function triggerPrint() {
  window.print(); // print.css で #score-area のみ表示
}
```

`print.css`:
```css
@media print {
  #header, #input-panel { display: none; }
  #score-area { overflow: visible; width: 100%; }
}
```

---

## 8. 実装順序（推奨）

以下の順で段階的に動作確認しながら進める。

| Step | 内容 | 確認ポイント |
|---|---|---|
| 1 | データモデル＋ストア | コンソールで音符の追加・JSON保存ができる |
| 2 | VexFlow基本描画 | ダミーデータで五線譜＋TABが画面に表示される |
| 3 | レイアウト（HTML/CSS） | 3分割が正しく機能する、スクロール動作 |
| 4 | 入力パネルUI | 長さ選択・テンキー・奏法ボタンの表示と状態ハイライト |
| 5 | 音符入力フロー | 長さ選択→弦タップ→フレット入力→音符が表示される |
| 6 | 既存音符の選択・削除・編集 | タップで選択、操作が反映される |
| 7 | 五線譜からの入力（双方向同期） | 五線譜タップ→TABに反映 |
| 8 | 奏法記号の付加・描画 | H/P/S/B等がTABに正しく表示される |
| 9 | LocalStorage自動保存 | リロード後にデータが復元される |
| 10 | PNG出力・印刷 | 出力結果を確認 |
