import { load, state, dispatch, subscribe } from './store.js';
import { render } from './renderer.js';
import { init as initUI, update as updateUI } from './ui.js';

load();
initUI();

subscribe(s => {
  render(s.score, s.cursor, s.selection);
  updateUI(s);
});

render(state.score, state.cursor, state.selection);
updateUI(state);

window.app = { state, dispatch };

console.log('%cBass TAB Editor — Step 4', 'font-weight:bold;color:#4a90e2');
