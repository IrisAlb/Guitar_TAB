import { pitchToVexKey } from './model.js';

// Layout constants
const STAVE_Y     = 10;   // y of standard notation stave
const TAB_Y       = 120;  // y of TAB stave
const CANVAS_H    = 230;  // total SVG height
const X_MARGIN    = 10;
const NOTE_SLOT_W = 52;   // px allocated per note
const MEASURE_PAD = 24;   // padding within each measure
const CLEF_W      = 80;   // extra width on first measure for clef + time sig

export function render(score, _cursor, _selection) {
  const V = window.Vex?.Flow;
  if (!V) { console.error('VexFlow not loaded'); return; }

  const container = document.getElementById('score-canvas');
  if (!container) return;

  container.innerHTML = '';

  const { measures } = score;
  const widths = measures.map((m, i) => calcWidth(m, i === 0));
  const totalW = widths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;

  const renderer = new V.Renderer(container, V.Renderer.Backends.SVG);
  renderer.resize(totalW, CANVAS_H);
  const ctx = renderer.getContext();

  let x = X_MARGIN;
  measures.forEach((measure, mi) => {
    try {
      renderMeasure(ctx, V, measure, x, widths[mi], mi === 0);
    } catch (err) {
      console.warn(`Measure ${mi} render error:`, err);
    }
    x += widths[mi];
  });
}

function calcWidth(measure, isFirst) {
  const slots = Math.max(1, measure.notes.length);
  return slots * NOTE_SLOT_W + MEASURE_PAD + (isFirst ? CLEF_W : 0);
}

function renderMeasure(ctx, V, measure, x, width, isFirst) {
  // Standard notation stave (bass clef)
  const stave = new V.Stave(x, STAVE_Y, width);
  if (isFirst) stave.addClef('bass').addTimeSignature('4/4');
  stave.setContext(ctx).draw();

  // TAB stave (4 strings)
  const tabStave = new V.TabStave(x, TAB_Y, width);
  if (isFirst) tabStave.addTabGlyph();
  tabStave.setContext(ctx).draw();

  if (measure.notes.length === 0) return;

  const staveNotes = measure.notes.map(n => toStaveNote(n, V));
  const tabNotes   = measure.notes.map(n => toTabNote(n, V));

  const { beats, value } = measure.timeSignature;

  // Voice.Mode.SOFT (numeric 2) allows partially-filled measures during editing
  const SOFT = V.Voice.Mode?.SOFT ?? 2;

  const sv = new V.Voice({ num_beats: beats, beat_value: value });
  sv.setMode(SOFT);
  sv.addTickables(staveNotes);

  const tv = new V.Voice({ num_beats: beats, beat_value: value });
  tv.setMode(SOFT);
  tv.addTickables(tabNotes);

  // noteW: available space for notes (subtract clef/timesig area on first measure)
  const noteW = width - (isFirst ? CLEF_W : MEASURE_PAD / 2) - MEASURE_PAD;

  new V.Formatter()
    .joinVoices([sv])
    .joinVoices([tv])
    .format([sv, tv], Math.max(10, noteW));

  sv.draw(ctx, stave);
  tv.draw(ctx, tabStave);

  // Beams for 8th / 16th notes in standard notation only
  V.Beam.generateBeams(staveNotes.filter(n => !n.isRest()))
    .forEach(b => b.setContext(ctx).draw());
}

function toStaveNote(note, V) {
  if (note.isRest) {
    // 'd/3' is the mid-staff rest position for bass clef
    return new V.StaveNote({
      keys: ['d/3'],
      duration: `${note.vexDuration}r`,
      clef: 'bass',
    });
  }

  const sn = new V.StaveNote({
    keys: [pitchToVexKey(note.pitch)],
    duration: note.vexDuration,
    clef: 'bass',
  });

  if (note.pitch.name.includes('#')) {
    sn.addModifier(new V.Accidental('#'));
  }

  return sn;
}

function toTabNote(note, V) {
  if (note.isRest) {
    // GhostNote keeps TAB timing aligned; string-form constructor is the safe API in VexFlow 4.x
    return new V.GhostNote(note.vexDuration);
  }

  // Our string 0 = E (lowest, bottom TAB line) → VexFlow str 4 (4-string, 1-indexed from top)
  return new V.TabNote({
    positions: [{ str: 4 - note.string, fret: note.fret }],
    duration: note.vexDuration,
  });
}
