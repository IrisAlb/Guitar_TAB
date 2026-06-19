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
  measures.forEach((measure, mi) => {
    try {
      const tabStave = renderMeasure(ctx, V, measure, x, widths[mi], mi === 0);
      renderedMeasures.push({ x, width: widths[mi], tabStave, mi });
    } catch (err) {
      console.warn(`Measure ${mi} render error:`, err);
      renderedMeasures.push({ x, width: widths[mi], tabStave: null, mi });
    }
    x += widths[mi];
  });

  attachTapHandler(container);
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

  if (measure.notes.length === 0) return tabStave;

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

  return tabStave;
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

  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const svgX  = e.clientX - rect.left;
    const svgY  = e.clientY - rect.top;

    // Which measure?
    const found = renderedMeasures.find(m => svgX >= m.x && svgX < m.x + m.width);
    if (!found || !found.tabStave) return;

    // Get actual y positions of each TAB string from VexFlow
    let lineYs;
    try {
      lineYs = Array.from({ length: NUM_STRINGS }, (_, i) => found.tabStave.getYForLine(i));
    } catch {
      // Fallback: default TabStave spacing is 13px, top_text_position adds one unit
      lineYs = Array.from({ length: NUM_STRINGS }, (_, i) => TAB_Y + (i + 1) * 13);
    }

    const spacing = lineYs.length > 1 ? lineYs[1] - lineYs[0] : 13;
    const topY    = lineYs[0] - spacing;
    const bottomY = lineYs[NUM_STRINGS - 1] + spacing;

    // Only respond to taps inside the TAB stave area
    if (svgY < topY || svgY > bottomY) return;

    // Closest string line
    let closestIdx = 0;
    let minDist    = Infinity;
    lineYs.forEach((y, i) => {
      const d = Math.abs(svgY - y);
      if (d < minDist) { minDist = d; closestIdx = i; }
    });

    // VexFlow line 0 = top string = our string (NUM_STRINGS-1) = G
    // VexFlow line 3 = bottom string = our string 0 = E
    const ourString = (NUM_STRINGS - 1) - closestIdx;
    dispatch({ type: 'TAP_STRING', payload: { string: ourString } });
  });
}
