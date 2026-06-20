import { Score, Measure, Note, deserializeScore, MAX_FRET, splitTicks } from './model.js';

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
    } else {
      // 小節が満杯になったら自動で次の小節を追加
      const last = state.score.measures[state.score.measures.length - 1];
      state.score.measures.push(new Measure({ timeSignature: { ...last.timeSignature } }));
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
      if (next.length <= 2 && num >= 0 && num <= MAX_FRET) {
        state.input.pendingFret = next;
      }
      break;
    }

    case 'CLEAR_FRET': {
      if (state.input.awaitingFret) {
        // フレット入力中: 数字を1桁消す。空なら弦選択をキャンセル
        if (state.input.pendingFret === '') {
          resetFretInput();
        } else {
          state.input.pendingFret = state.input.pendingFret.slice(0, -1);
        }
      } else {
        // 通常モード: 直前に入力した音符を削除してカーソルを戻す
        const measure = state.score.measures[state.cursor.measureIndex];
        if (measure.notes.length > 0) {
          pushUndo();
          measure.notes.pop();
          state.cursor.beatTick = measure.notes.reduce((sum, n) => sum + n.ticks, 0);
        } else if (state.cursor.measureIndex > 0) {
          // 現在の小節が空 → 前の小節の最後の音符を削除
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

    case 'CONFIRM_FRET': {
      if (!state.input.awaitingFret) break;
      if (state.input.targetString < 0 || state.input.targetString > 3) {
        resetFretInput();
        break;
      }
      const fret = state.input.pendingFret === ''
        ? 0
        : parseInt(state.input.pendingFret, 10);

      pushUndo();

      // Total ticks of the selected note value
      const totalTicks = new Note({
        duration: state.input.duration,
        dotted:   state.input.dotted,
        isRest:   false,
        string:   state.input.targetString,
        fret,
      }).ticks;

      let ticksLeft = totalTicks;
      let isFirst   = true;

      // Distribute ticks across measures, creating tied notes when overflowing
      while (ticksLeft > 0) {
        const curMeasure = state.score.measures[state.cursor.measureIndex];
        const remaining  = curMeasure.capacity - state.cursor.beatTick;
        if (remaining <= 0) break;

        const chunk = Math.min(ticksLeft, remaining);
        const parts = splitTicks(chunk);
        if (parts.length === 0) break;

        parts.forEach((part, i) => {
          const isLastPart  = i === parts.length - 1;
          const isLastChunk = chunk >= ticksLeft;
          const n = new Note({
            duration:   part.duration,
            dotted:     part.dotted,
            isRest:     false,
            string:     state.input.targetString,
            fret,
            isTied:     !isFirst,
            tiedToNext: !isLastPart || !isLastChunk,
          });
          curMeasure.notes.push(n);
          advanceCursor(n.ticks);
          isFirst = false;
        });

        ticksLeft -= chunk;
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
      // Clamp cursor and clear selection since the score structure may have changed
      if (state.cursor.measureIndex >= state.score.measures.length) {
        state.cursor.measureIndex = state.score.measures.length - 1;
        state.cursor.beatTick     = 0;
      }
      state.selection.measureIndex = -1;
      state.selection.noteIndex    = -1;
      resetFretInput();
      break;
    }

    default:
      console.warn('Unknown action:', type);
  }
}
