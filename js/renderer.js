import { pitchToVexKey } from './model.js';
import { dispatch } from './store.js';

const STAVE_Y     = 10;
const TAB_Y       = 120;
const CANVAS_H    = 230;
const X_MARGIN    = 10;
const NOTE_SLOT_W = 52;
const MEASURE_PAD = 24;
const CLEF_W      = 80;
const NUM_STRINGS  = 4;

// Populated each render(); consumed by the SVG tap handler
let renderedMeasures = [];

export function render(score, cursor, _selection) {
  const V = window.Vex?.Flow;
  if (!V) { console.error('VexFlow not loaded'); return; }

  const container = document.getElementById('score-canvas');
  if (!container) return;

  container.innerHTML = '';
  renderedMeasures = [];

  const { measures } = score;
  const widths = measures.map((m, i) => calcWidth(m, i === 0));
  const totalW  = widths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;

  const renderer = new V.Renderer(container, V.Renderer.Backends.SVG);
  renderer.resize(totalW, CANVAS_H);
  const ctx = renderer.getContext();

  // Cursor highlight: inserted first so stave elements appear on top (SVG z-order)
  const svg = container.querySelector('svg');
  if (svg && cursor.measureIndex >= 0 && cursor.measureIndex < measures.length) {
    let hx = X_MARGIN;
    for (let i = 0; i < cursor.measureIndex; i++) hx += widths[i];
    const hilite = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hilite.setAttribute('x', hx);
    hilite.setAttribute('y', STAVE_Y - 5);
    hilite.setAttribute('width', widths[cursor.measureIndex]);
    hilite.setAttribute('height', CANVAS_H);
    hilite.setAttribute('fill', 'rgba(74, 144, 226, 0.12)');
    hilite.setAttribute('pointer-events', 'none');
    svg.appendChild(hilite);
  }

  let x = X_MARGIN;
  let prevResult = null; // { tabStave, staveNotes, tabNotes } from the previous measure

  measures.forEach((measure, mi) => {
    try {
      const result = renderMeasure(ctx, V, measure, x, widths[mi], mi === 0);
      renderedMeasures.push({ x, width: widths[mi], tabStave: result.tabStave, mi });

      // Draw cross-measure tie from the end of the previous measure into this one
      if (prevResult && measures[mi - 1]) {
        const prevNotes = measures[mi - 1].notes;
        const lastPrev  = prevNotes[prevNotes.length - 1];
        const firstCur  = measure.notes[0];
        if (lastPrev?.tiedToNext && firstCur?.isTied && !lastPrev.isRest && !firstCur.isRest) {
          const sn0 = prevResult.staveNotes[prevResult.staveNotes.length - 1];
          const sn1 = result.staveNotes[0];
          const tn0 = prevResult.tabNotes[prevResult.tabNotes.length - 1];
          const tn1 = result.tabNotes[0];
          drawTie(ctx, V, sn0, sn1, tn0, tn1);
        }
      }
      prevResult = result;
    } catch (err) {
      console.warn(`Measure ${mi} render error:`, err);
      renderedMeasures.push({ x, width: widths[mi], tabStave: null, mi });
      prevResult = null;
    }
    x += widths[mi];
  });

  attachTapHandler(container);
  scrollToCursor(cursor);
}

function scrollToCursor(cursor) {
  const scoreArea = document.getElementById('score-area');
  if (!scoreArea || renderedMeasures.length === 0) return;
  const cm = renderedMeasures[cursor.measureIndex];
  if (!cm) return;
  const areaW = scoreArea.clientWidth;
  const scrollL = scoreArea.scrollLeft;
  if (cm.x < scrollL) {
    scoreArea.scrollLeft = Math.max(0, cm.x - X_MARGIN);
  } else if (cm.x + cm.width > scrollL + areaW) {
    scoreArea.scrollLeft = cm.x + cm.width - areaW + X_MARGIN;
  }
}

function calcWidth(measure, isFirst) {
  const slots = Math.max(1, measure.notes.length);
  return slots * NOTE_SLOT_W + MEASURE_PAD + (isFirst ? CLEF_W : 0);
}

function renderMeasure(ctx, V, measure, x, width, isFirst) {
  const stave = new V.Stave(x, STAVE_Y, width);
  if (isFirst) stave.addClef('bass').addTimeSignature('4/4');
  stave.setContext(ctx).draw();

  const tabStave = new V.TabStave(x, TAB_Y, width, { num_lines: NUM_STRINGS });
  if (isFirst) tabStave.addTabGlyph();
  tabStave.setContext(ctx).draw();

  if (measure.notes.length === 0) return { tabStave, staveNotes: [], tabNotes: [] };

  const staveNotes = measure.notes.map(n => toStaveNote(n, V));
  const tabNotes   = measure.notes.map(n => toTabNote(n, V));

  const { beats, value } = measure.timeSignature;
  const SOFT = V.Voice.Mode?.SOFT ?? 2;

  const sv = new V.Voice({ num_beats: beats, beat_value: value });
  sv.setMode(SOFT);
  sv.addTickables(staveNotes);

  const tv = new V.Voice({ num_beats: beats, beat_value: value });
  tv.setMode(SOFT);
  tv.addTickables(tabNotes);

  const noteW = width - (isFirst ? CLEF_W : MEASURE_PAD / 2) - MEASURE_PAD;

  new V.Formatter()
    .joinVoices([sv])
    .joinVoices([tv])
    .format([sv, tv], Math.max(10, noteW));

  sv.draw(ctx, stave);
  tv.draw(ctx, tabStave);

  V.Beam.generateBeams(staveNotes.filter(n => !n.isRest()))
    .forEach(b => b.setContext(ctx).draw());

  // Draw intra-measure ties
  measure.notes.forEach((note, i) => {
    if (note.tiedToNext && !note.isRest && i + 1 < measure.notes.length && !measure.notes[i + 1].isRest) {
      drawTie(ctx, V, staveNotes[i], staveNotes[i + 1], tabNotes[i], tabNotes[i + 1]);
    }
  });

  return { tabStave, staveNotes, tabNotes };
}

function drawTie(ctx, V, sn0, sn1, tn0, tn1) {
  // ── 五線譜タイ ─────────────────────────────────────────────────────────
  // VexFlow StaveTie を試みて、失敗したら SVG パスで直描画
  let staveTieDrawn = false;
  if (V.StaveTie && sn0 && sn1) {
    try {
      new V.StaveTie({
        first_note: sn0, last_note: sn1,
        first_indices: [0], last_indices: [0],
      }).setContext(ctx).draw();
      staveTieDrawn = true;
    } catch (_) { /* fall through */ }
  }
  if (!staveTieDrawn && sn0 && sn1) {
    // 手動フォールバック: 音符上部をアーチで結ぶ
    try {
      const x1 = sn0.getAbsoluteX() + 4;
      const x2 = sn1.getAbsoluteX() - 4;
      const st  = sn0.getStave();
      const y   = st ? st.getYForLine(2) : STAVE_Y + 25;
      drawSvgArc(x1, x2, y, -14);
    } catch (_) { /* ignore */ }
  }

  // ── TAB タイ ──────────────────────────────────────────────────────────
  // TabNote の string 情報から手動 SVG アークを描画（最も確実）
  if (tn0 && tn1) {
    try {
      const x1 = tn0.getAbsoluteX() + 4;
      const x2 = tn1.getAbsoluteX() - 4;
      if (x1 < x2) {
        // getPositions() は TabNote の API; GhostNote では使わない
        const positions = typeof tn0.getPositions === 'function'
          ? tn0.getPositions()
          : (tn0.positions ?? []);
        if (positions.length > 0) {
          const vexStr  = positions[0].str; // 1-indexed from top
          const tabSt   = tn0.getStave();
          // getYForLine: VexFlow line index は 0 = 最上弦 (str 1)
          const lineY   = tabSt
            ? tabSt.getYForLine(vexStr - 1)
            : TAB_Y + vexStr * 13;
          drawSvgArc(x1, x2, lineY + 4, +12);
        }
      }
    } catch (_) { /* ignore */ }
  }
}

// SVG に二次ベジェ曲線でタイアークを直接描画
function drawSvgArc(x1, x2, y, curvature) {
  const svg = document.querySelector('#score-canvas svg');
  if (!svg || x2 <= x1) return;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${x1},${y} Q ${(x1 + x2) / 2},${y + curvature} ${x2},${y}`);
  path.setAttribute('stroke', '#222');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('fill', 'none');
  svg.appendChild(path);
}

function toStaveNote(note, V) {
  if (note.isRest) {
    return new V.StaveNote({ keys: ['d/3'], duration: `${note.vexDuration}r`, clef: 'bass' });
  }
  const sn = new V.StaveNote({ keys: [pitchToVexKey(note.pitch)], duration: note.vexDuration, clef: 'bass' });
  if (note.pitch.name.includes('#')) sn.addModifier(new V.Accidental('#'));
  return sn;
}

function toTabNote(note, V) {
  if (note.isRest) return new V.GhostNote(note.vexDuration);
  // Our string 0 = E (lowest) maps to VexFlow str NUM_STRINGS (bottom line, 1-indexed from top)
  return new V.TabNote({
    positions: [{ str: NUM_STRINGS - note.string, fret: note.fret }],
    duration: note.vexDuration,
  });
}

function attachTapHandler(container) {
  const svg = container.querySelector('svg');
  if (!svg || renderedMeasures.length === 0) return;

  // iOS Safari does not fire click on SVG elements unless cursor:pointer is set.
  // Set it explicitly so both click and touch events reach the element.
  svg.style.cursor = 'pointer';

  let tapStart = null;

  // Record touch start position to distinguish tap from scroll
  svg.addEventListener('touchstart', (e) => {
    tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  // touchend is reliable on iOS Safari regardless of cursor/clickability rules
  svg.addEventListener('touchend', (e) => {
    if (!tapStart) return;
    const t  = e.changedTouches[0];
    const dx = Math.abs(t.clientX - tapStart.x);
    const dy = Math.abs(t.clientY - tapStart.y);
    tapStart = null;
    if (dx > 10 || dy > 10) return; // finger moved — was a scroll, not a tap
    e.preventDefault(); // suppress the subsequent synthetic click
    handleTap(t.clientX, t.clientY);
  }, { passive: false });

  // Desktop mouse fallback
  svg.addEventListener('click', (e) => {
    handleTap(e.clientX, e.clientY);
  });

  function handleTap(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const svgX = clientX - rect.left;
    const svgY = clientY - rect.top;

    // Which measure?
    const found = renderedMeasures.find(m => svgX >= m.x && svgX < m.x + m.width);
    if (!found || !found.tabStave) return;

    // TAB string y-positions from VexFlow (fallback: 13px spacing, +1 unit top margin)
    let lineYs;
    try {
      lineYs = Array.from({ length: NUM_STRINGS }, (_, i) => found.tabStave.getYForLine(i));
    } catch {
      lineYs = Array.from({ length: NUM_STRINGS }, (_, i) => TAB_Y + (i + 1) * 13);
    }

    const spacing = lineYs.length > 1 ? lineYs[1] - lineYs[0] : 13;
    const topY    = lineYs[0] - spacing;
    const bottomY = lineYs[NUM_STRINGS - 1] + spacing;

    if (svgY < topY || svgY > bottomY) return;

    let closestIdx = 0;
    let minDist    = Infinity;
    lineYs.forEach((y, i) => {
      const d = Math.abs(svgY - y);
      if (d < minDist) { minDist = d; closestIdx = i; }
    });

    // VexFlow line 0 = top (our string NUM_STRINGS-1 = G), line 3 = bottom (our string 0 = E)
    const ourString = (NUM_STRINGS - 1) - closestIdx;
    dispatch({ type: 'TAP_STRING', payload: { string: ourString } });
  }
}
