import { load, state, dispatch, subscribe } from './store.js';
import { render, renderPrint } from './renderer.js';
import { init as initUI, update as updateUI } from './ui.js';

load();
initUI();

subscribe(s => {
  render(s.score, s.cursor, s.selection);
  updateUI(s);
});

render(state.score, state.cursor, state.selection);
updateUI(state);

// Re-render when score area width changes (orientation change, etc.)
const _scoreArea = document.getElementById('score-area');
if (_scoreArea && window.ResizeObserver) {
  new ResizeObserver(() => render(state.score, state.cursor, state.selection)).observe(_scoreArea);
}

// Generate multi-system print layout just before the OS print dialog opens
window.addEventListener('beforeprint', () => renderPrint(state.score));

window.app = { state, dispatch };

console.log('%cBass TAB Editor — Step 4', 'font-weight:bold;color:#4a90e2');
