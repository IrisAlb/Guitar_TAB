import { load, state, dispatch, subscribe } from './store.js';
import { render } from './renderer.js';

load();

subscribe(({ score, cursor, selection }) => {
  render(score, cursor, selection);
});

render(state.score, state.cursor, state.selection);

// Expose to browser console for testing
window.app = { state, dispatch };

console.log('%cBass TAB Editor — Step 2', 'font-weight:bold;color:#4a90e2');
console.log('Test: app.dispatch({ type:"TAP_STRING", payload:{ string:0 } })');
console.log('      app.dispatch({ type:"INPUT_FRET_DIGIT", payload:{ digit:"5" } })');
console.log('      app.dispatch({ type:"CONFIRM_FRET" })');
