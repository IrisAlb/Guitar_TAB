import { load, state, dispatch, subscribe } from './store.js';

load();

// Placeholder callbacks — replaced in later steps
subscribe(() => {});

// Expose to browser console for Step 1 manual testing
window.app = { state, dispatch };

console.log('%cBass TAB Editor — Step 1', 'font-weight:bold;color:#4a90e2');
console.log('state:', state);
console.log('Try: app.dispatch({ type: "SELECT_DURATION", payload: { duration: "8" } })');
console.log('Try: app.dispatch({ type: "TAP_STRING",     payload: { string: 0 } })');
console.log('Try: app.dispatch({ type: "INPUT_FRET_DIGIT", payload: { digit: "5" } })');
console.log('Try: app.dispatch({ type: "CONFIRM_FRET" })');
console.log('Try: app.dispatch({ type: "ADD_MEASURE" })');
