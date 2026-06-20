export const DURATION = {
  WHOLE:     'w',
  HALF:      'h',
  QUARTER:   'q',
  EIGHTH:    '8',
  SIXTEENTH: '16',
};

export const TECHNIQUE = {
  HAMMER_ON: 'H',
  PULL_OFF:  'P',
  SLIDE:     'S',
  BEND:      'B',
  PALM_MUTE: 'PM',
  GHOST:     'X',
};

// MIDI note numbers for open strings: E1=28, A1=33, D2=38, G2=43
export const STANDARD_BASS_TUNING = [28, 33, 38, 43];
export const MAX_FRET = 20;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Ticks per note value (whole note = 4096)
const BASE_TICKS = { w: 4096, h: 2048, q: 1024, '8': 512, '16': 256 };

// Ordered largest-first: used by the greedy split algorithm
const TICK_MAP = [
  [4096, 'w',  false],
  [3072, 'h',  true ],
  [2048, 'h',  false],
  [1536, 'q',  true ],
  [1024, 'q',  false],
  [768,  '8',  true ],
  [512,  '8',  false],
  [384,  '16', true ],
  [256,  '16', false],
];

/**
 * Split a tick count into the minimum array of {duration, dotted} objects.
 * Any multiple of 256 (= 1/16 note) can be represented exactly.
 */
export function splitTicks(ticks) {
  const result = [];
  let rem = ticks;
  for (const [t, duration, dotted] of TICK_MAP) {
    while (rem >= t) { result.push({ duration, dotted }); rem -= t; }
  }
  return result;
}

export function midiToPitch(midi) {
  return { name: NOTE_NAMES[midi % 12], octave: Math.floor(midi / 12) - 1 };
}

export function pitchToMidi({ name, octave }) {
  return (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
}

// VexFlow key format: 'e/1', 'c#/3', etc.
export function pitchToVexKey({ name, octave }) {
  return `${name.toLowerCase()}/${octave}`;
}

/**
 * Choose the best (string, fret) for a MIDI pitch.
 * Prefers the fret closest to the previous note's fret; falls back to lowest fret.
 */
export function autoAssign(midiPitch, tuning = STANDARD_BASS_TUNING, previousNote = null) {
  const candidates = tuning
    .map((open, string) => ({ string, fret: midiPitch - open }))
    .filter(({ fret }) => fret >= 0 && fret <= MAX_FRET);

  if (candidates.length === 0) return null;
  if (!previousNote) return candidates.reduce((a, b) => (a.fret <= b.fret ? a : b));

  return candidates.reduce((best, c) => {
    const dc = Math.abs(c.fret - previousNote.fret);
    const db = Math.abs(best.fret - previousNote.fret);
    if (dc < db) return c;
    if (dc === db && c.fret < best.fret) return c;
    return best;
  });
}

export class Note {
  constructor({
    duration    = DURATION.QUARTER,
    dotted      = false,
    isRest      = false,
    string      = 0,
    fret        = 0,
    pitch       = null,
    techniques  = [],
    tiedToNext  = false,  // this note has a tie arc going to the next note
    isTied      = false,  // this note is the continuation of a preceding tied note
  } = {}) {
    this.duration   = duration;
    this.dotted     = dotted;
    this.isRest     = isRest;
    this.string     = string;
    this.fret       = fret;
    this.pitch      = pitch ?? midiToPitch(STANDARD_BASS_TUNING[string] + fret);
    this.techniques = [...techniques];
    this.tiedToNext = tiedToNext;
    this.isTied     = isTied;
  }

  // VexFlow duration string ('q', 'qd', '8', etc.)
  get vexDuration() {
    return this.dotted ? `${this.duration}d` : this.duration;
  }

  get ticks() {
    const base = BASE_TICKS[this.duration] ?? 1024;
    return this.dotted ? Math.floor(base * 1.5) : base;
  }
}

export class Measure {
  constructor({ timeSignature = { beats: 4, value: 4 }, notes = [] } = {}) {
    this.timeSignature = { ...timeSignature };
    this.notes = notes.map(n => (n instanceof Note ? n : new Note(n)));
  }

  // Total ticks this measure can hold
  get capacity() {
    return (this.timeSignature.beats / this.timeSignature.value) * 4096;
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
}

export class Score {
  constructor({ title = '無題', tuning = [...STANDARD_BASS_TUNING], measures = [] } = {}) {
    this.title    = title;
    this.tuning   = [...tuning];
    this.measures = measures.length > 0
      ? measures.map(m => (m instanceof Measure ? m : new Measure(m)))
      : [new Measure()];
  }
}

export function deserializeScore(data) {
  return new Score({
    title:    data.title,
    tuning:   data.tuning,
    measures: (data.measures ?? []).map(m =>
      new Measure({
        timeSignature: m.timeSignature,
        notes: (m.notes ?? []).map(n => new Note(n)),
      })
    ),
  });
}
