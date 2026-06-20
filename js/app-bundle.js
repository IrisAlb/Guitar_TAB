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
  var MAX_FRET = 20;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var BASE_TICKS = { w: 4096, h: 2048, q: 1024, "8": 512, "16": 256 };
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
      techniques = []
    } = {}) {
      this.duration = duration;
      this.dotted = dotted;
      this.isRest = isRest;
      this.string = string;
      this.fret = fret;
      this.pitch = pitch ?? midiToPitch(STANDARD_BASS_TUNING[string] + fret);
      this.techniques = [...techniques];
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
    constructor({ title = "\u7121\u984C", tuning = [...STANDARD_BASS_TUNING], measures = [] } = {}) {
      this.title = title;
      this.tuning = [...tuning];
      this.measures = measures.length > 0 ? measures.map((m) => m instanceof Measure ? m : new Measure(m)) : [new Measure()];
    }
  };
  function deserializeScore(data) {
    return new Score({
      title: data.title,
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
        state.input.pendingFret = state.input.pendingFret.slice(0, -1);
        break;
      }
      case "CONFIRM_FRET": {
        if (!state.input.awaitingFret) break;
        if (state.input.targetString < 0 || state.input.targetString > 3) {
          resetFretInput();
          break;
        }
        const fret = state.input.pendingFret === "" ? 0 : parseInt(state.input.pendingFret, 10);
        pushUndo();
        const note = new Note({
          duration: state.input.duration,
          dotted: state.input.dotted,
          isRest: false,
          string: state.input.targetString,
          fret
        });
        const measure = state.score.measures[state.cursor.measureIndex];
        if (measure.hasRoomFor(note.ticks)) {
          measure.notes.push(note);
          advanceCursor(note.ticks);
        }
        resetFretInput();
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
  var TAB_Y = 120;
  var CANVAS_H = 230;
  var X_MARGIN = 10;
  var NOTE_SLOT_W = 52;
  var MEASURE_PAD = 24;
  var CLEF_W = 80;
  var NUM_STRINGS = 4;
  var renderedMeasures = [];
  function render(score, cursor, _selection) {
    const V = window.Vex?.Flow;
    if (!V) {
      console.error("VexFlow not loaded");
      return;
    }
    const container = document.getElementById("score-canvas");
    if (!container) return;
    container.innerHTML = "";
    renderedMeasures = [];
    const { measures } = score;
    const widths = measures.map((m, i) => calcWidth(m, i === 0));
    const totalW = widths.reduce((a, b) => a + b, 0) + X_MARGIN * 2;
    const renderer = new V.Renderer(container, V.Renderer.Backends.SVG);
    renderer.resize(totalW, CANVAS_H);
    const ctx = renderer.getContext();
    const svg = container.querySelector("svg");
    if (svg && cursor.measureIndex >= 0 && cursor.measureIndex < measures.length) {
      let hx = X_MARGIN;
      for (let i = 0; i < cursor.measureIndex; i++) hx += widths[i];
      const hilite = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      hilite.setAttribute("x", hx);
      hilite.setAttribute("y", STAVE_Y - 5);
      hilite.setAttribute("width", widths[cursor.measureIndex]);
      hilite.setAttribute("height", CANVAS_H);
      hilite.setAttribute("fill", "rgba(74, 144, 226, 0.12)");
      hilite.setAttribute("pointer-events", "none");
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
    if (isFirst) stave.addClef("bass").addTimeSignature("4/4");
    stave.setContext(ctx).draw();
    const tabStave = new V.TabStave(x, TAB_Y, width, { num_lines: NUM_STRINGS });
    if (isFirst) tabStave.addTabGlyph();
    tabStave.setContext(ctx).draw();
    if (measure.notes.length === 0) return tabStave;
    const staveNotes = measure.notes.map((n) => toStaveNote(n, V));
    const tabNotes = measure.notes.map((n) => toTabNote(n, V));
    const { beats, value } = measure.timeSignature;
    const SOFT = V.Voice.Mode?.SOFT ?? 2;
    const sv = new V.Voice({ num_beats: beats, beat_value: value });
    sv.setMode(SOFT);
    sv.addTickables(staveNotes);
    const tv = new V.Voice({ num_beats: beats, beat_value: value });
    tv.setMode(SOFT);
    tv.addTickables(tabNotes);
    const noteW = width - (isFirst ? CLEF_W : MEASURE_PAD / 2) - MEASURE_PAD;
    new V.Formatter().joinVoices([sv]).joinVoices([tv]).format([sv, tv], Math.max(10, noteW));
    sv.draw(ctx, stave);
    tv.draw(ctx, tabStave);
    V.Beam.generateBeams(staveNotes.filter((n) => !n.isRest())).forEach((b) => b.setContext(ctx).draw());
    return tabStave;
  }
  function toStaveNote(note, V) {
    if (note.isRest) {
      return new V.StaveNote({ keys: ["d/3"], duration: `${note.vexDuration}r`, clef: "bass" });
    }
    const sn = new V.StaveNote({ keys: [pitchToVexKey(note.pitch)], duration: note.vexDuration, clef: "bass" });
    if (note.pitch.name.includes("#")) sn.addModifier(new V.Accidental("#"));
    return sn;
  }
  function toTabNote(note, V) {
    if (note.isRest) return new V.GhostNote(note.vexDuration);
    return new V.TabNote({
      positions: [{ str: NUM_STRINGS - note.string, fret: note.fret }],
      duration: note.vexDuration
    });
  }
  function attachTapHandler(container) {
    const svg = container.querySelector("svg");
    if (!svg || renderedMeasures.length === 0) return;
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
      const found = renderedMeasures.find((m) => svgX >= m.x && svgX < m.x + m.width);
      if (!found || !found.tabStave) return;
      let lineYs;
      try {
        lineYs = Array.from({ length: NUM_STRINGS }, (_, i) => found.tabStave.getYForLine(i));
      } catch {
        lineYs = Array.from({ length: NUM_STRINGS }, (_, i) => TAB_Y + (i + 1) * 13);
      }
      const spacing = lineYs.length > 1 ? lineYs[1] - lineYs[0] : 13;
      const topY = lineYs[0] - spacing;
      const bottomY = lineYs[NUM_STRINGS - 1] + spacing;
      if (svgY < topY || svgY > bottomY) return;
      let closestIdx = 0;
      let minDist = Infinity;
      lineYs.forEach((y, i) => {
        const d = Math.abs(svgY - y);
        if (d < minDist) {
          minDist = d;
          closestIdx = i;
        }
      });
      const ourString = NUM_STRINGS - 1 - closestIdx;
      dispatch({ type: "TAP_STRING", payload: { string: ourString } });
    }
  }

  // js/ui.js
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
      durBtns: [...document.querySelectorAll(".dur-btn[data-duration]")],
      numBtns: [...document.querySelectorAll(".num-btn[data-digit]")],
      techBtns: [...document.querySelectorAll(".tech-btn[data-technique]")],
      strBtns: [...document.querySelectorAll(".str-btn[data-string]")]
    };
    bindEvents();
  }
  function bindEvents() {
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
    dom.strBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        dispatch({ type: "TAP_STRING", payload: { string: parseInt(btn.dataset.string, 10) } });
      });
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
  function update(state2) {
    const { input, selection, score } = state2;
    updateDurationButtons(input);
    updateStringButtons(input);
    updateFretDisplay(input);
    updateTechButtons(selection, score);
    syncTitle(score);
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
  window.app = { state, dispatch };
  console.log("%cBass TAB Editor \u2014 Step 4", "font-weight:bold;color:#4a90e2");
})();
