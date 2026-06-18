import { dispatch } from './store.js';

let dom = {};

export function init() {
  dom = {
    titleInput:   document.getElementById('title-input'),
    fretDisplay:  document.getElementById('fret-display'),
    btnDotted:    document.getElementById('btn-dotted'),
    btnRest:      document.getElementById('btn-rest'),
    btnBackspace: document.getElementById('btn-backspace'),
    btnConfirm:   document.getElementById('btn-confirm'),
    btnExportPng: document.getElementById('btn-export-png'),
    btnPrint:     document.getElementById('btn-print'),
    durBtns:      [...document.querySelectorAll('.dur-btn[data-duration]')],
    numBtns:      [...document.querySelectorAll('.num-btn[data-digit]')],
    techBtns:     [...document.querySelectorAll('.tech-btn[data-technique]')],
  };
  bindEvents();
}

function bindEvents() {
  // ── 音符の長さ ──────────────────────────────
  dom.durBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dispatch({ type: 'SELECT_DURATION', payload: { duration: btn.dataset.duration } });
    });
  });

  dom.btnDotted.addEventListener('click', () => {
    dispatch({ type: 'TOGGLE_DOTTED' });
  });

  dom.btnRest.addEventListener('click', () => {
    dispatch({ type: 'ADD_REST' });
  });

  // ── テンキー ────────────────────────────────
  dom.numBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dispatch({ type: 'INPUT_FRET_DIGIT', payload: { digit: btn.dataset.digit } });
    });
  });

  dom.btnBackspace.addEventListener('click', () => {
    dispatch({ type: 'CLEAR_FRET' });
  });

  dom.btnConfirm.addEventListener('click', () => {
    dispatch({ type: 'CONFIRM_FRET' });
  });

  // ── 奏法記号 ────────────────────────────────
  dom.techBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      dispatch({ type: 'ADD_TECHNIQUE', payload: { technique: btn.dataset.technique } });
    });
  });

  // ── ヘッダー ────────────────────────────────
  dom.titleInput.addEventListener('change', () => {
    dispatch({ type: 'SET_TITLE', payload: { title: dom.titleInput.value.trim() || '無題' } });
  });

  dom.btnPrint.addEventListener('click', () => {
    window.print();
  });

  // PNG出力は Step 10 で実装（現時点ではプレースホルダー）
  dom.btnExportPng.addEventListener('click', () => {
    alert('PNG出力は近日実装予定です');
  });
}

export function update(state) {
  const { input, selection, score } = state;

  updateDurationButtons(input);
  updateFretDisplay(input);
  updateTechButtons(selection, score);
  syncTitle(score);
}

function updateDurationButtons(input) {
  dom.durBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.duration === input.duration);
  });
  dom.btnDotted.classList.toggle('active', input.dotted);
}

function updateFretDisplay(input) {
  if (input.awaitingFret) {
    dom.fretDisplay.className = 'waiting';
    dom.fretDisplay.textContent = input.pendingFret === '' ? '──' : input.pendingFret;
  } else {
    dom.fretDisplay.className = 'idle';
    dom.fretDisplay.textContent = '弦をタップして入力';
  }
}

function updateTechButtons(selection, score) {
  const selectedNote = (selection.measureIndex >= 0 && selection.noteIndex >= 0)
    ? score.measures[selection.measureIndex]?.notes[selection.noteIndex] ?? null
    : null;

  dom.techBtns.forEach(btn => {
    const tech = btn.dataset.technique;
    if (!selectedNote) {
      btn.classList.remove('active');
      btn.classList.add('disabled');
    } else {
      btn.classList.remove('disabled');
      btn.classList.toggle('active', selectedNote.techniques.includes(tech));
    }
  });
}

function syncTitle(score) {
  // Don't overwrite while the user is typing
  if (document.activeElement !== dom.titleInput) {
    dom.titleInput.value = score.title;
  }
}
