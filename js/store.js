import { Score, Measure, Note, deserializeScore } from './model.js';

const STORAGE_KEY = 'bass_tab_v1';
const UNDO_LIMIT  = 50;

export const state = {
  score: new Score(),

  cursor: {
    measureIndex: 0,
    beatTick: 0,      // tick position within current measure
  },

  selection: {
    measureIndex: -1,
    noteIndex:    -1, // -1 = nothing selected
  },

  input: {
    duration:     'q',
    dotted:       false,
    pendingFret:  '',
    awaitingFret: false,
    targetString: -1,
  },
};

const undoStack = [];
const listeners = [];

export function subscribe(fn) {
  listeners.push(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.score));
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.score = deserializeScore(JSON.parse(raw));
  } catch (e) {
    console.warn('LocalStorage load failed, starting fresh:', e);
    state.score = new Score();
  }
}

export function dispatch(action) {
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
  state.input.pendingFret  = '';
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

    case 'SELECT_DURATION': {
      state.input.duration = payload.duration;
      state.input.dotted   = payload.dotted ?? false;
      break;
    }

    case 'TOGGLE_DOTTED': {
      state.input.dotted = !state.input.dotted;
      break;
    }

    case 'TAP_STRING': {
      state.input.awaitingFret = true;
      state.input.targetString = payload.string;
      state.input.pendingFret  = '';
      break;
    }

    case 'INPUT_FRET_DIGIT': {
      if (!state.input.awaitingFret) break;
      const next = state.input.pendingFret + payload.digit;
      const num  = Number(next);
      if (next.length <= 2 && num >= 0 && num <= 24) {
        state.input.pendingFret = next;
      }
      break;
    }

    case 'CLEAR_FRET': {
      state.input.pendingFret = state.input.pendingFret.slice(0, -1);
      break;
    }

    case 'CONFIRM_FRET': {
      if (!state.input.awaitingFret) break;
      const fret = state.input.pendingFret === ''
        ? 0
        : parseInt(state.input.pendingFret, 10);

      pushUndo();

      const note = new Note({
        duration: state.input.duration,
        dotted:   state.input.dotted,
        isRest:   false,
        string:   state.input.targetString,
        fret,
      });

      const measure = state.score.measures[state.cursor.measureIndex];
      if (measure.hasRoomFor(note.ticks)) {
        measure.notes.push(note);
        advanceCursor(note.ticks);
      }

      resetFretInput();
      break;
    }

    case 'ADD_REST': {
      pushUndo();
      const rest = new Note({
        duration: state.input.duration,
        dotted:   state.input.dotted,
        isRest:   true,
      });
      const measure = state.score.measures[state.cursor.measureIndex];
      if (measure.hasRoomFor(rest.ticks)) {
        measure.notes.push(rest);
        advanceCursor(rest.ticks);
      }
      break;
    }

    case 'SELECT_NOTE': {
      state.selection.measureIndex = payload.measureIndex;
      state.selection.noteIndex    = payload.noteIndex;
      break;
    }

    case 'DESELECT': {
      state.selection.measureIndex = -1;
      state.selection.noteIndex    = -1;
      break;
    }

    case 'DELETE_NOTE': {
      const { measureIndex, noteIndex } = state.selection;
      if (measureIndex < 0 || noteIndex < 0) break;
      pushUndo();
      state.score.measures[measureIndex].notes.splice(noteIndex, 1);
      state.selection.measureIndex = -1;
      state.selection.noteIndex    = -1;
      break;
    }

    case 'ADD_TECHNIQUE': {
      const { measureIndex, noteIndex } = state.selection;
      if (measureIndex < 0 || noteIndex < 0) break;
      pushUndo();
      const note = state.score.measures[measureIndex].notes[noteIndex];
      const idx  = note.techniques.indexOf(payload.technique);
      if (idx === -1) {
        note.techniques.push(payload.technique);
      } else {
        note.techniques.splice(idx, 1);
      }
      break;
    }

    case 'ADD_MEASURE': {
      pushUndo();
      const last = state.score.measures[state.score.measures.length - 1];
      state.score.measures.push(new Measure({ timeSignature: { ...last.timeSignature } }));
      break;
    }

    case 'DELETE_MEASURE': {
      if (state.score.measures.length <= 1) break;
      pushUndo();
      const mi = payload.measureIndex ?? state.cursor.measureIndex;
      state.score.measures.splice(mi, 1);
      if (state.cursor.measureIndex >= state.score.measures.length) {
        state.cursor.measureIndex = state.score.measures.length - 1;
        state.cursor.beatTick     = 0;
      }
      break;
    }

    case 'SET_TITLE': {
      state.score.title = payload.title;
      break;
    }

    case 'UNDO': {
      if (undoStack.length === 0) break;
      state.score = deserializeScore(JSON.parse(undoStack.pop()));
      break;
    }

    default:
      console.warn('Unknown action:', type);
  }
}
