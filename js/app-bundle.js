(() => {
  // js/model.js
  var DURATION = {
    WHOLE: "w",
    HALF: "h",
    QUARTER: "q",
    EIGHTH: "8",
    SIXTEENTH: "16"
  };
  var STANDARD_BASS_TUNING = [28, 33, 38, 43];
  var BASS_TUNINGS = {
    4: [28, 33, 38, 43],
    5: [23, 28, 33, 38, 43],
    6: [23, 28, 33, 38, 43, 48]
  };
  var MAX_FRET = 20;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var BASE_TICKS = { w: 4096, h: 2048, q: 1024, "8": 512, "16": 256 };
  var TICK_MAP = [
    [4096, "w", false],
    [3072, "h", true],
    [2048, "h", false],
    [1536, "q", true],
    [1024, "q", false],
    [768, "8", true],
    [512, "8", false],
    [384, "16", true],
    [256, "16", false]
  ];
  function splitTicks(ticks) {
    const result = [];
    let rem = ticks;
    for (const [t, duration, dotted] of TICK_MAP) {
      while (rem >= t) {
        result.push({ duration, dotted });
        rem -= t;
      }
    }
    return result;
  }
  function midiToPitch(midi) {
    return { name: NOTE_NAMES[midi % 12], octave: Math.floor(midi / 12) - 1 };
  }
  function pitchToVexKey({ name, octave }) {
    return `${name.toLowerCase()}/${octave}`;
  }
  var Note = class {
    constructor({
      duration = DURATION.QUARTER,
      dotted = false,
      isRest = false,
      string = 0,
      fret = 0,
      pitch = null,
      tuning = null,
      // tuning array for pitch computation; defaults to STANDARD_BASS_TUNING
      techniques = [],
      tiedToNext = false,
      // this note has a tie arc going to the next note
      isTied = false
      // this note is the continuation of a preceding tied note
    } = {}) {
      this.duration = duration;
      this.dotted = dotted;
      this.isRest = isRest;
      this.string = string;
      this.fret = fret;
      const openStrings = tuning ?? STANDARD_BASS_TUNING;
      const openMidi = openStrings[string] ?? 28;
      this.pitch = pitch ?? midiToPitch(openMidi + fret);
      this.techniques = [...techniques];
      this.tiedToNext = tiedToNext;
      this.isTied = isTied;
    }
    // VexFlow duration string ('q', 'qd', '8', etc.)
    get vexDuration() {
      return this.dotted ? `${this.duration}d` : this.duration;
    }
    get ticks() {
      const base = BASE_TICKS[this.duration] ?? 1024;
      return this.dotted ? Math.floor(base * 1.5) : base;
    }
  };
  var Measure = class {
    constructor({ timeSignature = { beats: 4, value: 4 }, notes = [] } = {}) {
      this.timeSignature = { ...timeSignature };
      this.notes = notes.map((n) => n instanceof Note ? n : new Note(n));
    }
    // Total ticks this measure can hold
    get capacity() {
      return this.timeSignature.beats / this.timeSignature.value * 4096;
    }
    get usedTicks() {
      return this.notes.reduce((sum, n) => sum + n.ticks, 0);
    }
    get remainingTicks() {
      return this.capacity - this.usedTicks;
    }
    hasRoomFor(ticks) {
      return this.remainingTicks >= ticks;
    }
  };
  var Score = class {
    constructor({ title = "\u7121\u984C", numStrings = 4, tuning = null, measures = [] } = {}) {
      this.title = title;
      this.numStrings = numStrings;
      this.tuning = tuning ? [...tuning] : [...BASS_TUNINGS[numStrings] ?? STANDARD_BASS_TUNING];
      this.measures = measures.length > 0 ? measures.map((m) => m instanceof Measure ? m : new Measure(m)) : [new Measure()];
    }
  };
  function deserializeScore(data) {
    const numStrings = data.numStrings ?? 4;
    return new Score({
      title: data.title,
      numStrings,
      tuning: data.tuning,
      measures: (data.measures ?? []).map(
        (m) => new Measure({
          timeSignature: m.timeSignature,
          notes: (m.notes ?? []).map((n) => new Note(n))
        })
      )
    });
  }

  // js/store.js
  var STORAGE_KEY = "bass_tab_v1";
  var UNDO_LIMIT = 50;
  var state = {
    score: new Score(),
    cursor: {
      measureIndex: 0,
      beatTick: 0
      // tick position within current measure
    },
    selection: {
      measureIndex: -1,
      noteIndex: -1
      // -1 = nothing selected
    },
    input: {
      duration: "q",
      dotted: false,
      pendingFret: "",
      awaitingFret: false,
      targetString: -1
    }
  };
  var undoStack = [];
  var listeners = [];
  function subscribe(fn) {
    listeners.push(fn);
  }
  function notify() {
    for (const fn of listeners) fn(state);
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.score));
    } catch (e) {
      console.warn("LocalStorage save failed:", e);
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.score = deserializeScore(JSON.parse(raw));
    } catch (e) {
      console.warn("LocalStorage load failed, starting fresh:", e);
      state.score = new Score();
    }
  }
  function dispatch(action) {
    handleAction(action);
    save();
    notify();
  }
  function pushUndo() {
    undoStack.push(JSON.stringify(state.score));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  function resetFretInput() {
    state.input.awaitingFret = false;
    state.input.targetString = -1;
    state.input.pendingFret = "";
  }
  function advanceCursor(ticks) {
    state.cursor.beatTick += ticks;
    const measure = state.score.measures[state.cursor.measureIndex];
    if (state.cursor.beatTick >= measure.capacity) {
      state.cursor.beatTick = 0;
      const next = state.cursor.measureIndex + 1;
      if (next < state.score.measures.length) {
        state.cursor.measureIndex = next;
      } else {
        const last = state.score.measures[state.score.measures.length - 1];
        state.score.measures.push(new Measure({ timeSignature: { ...last.timeSignature } }));
        state.cursor.measureIndex = next;
      }
    }
  }
  function handleAction({ type, payload = {} }) {
    switch (type) {
      case "SELECT_DURATION": {
        state.input.duration = payload.duration;
        state.input.dotted = payload.dotted ?? false;
        break;
      }
      case "TOGGLE_DOTTED": {
        state.input.dotted = !state.input.dotted;
        break;
      }
      case "TAP_STRING": {
        state.input.awaitingFret = true;
        state.input.targetString = payload.string;
        state.input.pendingFret = "";
        break;
      }
      case "INPUT_FRET_DIGIT": {
        if (!state.input.awaitingFret) break;
        const next = state.input.pendingFret + payload.digit;
        const num = Number(next);
        if (next.length <= 2 && num >= 0 && num <= MAX_FRET) {
          state.input.pendingFret = next;
        }
        break;
      }
      case "CLEAR_FRET": {
        if (state.input.awaitingFret) {
          if (state.input.pendingFret === "") {
            resetFretInput();
          } else {
            state.input.pendingFret = state.input.pendingFret.slice(0, -1);
          }
        } else {
          const measure = state.score.measures[state.cursor.measureIndex];
          if (measure.notes.length > 0) {
            pushUndo();
            measure.notes.pop();
            state.cursor.beatTick = measure.notes.reduce((sum, n) => sum + n.ticks, 0);
          } else if (state.cursor.measureIndex > 0) {
            state.cursor.measureIndex--;
            const prev = state.score.measures[state.cursor.measureIndex];
            if (prev.notes.length > 0) {
              pushUndo();
              prev.notes.pop();
              state.cursor.beatTick = prev.notes.reduce((sum, n) => sum + n.ticks, 0);
            }
          }
        }
        break;
      }
      case "CONFIRM_FRET": {
        if (!state.input.awaitingFret) break;
        if (state.input.targetString < 0 || state.input.targetString >= state.score.numStrings) {
          resetFretInput();
          break;
        }
        const fret = state.input.pendingFret === "" ? 0 : parseInt(state.input.pendingFret, 10);
        pushUndo();
        const tuning = state.score.tuning;
        const totalTicks = new Note({
          duration: state.input.duration,
          dotted: state.input.dotted,
          isRest: false,
          string: state.input.targetString,
          fret,
          tuning
        }).ticks;
        let ticksLeft = totalTicks;
        let isFirst = true;
        while (ticksLeft > 0) {
          const curMeasure = state.score.measures[state.cursor.measureIndex];
          const remaining = curMeasure.capacity - state.cursor.beatTick;
          if (remaining <= 0) break;
          const chunk = Math.min(ticksLeft, remaining);
          const parts = splitTicks(chunk);
          if (parts.length === 0) break;
          parts.forEach((part, i) => {
            const isLastPart = i === parts.length - 1;
            const isLastChunk = chunk >= ticksLeft;
            const n = new Note({
              duration: part.duration,
              dotted: part.dotted,
              isRest: false,
              string: state.input.targetString,
              fret,
              tuning,
              isTied: !isFirst,
              tiedToNext: !isLastPart || !isLastChunk
            });
            curMeasure.notes.push(n);
            advanceCursor(n.ticks);
            isFirst = false;
          });
          ticksLeft -= chunk;
        }
        break;
      }
      case "ADD_REST": {
        pushUndo();
        const rest = new Note({
          duration: state.input.duration,
          dotted: state.input.dotted,
          isRest: true
        });
        const measure = state.score.measures[state.cursor.measureIndex];
        if (measure.hasRoomFor(rest.ticks)) {
          measure.notes.push(rest);
          advanceCursor(rest.ticks);
        }
        break;
      }
      case "SELECT_NOTE": {
        state.selection.measureIndex = payload.measureIndex;
        state.selection.noteIndex = payload.noteIndex;
        break;
      }
      case "DESELECT": {
        state.selection.measureIndex = -1;
        state.selection.noteIndex = -1;
        break;
      }
      case "DELETE_NOTE": {
        const { measureIndex, noteIndex } = state.selection;
        if (measureIndex < 0 || noteIndex < 0) break;
        pushUndo();
        state.score.measures[measureIndex].notes.splice(noteIndex, 1);
        state.selection.measureIndex = -1;
        state.selection.noteIndex = -1;
        break;
      }
      case "ADD_TECHNIQUE": {
        const { measureIndex, noteIndex } = state.selection;
        if (measureIndex < 0 || noteIndex < 0) break;
        pushUndo();
        const note = state.score.measures[measureIndex].notes[noteIndex];
        const idx = note.techniques.indexOf(payload.technique);
        if (idx === -1) {
          note.techniques.push(payload.technique);
        } else {
          note.techniques.splice(idx, 1);
        }
        break;
      }
      case "ADD_MEASURE": {
        pushUndo();
        const last = state.score.measures[state.score.measures.length - 1];
        state.score.measures.push(new Measure({ timeSignature: { ...last.timeSignature } }));
        break;
      }
      case "DELETE_MEASURE": {
        if (state.score.measures.length <= 1) break;
        pushUndo();
        const mi = payload.measureIndex ?? state.cursor.measureIndex;
        state.score.measures.splice(mi, 1);
        if (state.cursor.measureIndex >= state.score.measures.length) {
          state.cursor.measureIndex = state.score.measures.length - 1;
          state.cursor.beatTick = 0;
        }
        break;
      }
      case "SET_NUM_STRINGS": {
        const n = payload.numStrings;
        if (n !== 4 && n !== 5 && n !== 6) break;
        state.score.numStrings = n;
        state.score.tuning = [...BASS_TUNINGS[n]];
        if (state.input.targetString >= n) {
          state.input.targetString = -1;
          state.input.awaitingFret = false;
          state.input.pendingFret = "";
        }
        break;
      }
      case "SET_TITLE": {
        state.score.title = payload.title;
        break;
      }
      case "UNDO": {
        if (undoStack.length === 0) break;
        state.score = deserializeScore(JSON.parse(undoStack.pop()));
        if (state.cursor.measureIndex >= state.score.measures.length) {
          state.cursor.measureIndex = state.score.measures.length - 1;
          state.cursor.beatTick = 0;
        }
        state.selection.measureIndex = -1;
        state.selection.noteIndex = -1;
        resetFretInput();
        break;
      }
      default:
        console.warn("Unknown action:", type);
    }
  }

  // js/renderer.js
  var STAVE_Y = 10;
  var TAB_Y = 110;
  var X_MARGIN = 10;
  var NOTE_SLOT_W = 28;
  var MEASURE_PAD = 18;
  var CLEF_W = 58;
  var PRINT_W = 720;
  function tabCanvasH(numStrings) {
    return TAB_Y + (numStrings - 1) * 13 + 65;
  }
  var renderedMeasures = [];
  var activeSvg = null;
  function groupIntoSystems(measures, systemW) {
    const systems = [];
    let cur = [], curW = 0;
    measures.forEach((m, mi) => {
      const w = calcWidth(m, cur.length === 0);
      if (cur.length > 0 && curW + w > systemW) {
        systems.push(cur);
        cur = [mi];
        curW = calcWidth(m, true);
      } else {
        cur.push(mi);
        curW += w;
      }
    });
    if (cur.length > 0) systems.push(cur);
    return systems;
  }
  function render(score, cursor, _selection) {
    const V = window.Vex?.Flow;
    if (!V) {
      console.error("VexFlow not loaded");
      return;
    }
    const scoreArea = document.getElementById("score-area");
    const container = document.getElementById("score-canvas");
    if (!container || !scoreArea) return;
    container.innerHTML = "";
    renderedMeasures = [];
    const { measures } = score;
    const numStrings = score.numStrings ?? 4;
    const canvasH = tabCanvasH(numStrings);
    const systemW = Math.max(PRINT_W, scoreArea.clientWidth);
    const systems = groupIntoSystems(measures, systemW);
    systems.forEach((mIndices, si) => {
      const sysMeasures = mIndices.map((mi) => measures[mi]);
      const sysWidths = sysMeasures.map((m, i) => calcWidth(m, i === 0));
      const totalW = sysWidths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;
      const rowDiv = document.createElement("div");
      rowDiv.className = "score-row";
      container.appendChild(rowDiv);
      const renderer = new V.Renderer(rowDiv, V.Renderer.Backends.SVG);
      renderer.resize(totalW, canvasH);
      const ctx = renderer.getContext();
      activeSvg = rowDiv.querySelector("svg");
      if (activeSvg && mIndices.includes(cursor.measureIndex)) {
        const localIdx = mIndices.indexOf(cursor.measureIndex);
        let hx = X_MARGIN;
        for (let i = 0; i < localIdx; i++) hx += sysWidths[i];
        const hilite = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        hilite.setAttribute("x", hx);
        hilite.setAttribute("y", STAVE_Y - 5);
        hilite.setAttribute("width", sysWidths[localIdx]);
        hilite.setAttribute("height", canvasH);
        hilite.setAttribute("fill", "rgba(74, 144, 226, 0.12)");
        hilite.setAttribute("pointer-events", "none");
        activeSvg.appendChild(hilite);
      }
      let x = X_MARGIN;
      let prevResult = null;
      const sysRendered = [];
      sysMeasures.forEach((measure, idx) => {
        const mi = mIndices[idx];
        try {
          const isFirst = si === 0 && idx === 0;
          const isSystemStart = idx === 0 && !isFirst;
          const result = renderMeasure(ctx, V, measure, x, sysWidths[idx], isFirst, isSystemStart, numStrings);
          const rm = { x, width: sysWidths[idx], tabStave: result.tabStave, mi, rowDiv };
          renderedMeasures.push(rm);
          sysRendered.push(rm);
          if (prevResult && idx > 0) {
            const prevM = sysMeasures[idx - 1];
            const lastPrev = prevM.notes[prevM.notes.length - 1];
            const firstCur = measure.notes[0];
            if (lastPrev?.tiedToNext && firstCur?.isTied && !lastPrev.isRest && !firstCur.isRest) {
              drawTie(
                ctx,
                V,
                prevResult.staveNotes[prevResult.staveNotes.length - 1],
                result.staveNotes[0],
                prevResult.tabNotes[prevResult.tabNotes.length - 1],
                result.tabNotes[0]
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
  function renderPrint(score) {
    const V = window.Vex?.Flow;
    if (!V) return;
    const container = document.getElementById("print-canvas");
    if (!container) return;
    container.innerHTML = "";
    const { measures } = score;
    const numStrings = score.numStrings ?? 4;
    const canvasH = tabCanvasH(numStrings);
    const titleEl = document.createElement("p");
    titleEl.className = "print-title";
    titleEl.textContent = score.title;
    container.appendChild(titleEl);
    const systems = groupIntoSystems(measures, PRINT_W);
    systems.forEach((mIndices, si) => {
      const rowDiv = document.createElement("div");
      rowDiv.className = "print-row";
      container.appendChild(rowDiv);
      const sysMeasures = mIndices.map((mi) => measures[mi]);
      const sysWidths = sysMeasures.map((m, i) => calcWidth(m, i === 0));
      const totalW = sysWidths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;
      const renderer = new V.Renderer(rowDiv, V.Renderer.Backends.SVG);
      renderer.resize(totalW, canvasH);
      const ctx = renderer.getContext();
      activeSvg = rowDiv.querySelector("svg");
      let x = X_MARGIN;
      let prevResult = null;
      sysMeasures.forEach((measure, idx) => {
        try {
          const isFirst = si === 0 && idx === 0;
          const isSystemStart = idx === 0 && !isFirst;
          const result = renderMeasure(ctx, V, measure, x, sysWidths[idx], isFirst, isSystemStart, numStrings);
          if (prevResult && idx > 0) {
            const prevM = sysMeasures[idx - 1];
            const lastPrev = prevM.notes[prevM.notes.length - 1];
            const firstCur = measure.notes[0];
            if (lastPrev?.tiedToNext && firstCur?.isTied && !lastPrev.isRest && !firstCur.isRest) {
              drawTie(
                ctx,
                V,
                prevResult.staveNotes[prevResult.staveNotes.length - 1],
                result.staveNotes[0],
                prevResult.tabNotes[prevResult.tabNotes.length - 1],
                result.tabNotes[0]
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
  function scrollToCursor(cursor) {
    const scoreArea = document.getElementById("score-area");
    if (!scoreArea || renderedMeasures.length === 0) return;
    const cm = renderedMeasures.find((m) => m.mi === cursor.measureIndex);
    if (!cm || !cm.rowDiv) return;
    const rowTop = cm.rowDiv.offsetTop;
    const rowH = cm.rowDiv.clientHeight || cm.rowDiv.getBoundingClientRect().height || 250;
    const areaH = scoreArea.clientHeight;
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
    if (isFirst) stave.addClef("bass").addTimeSignature("4/4");
    else if (isSystemStart) stave.addClef("bass");
    stave.setContext(ctx).draw();
    const tabStave = new V.TabStave(x, TAB_Y, width, { numLines: numStrings });
    if (isFirst || isSystemStart) tabStave.addTabGlyph();
    const preDrawTexts = (isFirst || isSystemStart) && activeSvg ? new Set(activeSvg.querySelectorAll("text")) : null;
    tabStave.setContext(ctx).draw();
    if ((isFirst || isSystemStart) && activeSvg) {
      overwriteTabLabel(activeSvg, tabStave, numStrings, preDrawTexts);
    }
    if (measure.notes.length === 0) return { tabStave, staveNotes: [], tabNotes: [] };
    const staveNotes = measure.notes.map((n) => toStaveNote(n, V));
    const tabNotes = measure.notes.map((n) => toTabNote(n, V, numStrings));
    const { beats, value } = measure.timeSignature;
    const SOFT = V.Voice.Mode?.SOFT ?? 2;
    const sv = new V.Voice({ num_beats: beats, beat_value: value });
    sv.setMode(SOFT);
    sv.addTickables(staveNotes);
    const tv = new V.Voice({ num_beats: beats, beat_value: value });
    tv.setMode(SOFT);
    tv.addTickables(tabNotes);
    const noteW = width - (isFirst || isSystemStart ? CLEF_W : MEASURE_PAD / 2) - MEASURE_PAD;
    new V.Formatter().joinVoices([sv]).joinVoices([tv]).format([sv, tv], Math.max(10, noteW));
    sv.draw(ctx, stave);
    tv.draw(ctx, tabStave);
    V.Beam.generateBeams(staveNotes.filter((n) => !n.isRest())).forEach((b) => b.setContext(ctx).draw());
    measure.notes.forEach((note, i) => {
      if (note.tiedToNext && !note.isRest && i + 1 < measure.notes.length && !measure.notes[i + 1].isRest) {
        drawTie(ctx, V, staveNotes[i], staveNotes[i + 1], tabNotes[i], tabNotes[i + 1]);
      }
    });
    if (activeSvg) {
      measure.notes.forEach((note, i) => {
        if (!note.isRest) return;
        try {
          const x2 = staveNotes[i].getAbsoluteX();
          drawTabRestSymbol(activeSvg, note, x2, tabStave);
        } catch (_) {
        }
      });
    }
    if (activeSvg) drawTabDurations(activeSvg, measure, tabNotes, tabStave, numStrings);
    return { tabStave, staveNotes, tabNotes };
  }
  function overwriteTabLabel(svg, tabStave, numStrings, preDrawTexts) {
    try {
      const sx = tabStave.getX();
      const snx = tabStave.getNoteStartX();
      const clefW = snx - sx;
      const topY = tabStave.getYForLine(0);
      const botY = tabStave.getYForLine(numStrings - 1);
      const staveH = botY - topY;
      const fontSize = Math.max(9, Math.round(staveH / 2.8));
      const cx = sx + clefW * 0.45;
      if (preDrawTexts) {
        svg.querySelectorAll("text").forEach((el) => {
          if (!preDrawTexts.has(el)) el.setAttribute("visibility", "hidden");
        });
      }
      ["T", "A", "B"].forEach((ch, i) => {
        const cy = topY + staveH * i / 2 + fontSize * 0.35;
        const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
        el.setAttribute("x", cx);
        el.setAttribute("y", cy);
        el.setAttribute("text-anchor", "middle");
        el.setAttribute("font-family", "serif");
        el.setAttribute("font-size", fontSize);
        el.setAttribute("font-weight", "bold");
        el.setAttribute("fill", "#000");
        el.textContent = ch;
        svg.appendChild(el);
      });
    } catch (_) {
    }
  }
  function drawTabRestSymbol(svg, note, x, tabStave) {
    let midY;
    try {
      midY = tabStave.getYForLine(1.5);
    } catch (_) {
      midY = TAB_Y + 45;
    }
    const dur = note.duration;
    if (dur === "w" || dur === "h") {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", 14);
      rect.setAttribute("height", 5);
      rect.setAttribute("x", x - 7);
      rect.setAttribute("y", dur === "w" ? midY - 5 : midY);
      rect.setAttribute("fill", "#000");
      svg.appendChild(rect);
    } else {
      const GLYPH_CHAR = { q: "\uE4E5", "8": "\uE4E6", "16": "\uE4E7" };
      const ch = GLYPH_CHAR[dur] ?? "\uE4E5";
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", x);
      text.setAttribute("y", midY + 10);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "26");
      text.setAttribute("font-family", "Bravura, serif");
      text.setAttribute("fill", "#000");
      text.textContent = ch;
      svg.appendChild(text);
    }
    if (note.dotted) {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x + 12);
      dot.setAttribute("cy", midY + 2);
      dot.setAttribute("r", 2);
      dot.setAttribute("fill", "#000");
      svg.appendChild(dot);
    }
  }
  function drawTie(ctx, V, sn0, sn1, tn0, tn1) {
    let staveTieDrawn = false;
    if (V.StaveTie && sn0 && sn1) {
      try {
        new V.StaveTie({
          first_note: sn0,
          last_note: sn1,
          first_indices: [0],
          last_indices: [0]
        }).setContext(ctx).draw();
        staveTieDrawn = true;
      } catch (_) {
      }
    }
    if (!staveTieDrawn && sn0 && sn1) {
      try {
        const x1 = sn0.getAbsoluteX() + 4;
        const x2 = sn1.getAbsoluteX() - 4;
        const st = sn0.getStave();
        const y = st ? st.getYForLine(2) : STAVE_Y + 25;
        drawSvgArc(x1, x2, y, -14);
      } catch (_) {
      }
    }
    if (tn0 && tn1) {
      try {
        const x1 = tn0.getAbsoluteX() + 4;
        const x2 = tn1.getAbsoluteX() - 4;
        if (x1 < x2) {
          const positions = typeof tn0.getPositions === "function" ? tn0.getPositions() : tn0.positions ?? [];
          if (positions.length > 0) {
            const vexStr = positions[0].str;
            const tabSt = tn0.getStave();
            const lineY = tabSt ? tabSt.getYForLine(vexStr - 1) : TAB_Y + vexStr * 13;
            drawSvgArc(x1, x2, lineY + 4, 12);
          }
        }
      } catch (_) {
      }
    }
  }
  function drawSvgArc(x1, x2, y, curvature) {
    const svg = activeSvg;
    if (!svg || x2 <= x1) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1},${y} Q ${(x1 + x2) / 2},${y + curvature} ${x2},${y}`);
    path.setAttribute("stroke", "#222");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
  }
  function toStaveNote(note, V) {
    if (note.isRest) {
      const sn2 = new V.StaveNote({ keys: ["d/3"], duration: `${note.vexDuration}r`, clef: "bass" });
      if (note.dotted && V.Dot) V.Dot.buildAndAttach([sn2], { index: 0 });
      return sn2;
    }
    const sn = new V.StaveNote({ keys: [pitchToVexKey(note.pitch)], duration: note.vexDuration, clef: "bass" });
    if (note.pitch.name.includes("#")) sn.addModifier(new V.Accidental("#"));
    if (note.dotted && V.Dot) V.Dot.buildAndAttach([sn], { index: 0 });
    return sn;
  }
  function toTabNote(note, V, numStrings = 4) {
    if (note.isRest) return new V.GhostNote(note.vexDuration);
    const tn = new V.TabNote({
      positions: [{ str: numStrings - note.string, fret: note.fret }],
      duration: note.vexDuration
    });
    if (note.dotted && V.Dot) V.Dot.buildAndAttach([tn], { index: 0 });
    return tn;
  }
  function drawTabDurations(svg, measure, tabNotes, tabStave, numStrings) {
    if (!svg || !measure.notes.length) return;
    const botY = tabStave.getYForLine(numStrings - 1);
    const STEM_H = 28;
    const BW = 5;
    const BGAP = 3;
    const BEAT = 480;
    let tick = 0;
    const items = measure.notes.map((note, i) => {
      let x = null;
      if (!note.isRest) {
        try {
          x = tabNotes[i].getAbsoluteX();
        } catch (_) {
        }
      }
      const item = { note, x, tick };
      tick += note.ticks;
      return item;
    });
    const stemBot = botY + STEM_H;
    items.forEach(({ note, x }) => {
      if (note.isRest || note.duration === "w" || x === null) return;
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", x);
      ln.setAttribute("y1", botY + 1);
      ln.setAttribute("x2", x);
      ln.setAttribute("y2", stemBot);
      ln.setAttribute("stroke", "#000");
      ln.setAttribute("stroke-width", "1.5");
      svg.appendChild(ln);
    });
    const groups = [];
    let cur = [], curBeat = -1;
    items.forEach(({ note, x, tick: nt }) => {
      const b = Math.floor(nt / BEAT);
      if (note.isRest || x === null || note.duration !== "8" && note.duration !== "16") {
        if (cur.length) {
          groups.push(cur);
          cur = [];
          curBeat = -1;
        }
        return;
      }
      if (curBeat !== -1 && b !== curBeat) {
        groups.push(cur);
        cur = [];
      }
      curBeat = b;
      cur.push({ x, dur: note.duration });
    });
    if (cur.length) groups.push(cur);
    const beamY = stemBot - BW;
    const mkRect = (x1, x2, y, h) => {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", x1 - 0.75);
      r.setAttribute("y", y);
      r.setAttribute("width", x2 - x1 + 1.5);
      r.setAttribute("height", h);
      r.setAttribute("fill", "#000");
      svg.appendChild(r);
    };
    groups.forEach((group) => {
      if (group.length === 1) {
        const { x, dur } = group[0];
        const mkFlag = (dy) => {
          const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
          p.setAttribute(
            "d",
            `M ${x},${stemBot + dy} C ${x + 11},${stemBot + dy + 5} ${x + 9},${stemBot + dy + 11} ${x + 3},${stemBot + dy + 14}`
          );
          p.setAttribute("stroke", "#000");
          p.setAttribute("stroke-width", "1.5");
          p.setAttribute("fill", "none");
          svg.appendChild(p);
        };
        mkFlag(0);
        if (dur === "16") mkFlag(-(BW + BGAP));
      } else {
        const fx = group[0].x, lx = group[group.length - 1].x;
        mkRect(fx, lx, beamY, BW);
        let run = [];
        const flush = () => {
          if (run.length >= 2) mkRect(run[0].x, run[run.length - 1].x, beamY - BW - BGAP, BW);
          run = [];
        };
        group.forEach((n) => n.dur === "16" ? run.push(n) : flush());
        flush();
      }
    });
  }
  function attachTapHandler(svg, sysRendered, numStrings = 4) {
    if (!svg || sysRendered.length === 0) return;
    svg.style.cursor = "pointer";
    let tapStart = null;
    svg.addEventListener("touchstart", (e) => {
      tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    svg.addEventListener("touchend", (e) => {
      if (!tapStart) return;
      const t = e.changedTouches[0];
      const dx = Math.abs(t.clientX - tapStart.x);
      const dy = Math.abs(t.clientY - tapStart.y);
      tapStart = null;
      if (dx > 10 || dy > 10) return;
      e.preventDefault();
      handleTap(t.clientX, t.clientY);
    }, { passive: false });
    svg.addEventListener("click", (e) => {
      handleTap(e.clientX, e.clientY);
    });
    function handleTap(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const svgX = clientX - rect.left;
      const svgY = clientY - rect.top;
      const found = sysRendered.find((m) => svgX >= m.x && svgX < m.x + m.width);
      if (!found || !found.tabStave) return;
      let lineYs;
      try {
        lineYs = Array.from({ length: numStrings }, (_, i) => found.tabStave.getYForLine(i));
      } catch {
        lineYs = Array.from({ length: numStrings }, (_, i) => TAB_Y + (i + 1) * 13);
      }
      const spacing = lineYs.length > 1 ? lineYs[1] - lineYs[0] : 13;
      const topY = lineYs[0] - spacing;
      const bottomY = lineYs[numStrings - 1] + spacing;
      if (svgY < topY || svgY > bottomY) return;
      let closestIdx = 0, minDist = Infinity;
      lineYs.forEach((y, i) => {
        const d = Math.abs(svgY - y);
        if (d < minDist) {
          minDist = d;
          closestIdx = i;
        }
      });
      const ourString = numStrings - 1 - closestIdx;
      dispatch({ type: "TAP_STRING", payload: { string: ourString } });
    }
  }

  // js/ui.js
  var STRING_LABELS = {
    4: [{ string: 3, label: "G\u5F26" }, { string: 2, label: "D\u5F26" }, { string: 1, label: "A\u5F26" }, { string: 0, label: "E\u5F26" }],
    5: [{ string: 4, label: "G\u5F26" }, { string: 3, label: "D\u5F26" }, { string: 2, label: "A\u5F26" }, { string: 1, label: "E\u5F26" }, { string: 0, label: "B\u5F26" }],
    6: [{ string: 5, label: "C\u5F26" }, { string: 4, label: "G\u5F26" }, { string: 3, label: "D\u5F26" }, { string: 2, label: "A\u5F26" }, { string: 1, label: "E\u5F26" }, { string: 0, label: "B\u5F26" }]
  };
  var dom = {};
  function init() {
    dom = {
      titleInput: document.getElementById("title-input"),
      fretDisplay: document.getElementById("fret-display"),
      btnDotted: document.getElementById("btn-dotted"),
      btnRest: document.getElementById("btn-rest"),
      btnBackspace: document.getElementById("btn-backspace"),
      btnConfirm: document.getElementById("btn-confirm"),
      btnExportPng: document.getElementById("btn-export-png"),
      btnPrint: document.getElementById("btn-print"),
      strCountBtns: [...document.querySelectorAll(".str-count-btn[data-strings]")],
      stringRow: document.getElementById("string-row"),
      durBtns: [...document.querySelectorAll(".dur-btn[data-duration]")],
      numBtns: [...document.querySelectorAll(".num-btn[data-digit]")],
      techBtns: [...document.querySelectorAll(".tech-btn[data-technique]")]
    };
    buildStringButtons(4);
    bindEvents();
  }
  function buildStringButtons(numStrings) {
    dom.stringRow.innerHTML = "";
    const labels = STRING_LABELS[numStrings] ?? STRING_LABELS[4];
    labels.forEach(({ string, label }) => {
      const btn = document.createElement("button");
      btn.className = "str-btn";
      btn.dataset.string = string;
      btn.textContent = label;
      btn.addEventListener("click", () => {
        dispatch({ type: "TAP_STRING", payload: { string: parseInt(btn.dataset.string, 10) } });
      });
      dom.stringRow.appendChild(btn);
    });
    dom.strBtns = [...dom.stringRow.querySelectorAll(".str-btn")];
  }
  function bindEvents() {
    dom.strCountBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = parseInt(btn.dataset.strings, 10);
        dispatch({ type: "SET_NUM_STRINGS", payload: { numStrings: n } });
      });
    });
    dom.durBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatch({ type: "SELECT_DURATION", payload: { duration: btn.dataset.duration } });
      });
    });
    dom.btnDotted.addEventListener("click", () => {
      dispatch({ type: "TOGGLE_DOTTED" });
    });
    dom.btnRest.addEventListener("click", () => {
      dispatch({ type: "ADD_REST" });
    });
    dom.numBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatch({ type: "INPUT_FRET_DIGIT", payload: { digit: btn.dataset.digit } });
      });
    });
    dom.btnBackspace.addEventListener("click", () => {
      dispatch({ type: "CLEAR_FRET" });
    });
    dom.btnConfirm.addEventListener("click", () => {
      dispatch({ type: "CONFIRM_FRET" });
    });
    dom.techBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatch({ type: "ADD_TECHNIQUE", payload: { technique: btn.dataset.technique } });
      });
    });
    dom.titleInput.addEventListener("change", () => {
      dispatch({ type: "SET_TITLE", payload: { title: dom.titleInput.value.trim() || "\u7121\u984C" } });
    });
    dom.btnPrint.addEventListener("click", () => {
      window.print();
    });
    dom.btnExportPng.addEventListener("click", () => {
      alert("PNG\u51FA\u529B\u306F\u8FD1\u65E5\u5B9F\u88C5\u4E88\u5B9A\u3067\u3059");
    });
  }
  var _lastNumStrings = 4;
  function update(state2) {
    const { input, selection, score } = state2;
    const numStrings = score.numStrings ?? 4;
    if (numStrings !== _lastNumStrings) {
      _lastNumStrings = numStrings;
      buildStringButtons(numStrings);
    }
    updateStrCountButtons(numStrings);
    updateDurationButtons(input);
    updateStringButtons(input);
    updateFretDisplay(input);
    updateTechButtons(selection, score);
    syncTitle(score);
  }
  function updateStrCountButtons(numStrings) {
    dom.strCountBtns.forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.strings, 10) === numStrings);
    });
  }
  function updateDurationButtons(input) {
    dom.durBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.duration === input.duration);
    });
    dom.btnDotted.classList.toggle("active", input.dotted);
  }
  function updateStringButtons(input) {
    dom.strBtns.forEach((btn) => {
      const isActive = input.awaitingFret && parseInt(btn.dataset.string, 10) === input.targetString;
      btn.classList.toggle("active", isActive);
    });
  }
  function updateFretDisplay(input) {
    if (input.awaitingFret) {
      dom.fretDisplay.className = "waiting";
      dom.fretDisplay.textContent = input.pendingFret === "" ? "\u2500\u2500" : input.pendingFret;
    } else {
      dom.fretDisplay.className = "idle";
      dom.fretDisplay.textContent = "\u2500\u2500";
    }
  }
  function updateTechButtons(selection, score) {
    const selectedNote = selection.measureIndex >= 0 && selection.noteIndex >= 0 ? score.measures[selection.measureIndex]?.notes[selection.noteIndex] ?? null : null;
    dom.techBtns.forEach((btn) => {
      const tech = btn.dataset.technique;
      if (!selectedNote) {
        btn.classList.remove("active");
        btn.classList.add("disabled");
      } else {
        btn.classList.remove("disabled");
        btn.classList.toggle("active", selectedNote.techniques.includes(tech));
      }
    });
  }
  function syncTitle(score) {
    if (document.activeElement !== dom.titleInput) {
      dom.titleInput.value = score.title;
    }
  }

  // js/app.js
  load();
  init();
  subscribe((s) => {
    render(s.score, s.cursor, s.selection);
    update(s);
  });
  render(state.score, state.cursor, state.selection);
  update(state);
  var _scoreArea = document.getElementById("score-area");
  if (_scoreArea && window.ResizeObserver) {
    new ResizeObserver(() => render(state.score, state.cursor, state.selection)).observe(_scoreArea);
  }
  window.addEventListener("beforeprint", () => renderPrint(state.score));
  window.addEventListener("afterprint", () => {
    const pc = document.getElementById("print-canvas");
    if (pc) pc.innerHTML = "";
  });
  window.app = { state, dispatch };
  console.log("%cBass TAB Editor \u2014 Step 4", "font-weight:bold;color:#4a90e2");
})();
