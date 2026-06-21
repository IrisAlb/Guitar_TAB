import { pitchToVexKey } from './model.js';
import { dispatch } from './store.js';

// Layout constants — tuned for A4 professional bass TAB standard:
//   4/4 quarter-note measures → ~5 per row at 720px (industry norm: 4-5/row)
//   System height ≈ 53mm fits 4-5 systems per A4 page
const STAVE_Y     = 10;
const TAB_Y       = 110;
const X_MARGIN    = 10;
const NOTE_SLOT_W = 28;
const MEASURE_PAD = 18;
const CLEF_W      = 58;
const PRINT_W     = 720;   // A4 usable width (210mm - 20mm margins ≈ 720px)

// TAB stave canvas height: grows with string count.
// The TAB clef glyph (TABLATURE_FONT_SCALE=39) fits ~5-string height;
// scale proportionally. Extra bottom room = 65px covers stave line padding.
function tabCanvasH(numStrings) { return TAB_Y + (numStrings - 1) * 13 + 65; }

// Populated each render(); consumed by scrollToCursor
let renderedMeasures = [];

// Active SVG element for helper drawing functions (rest symbols, arcs, ties)
let activeSvg = null;

// ── Shared: group measure indices into systems ────────────────────────────
function groupIntoSystems(measures, systemW) {
  const systems = [];
  let cur = [], curW = 0;
  measures.forEach((m, mi) => {
    const w = calcWidth(m, cur.length === 0);
    if (cur.length > 0 && curW + w > systemW) {
      systems.push(cur);
      cur  = [mi];
      curW = calcWidth(m, true);
    } else {
      cur.push(mi);
      curW += w;
    }
  });
  if (cur.length > 0) systems.push(cur);
  return systems;
}

// ── Screen renderer (multi-system, vertical scroll) ──────────────────────
export function render(score, cursor, _selection) {
  const V = window.Vex?.Flow;
  if (!V) { console.error('VexFlow not loaded'); return; }

  const scoreArea = document.getElementById('score-area');
  const container = document.getElementById('score-canvas');
  if (!container || !scoreArea) return;

  container.innerHTML = '';
  renderedMeasures = [];

  const { measures } = score;
  const numStrings = score.numStrings ?? 4;
  const canvasH    = tabCanvasH(numStrings);
  // Use at least PRINT_W so each row holds the same number of measures as print.
  // On wider displays (tablet/desktop) the actual width is used instead.
  const systemW = Math.max(PRINT_W, scoreArea.clientWidth);
  const systems = groupIntoSystems(measures, systemW);

  systems.forEach((mIndices, si) => {
    const sysMeasures = mIndices.map(mi => measures[mi]);
    const sysWidths   = sysMeasures.map((m, i) => calcWidth(m, i === 0));
    const totalW      = sysWidths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;

    const rowDiv = document.createElement('div');
    rowDiv.className = 'score-row';
    container.appendChild(rowDiv);

    const renderer = new V.Renderer(rowDiv, V.Renderer.Backends.SVG);
    renderer.resize(totalW, canvasH);
    const ctx = renderer.getContext();
    activeSvg = rowDiv.querySelector('svg');

    // Cursor highlight on the system that contains the cursor measure
    if (activeSvg && mIndices.includes(cursor.measureIndex)) {
      const localIdx = mIndices.indexOf(cursor.measureIndex);
      let hx = X_MARGIN;
      for (let i = 0; i < localIdx; i++) hx += sysWidths[i];
      const hilite = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hilite.setAttribute('x', hx);
      hilite.setAttribute('y', STAVE_Y - 5);
      hilite.setAttribute('width', sysWidths[localIdx]);
      hilite.setAttribute('height', canvasH);
      hilite.setAttribute('fill', 'rgba(74, 144, 226, 0.12)');
      hilite.setAttribute('pointer-events', 'none');
      activeSvg.appendChild(hilite);
    }

    let x = X_MARGIN;
    let prevResult = null;
    const sysRendered = [];

    sysMeasures.forEach((measure, idx) => {
      const mi = mIndices[idx];
      try {
        const isFirst       = si === 0 && idx === 0;
        const isSystemStart = idx === 0 && !isFirst;
        const result = renderMeasure(ctx, V, measure, x, sysWidths[idx], isFirst, isSystemStart, numStrings);

        const rm = { x, width: sysWidths[idx], tabStave: result.tabStave, mi, rowDiv };
        renderedMeasures.push(rm);
        sysRendered.push(rm);

        if (prevResult && idx > 0) {
          const prevM    = sysMeasures[idx - 1];
          const lastPrev = prevM.notes[prevM.notes.length - 1];
          const firstCur = measure.notes[0];
          if (lastPrev?.tiedToNext && firstCur?.isTied && !lastPrev.isRest && !firstCur.isRest) {
            drawTie(ctx, V,
              prevResult.staveNotes[prevResult.staveNotes.length - 1],
              result.staveNotes[0],
              prevResult.tabNotes[prevResult.tabNotes.length - 1],
              result.tabNotes[0],
            );
          }
        }
        prevResult = result;
      } catch (err) {
        console.warn(`Measure ${mi} render error:`, err);
        const rm = { x, width: sysWidths[idx], tabStave: null, mi, rowDiv };
        renderedMeasures.push(rm);
        sysRendered.push(rm);
        prevResult = null;
      }
      x += sysWidths[idx];
    });

    attachTapHandler(activeSvg, sysRendered, numStrings);
  });

  scrollToCursor(cursor);
}

// ── Print multi-system renderer ──────────────────────────────────────────
export function renderPrint(score) {
  const V = window.Vex?.Flow;
  if (!V) return;

  const container = document.getElementById('print-canvas');
  if (!container) return;
  container.innerHTML = '';

  const { measures } = score;
  const numStrings = score.numStrings ?? 4;
  const canvasH    = tabCanvasH(numStrings);

  const titleEl = document.createElement('p');
  titleEl.className = 'print-title';
  titleEl.textContent = score.title;
  container.appendChild(titleEl);

  const systems = groupIntoSystems(measures, PRINT_W);

  systems.forEach((mIndices, si) => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'print-row';
    container.appendChild(rowDiv);

    const sysMeasures = mIndices.map(mi => measures[mi]);
    const sysWidths   = sysMeasures.map((m, i) => calcWidth(m, i === 0));
    const totalW      = sysWidths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;

    const renderer = new V.Renderer(rowDiv, V.Renderer.Backends.SVG);
    renderer.resize(totalW, canvasH);
    const ctx = renderer.getContext();
    activeSvg = rowDiv.querySelector('svg');

    let x = X_MARGIN;
    let prevResult = null;

    sysMeasures.forEach((measure, idx) => {
      try {
        const isFirst       = si === 0 && idx === 0;
        const isSystemStart = idx === 0 && !isFirst;
        const result = renderMeasure(ctx, V, measure, x, sysWidths[idx], isFirst, isSystemStart, numStrings);

        if (prevResult && idx > 0) {
          const prevM    = sysMeasures[idx - 1];
          const lastPrev = prevM.notes[prevM.notes.length - 1];
          const firstCur = measure.notes[0];
          if (lastPrev?.tiedToNext && firstCur?.isTied && !lastPrev.isRest && !firstCur.isRest) {
            drawTie(ctx, V,
              prevResult.staveNotes[prevResult.staveNotes.length - 1],
              result.staveNotes[0],
              prevResult.tabNotes[prevResult.tabNotes.length - 1],
              result.tabNotes[0],
            );
          }
        }
        prevResult = result;
      } catch (err) {
        console.warn(`Print system ${si} measure ${mIndices[idx]} render error:`, err);
        prevResult = null;
      }
      x += sysWidths[idx];
    });
  });
}

// ── Scroll cursor's row into view (vertical) ─────────────────────────────
function scrollToCursor(cursor) {
  const scoreArea = document.getElementById('score-area');
  if (!scoreArea || renderedMeasures.length === 0) return;
  const cm = renderedMeasures.find(m => m.mi === cursor.measureIndex);
  if (!cm || !cm.rowDiv) return;

  const rowTop = cm.rowDiv.offsetTop;
  const rowH   = cm.rowDiv.clientHeight || CANVAS_H;
  const areaH  = scoreArea.clientHeight;
  const scrollT = scoreArea.scrollTop;

  if (rowTop < scrollT) {
    scoreArea.scrollTop = Math.max(0, rowTop - X_MARGIN);
  } else if (rowTop + rowH > scrollT + areaH) {
    scoreArea.scrollTop = rowTop + rowH - areaH + X_MARGIN;
  }
}

function calcWidth(measure, isFirst) {
  const slots = Math.max(1, measure.notes.length);
  return slots * NOTE_SLOT_W + MEASURE_PAD + (isFirst ? CLEF_W : 0);
}

function renderMeasure(ctx, V, measure, x, width, isFirst, isSystemStart = false, numStrings = 4) {
  const stave = new V.Stave(x, STAVE_Y, width);
  if (isFirst)            stave.addClef('bass').addTimeSignature('4/4');
  else if (isSystemStart) stave.addClef('bass');
  stave.setContext(ctx).draw();

  const tabStave = new V.TabStave(x, TAB_Y, width, { numLines: numStrings });
  if (isFirst || isSystemStart) tabStave.addTabGlyph();
  tabStave.setContext(ctx).draw();

  // Replace VexFlow's fixed-size sixStringTabClef glyph with a scaled custom label.
  // addTabGlyph() is kept so VexFlow computes the correct noteStartX for alignment.
  // After draw(), cover the glyph area and overlay scaled "TAB" text.
  if ((isFirst || isSystemStart) && activeSvg) {
    overwriteTabLabel(activeSvg, tabStave, numStrings);
  }

  if (measure.notes.length === 0) return { tabStave, staveNotes: [], tabNotes: [] };

  const staveNotes = measure.notes.map(n => toStaveNote(n, V));
  const tabNotes   = measure.notes.map(n => toTabNote(n, V, numStrings));

  const { beats, value } = measure.timeSignature;
  const SOFT = V.Voice.Mode?.SOFT ?? 2;

  const sv = new V.Voice({ num_beats: beats, beat_value: value });
  sv.setMode(SOFT);
  sv.addTickables(staveNotes);

  const tv = new V.Voice({ num_beats: beats, beat_value: value });
  tv.setMode(SOFT);
  tv.addTickables(tabNotes);

  const noteW = width - ((isFirst || isSystemStart) ? CLEF_W : MEASURE_PAD / 2) - MEASURE_PAD;

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

  // Draw rest symbols on TAB stave (GhostNote is invisible; add symbols manually)
  if (activeSvg) {
    measure.notes.forEach((note, i) => {
      if (!note.isRest) return;
      try {
        const x = staveNotes[i].getAbsoluteX();
        drawTabRestSymbol(activeSvg, note, x, tabStave);
      } catch (_) {}
    });
  }

  return { tabStave, staveNotes, tabNotes };
}

// Replace VexFlow's sixStringTabClef (always 6-string sized) with scaled "TAB" text.
// Keeps the clef in the stave model (for noteStartX alignment) but overwrites visually.
function overwriteTabLabel(svg, tabStave, numStrings) {
  try {
    const sx   = tabStave.getX();
    const snx  = tabStave.getNoteStartX();    // right edge of the clef area
    const clefW = snx - sx;
    const topY  = tabStave.getYForLine(0);
    const botY  = tabStave.getYForLine(numStrings - 1);

    // White rect covering the entire clef column (hides VexFlow's fixed-size glyph)
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x',      sx);
    bg.setAttribute('y',      TAB_Y - 2);
    bg.setAttribute('width',  clefW);
    bg.setAttribute('height', botY - TAB_Y + 20);
    bg.setAttribute('fill',   '#fff');
    svg.appendChild(bg);

    // Redraw stave lines over the white rect so they're not broken
    for (let s = 0; s < numStrings; s++) {
      const ly = tabStave.getYForLine(s);
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1',           sx);
      ln.setAttribute('y1',           ly);
      ln.setAttribute('x2',           sx + clefW);
      ln.setAttribute('y2',           ly);
      ln.setAttribute('stroke',       '#000');
      ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
    }

    // Draw scaled "TAB" letters: font size proportional to stave height / 3 letters
    const staveH   = botY - topY;
    const fontSize = Math.max(8, Math.round(staveH / 3.0));
    const cx       = sx + clefW * 0.45;   // center of the label area
    ['T', 'A', 'B'].forEach((ch, i) => {
      const cy = topY + (staveH * i / 2) + fontSize * 0.38;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.setAttribute('x',           cx);
      el.setAttribute('y',           cy);
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('font-family', 'serif');
      el.setAttribute('font-size',   fontSize);
      el.setAttribute('font-weight', 'bold');
      el.setAttribute('fill',        '#000');
      el.textContent = ch;
      svg.appendChild(el);
    });
  } catch (_) {}
}

function drawTabRestSymbol(svg, note, x, tabStave) {
  let midY;
  try { midY = tabStave.getYForLine(1.5); }
  catch (_) { midY = TAB_Y + 45; }

  const dur = note.duration;

  if (dur === 'w' || dur === 'h') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', 14);
    rect.setAttribute('height', 5);
    rect.setAttribute('x', x - 7);
    rect.setAttribute('y', dur === 'w' ? midY - 5 : midY);
    rect.setAttribute('fill', '#000');
    svg.appendChild(rect);
  } else {
    // Quarter/8th/16th: Bravura font SMuFL PUA code points
    const GLYPH_CHAR = { q: '', '8': '', '16': '' };
    const ch = GLYPH_CHAR[dur] ?? '';
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', midY + 10);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '26');
    text.setAttribute('font-family', 'Bravura, serif');
    text.setAttribute('fill', '#000');
    text.textContent = ch;
    svg.appendChild(text);
  }

  if (note.dotted) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x + 12);
    dot.setAttribute('cy', midY + 2);
    dot.setAttribute('r', 2);
    dot.setAttribute('fill', '#000');
    svg.appendChild(dot);
  }
}

function drawTie(ctx, V, sn0, sn1, tn0, tn1) {
  let staveTieDrawn = false;
  if (V.StaveTie && sn0 && sn1) {
    try {
      new V.StaveTie({
        first_note: sn0, last_note: sn1,
        first_indices: [0], last_indices: [0],
      }).setContext(ctx).draw();
      staveTieDrawn = true;
    } catch (_) {}
  }
  if (!staveTieDrawn && sn0 && sn1) {
    try {
      const x1 = sn0.getAbsoluteX() + 4;
      const x2 = sn1.getAbsoluteX() - 4;
      const st  = sn0.getStave();
      const y   = st ? st.getYForLine(2) : STAVE_Y + 25;
      drawSvgArc(x1, x2, y, -14);
    } catch (_) {}
  }

  if (tn0 && tn1) {
    try {
      const x1 = tn0.getAbsoluteX() + 4;
      const x2 = tn1.getAbsoluteX() - 4;
      if (x1 < x2) {
        const positions = typeof tn0.getPositions === 'function'
          ? tn0.getPositions()
          : (tn0.positions ?? []);
        if (positions.length > 0) {
          const vexStr = positions[0].str;
          const tabSt  = tn0.getStave();
          const lineY  = tabSt ? tabSt.getYForLine(vexStr - 1) : TAB_Y + vexStr * 13;
          drawSvgArc(x1, x2, lineY + 4, +12);
        }
      }
    } catch (_) {}
  }
}

function drawSvgArc(x1, x2, y, curvature) {
  const svg = activeSvg;
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
    const sn = new V.StaveNote({ keys: ['d/3'], duration: `${note.vexDuration}r`, clef: 'bass' });
    if (note.dotted && V.Dot) V.Dot.buildAndAttach([sn], { index: 0 });
    return sn;
  }
  const sn = new V.StaveNote({ keys: [pitchToVexKey(note.pitch)], duration: note.vexDuration, clef: 'bass' });
  if (note.pitch.name.includes('#')) sn.addModifier(new V.Accidental('#'));
  if (note.dotted && V.Dot) V.Dot.buildAndAttach([sn], { index: 0 });
  return sn;
}

function toTabNote(note, V, numStrings = 4) {
  if (note.isRest) return new V.GhostNote(note.vexDuration);
  const tn = new V.TabNote({
    positions: [{ str: numStrings - note.string, fret: note.fret }],
    duration: note.vexDuration,
  });
  if (note.dotted && V.Dot) V.Dot.buildAndAttach([tn], { index: 0 });
  return tn;
}

// ── Tap handler: attached per system SVG ─────────────────────────────────
function attachTapHandler(svg, sysRendered, numStrings = 4) {
  if (!svg || sysRendered.length === 0) return;

  svg.style.cursor = 'pointer';
  let tapStart = null;

  svg.addEventListener('touchstart', (e) => {
    tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  svg.addEventListener('touchend', (e) => {
    if (!tapStart) return;
    const t  = e.changedTouches[0];
    const dx = Math.abs(t.clientX - tapStart.x);
    const dy = Math.abs(t.clientY - tapStart.y);
    tapStart = null;
    if (dx > 10 || dy > 10) return;
    e.preventDefault();
    handleTap(t.clientX, t.clientY);
  }, { passive: false });

  svg.addEventListener('click', (e) => { handleTap(e.clientX, e.clientY); });

  function handleTap(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const svgX = clientX - rect.left;
    const svgY = clientY - rect.top;

    const found = sysRendered.find(m => svgX >= m.x && svgX < m.x + m.width);
    if (!found || !found.tabStave) return;

    let lineYs;
    try {
      lineYs = Array.from({ length: numStrings }, (_, i) => found.tabStave.getYForLine(i));
    } catch {
      lineYs = Array.from({ length: numStrings }, (_, i) => TAB_Y + (i + 1) * 13);
    }

    const spacing = lineYs.length > 1 ? lineYs[1] - lineYs[0] : 13;
    const topY    = lineYs[0] - spacing;
    const bottomY = lineYs[numStrings - 1] + spacing;
    if (svgY < topY || svgY > bottomY) return;

    let closestIdx = 0, minDist = Infinity;
    lineYs.forEach((y, i) => {
      const d = Math.abs(svgY - y);
      if (d < minDist) { minDist = d; closestIdx = i; }
    });

    const ourString = (numStrings - 1) - closestIdx;
    dispatch({ type: 'TAP_STRING', payload: { string: ourString } });
  }
}
