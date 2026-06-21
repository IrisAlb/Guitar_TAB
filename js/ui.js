import { dispatch } from './store.js';

// String labels (high → low order for display; index 0 in array = highest string)
const STRING_LABELS = {
  4: [{ string: 3, label: 'G弦' }, { string: 2, label: 'D弦' }, { string: 1, label: 'A弦' }, { string: 0, label: 'E弦' }],
  5: [{ string: 4, label: 'G弦' }, { string: 3, label: 'D弦' }, { string: 2, label: 'A弦' }, { string: 1, label: 'E弦' }, { string: 0, label: 'B弦' }],
  6: [{ string: 5, label: 'C弦' }, { string: 4, label: 'G弦' }, { string: 3, label: 'D弦' }, { string: 2, label: 'A弦' }, { string: 1, label: 'E弦' }, { string: 0, label: 'B弦' }],
};

let dom = {};

export function init() {
  dom = {
    titleInput:    document.getElementById('title-input'),
    fretDisplay:   document.getElementById('fret-display'),
    btnDotted:     document.getElementById('btn-dotted'),
    btnRest:       document.getElementById('btn-rest'),
    btnBackspace:  document.getElementById('btn-backspace'),
    btnConfirm:    document.getElementById('btn-confirm'),
    btnExportPng:  document.getElementById('btn-export-png'),
    btnPrint:      document.getElementById('btn-print'),
    strCountBtns:  [...document.querySelectorAll('.str-count-btn[data-strings]')],
    stringRow:     document.getElementById('string-row'),
    durBtns:       [...document.querySelectorAll('.dur-btn[data-duration]')],
    numBtns:       [...document.querySelectorAll('.num-btn[data-digit]')],
    techBtns:      [...document.querySelectorAll('.tech-btn[data-technique]')],
  };
  buildStringButtons(4);
  bindEvents();
}

function buildStringButtons(numStrings) {
  dom.stringRow.innerHTML = '';
  const labels = STRING_LABELS[numStrings] ?? STRING_LABELS[4];
  labels.forEach(({ string, label }) => {
    const btn = document.createElement('button');
    btn.className = 'str-btn';
    btn.dataset.string = string;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      dispatch({ type: 'TAP_STRING', payload: { string: parseInt(btn.dataset.string, 10) } });
    });
    dom.stringRow.appendChild(btn);
  });
  dom.strBtns = [...dom.stringRow.querySelectorAll('.str-btn')];
}

function bindEvents() {
  // ── 弦数切り替え ─────────────────────────────
  dom.strCountBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.strings, 10);
      dispatch({ type: 'SET_NUM_STRINGS', payload: { numStrings: n } });
    });
  });

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

  dom.btnExportPng.addEventListener('click', () => {
    alert('PNG出力は近日実装予定です');
  });
}

let _lastNumStrings = 4;

export function update(state) {
  const { input, selection, score } = state;
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
  dom.strCountBtns.forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.strings, 10) === numStrings);
  });
}

function updateDurationButtons(input) {
  dom.durBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.duration === input.duration);
  });
  dom.btnDotted.classList.toggle('active', input.dotted);
}

function updateStringButtons(input) {
  dom.strBtns.forEach(btn => {
    const isActive = input.awaitingFret &&
                     parseInt(btn.dataset.string, 10) === input.targetString;
    btn.classList.toggle('active', isActive);
  });
}

function updateFretDisplay(input) {
  if (input.awaitingFret) {
    dom.fretDisplay.className = 'waiting';
    dom.fretDisplay.textContent = input.pendingFret === '' ? '──' : input.pendingFret;
  } else {
    dom.fretDisplay.className = 'idle';
    dom.fretDisplay.textContent = '──';
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
  if (document.activeElement !== dom.titleInput) {
    dom.titleInput.value = score.title;
  }
}
