import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialData, splitHomeworkDecks, parseChord, chordVoicings, grade, editSequence, updatedProgress, chooseCard, validateData } from '../dist/core.mjs';

// Partition the exact homework keys without dropping or duplicating any card
test('four decks separate seven homework keys from five remaining keys', () => {
  const data = initialData();
  assert.equal(data.decks.length, 4);
  for (const prefix of ['145', '1645']) {
    assert.deepEqual(data.decks.find(d => d.id === `${prefix}-homework`).cards.map(c => c.question[0]), ['C', 'G', 'D', 'A', 'E', 'B', 'F']);
    assert.deepEqual(data.decks.find(d => d.id === `${prefix}-other`).cards.map(c => c.question[0]), ['F#', 'Db', 'Ab', 'Eb', 'Bb']);
  }
  assert.equal(new Set(data.decks.flatMap(d => d.cards.map(c => c.id))).size, 24);
});

// Existing libraries retain progress, edited cards, option banks and custom decks
test('saved library split is lossless and runs only once', () => {
  const seed = initialData();
  const legacy = ['145', '1645'].map(id => {
    const groups = seed.decks.filter(d => d.id.startsWith(id + '-'));
    return { ...groups[0], id, name: id, cards: groups.flatMap(d => d.cards) };
  });
  legacy[0].cards[0].answer = ['F', 'G', 'C'];
  const custom = { id: 'custom', name: 'My terms', description: '', kind: 'text', options: ['one', 'two'], cards: [] };
  const progress = { '1645-G': { correct: 2, wrong: 3, equivalent: 0, streak: 1, due: 1000 } };
  const data = { ...seed, decks: [...legacy, custom], selected: ['1645', 'custom'], progress };
  const beforeCards = structuredClone(legacy.flatMap(d => d.cards));
  splitHomeworkDecks(data);
  validateData(data);
  assert.equal(data.progress, progress);
  assert.equal(data.decks.at(-1), custom);
  assert.deepEqual(data.selected, ['1645-homework', 'custom']);
  for (const card of beforeCards) assert.deepEqual(data.decks.flatMap(d => d.cards).find(c => c.id === card.id), card);
  const once = structuredClone(data);
  splitHomeworkDecks(data);
  assert.deepEqual(data, once);
});

// Match the actual sounding notes of x35553, 577555, 133211 and 355433
test('C major playback matches the demonstrated guitar fingerings', () => {
  const tuning = [40, 45, 50, 55, 59, 64];
  const fingerings = [[null, 3, 5, 5, 5, 3], [5, 7, 7, 5, 5, 5], [1, 3, 3, 2, 1, 1], [3, 5, 5, 4, 3, 3]];
  const sounding = fingerings.map(frets => frets.flatMap((fret, i) => fret === null ? [] : [tuning[i] + fret]));
  assert.deepEqual(chordVoicings(['C', 'Am', 'F', 'G']), sounding);
  assert.deepEqual(chordVoicings(['C', 'F', 'G']), [sounding[0], sounding[2], sounding[3]]);
});

// Preserve the same bass contour and chord tones in all twelve keys
test('all seeded progressions transpose the guitar shapes consistently', () => {
  for (const deck of initialData().decks) for (const card of deck.cards) {
    const names = [...card.question, ...card.answer];
    const voices = chordVoicings(names);
    const bass = voices.map(notes => notes[0]);
    assert.deepEqual(bass.map(note => note - bass[0]), deck.id.startsWith('1645-') ? [0, -3, -7, -5] : [0, -7, -5]);
    voices.forEach((notes, i) => {
      const chord = parseChord(names[i]);
      assert.deepEqual([...new Set(notes.map(note => (note - chord.pitch + 12) % 12))].sort((a, b) => a - b), chord.intervals);
    });
  }
  assert.deepEqual(chordVoicings(['C', 'Am', 'F', 'G']).slice(1).map(notes => notes[0]), [45, 41, 43]);
  assert.deepEqual(chordVoicings(['Cmaj7'])[0], [48, 60, 64, 67, 71]);
});

// Verify all seeded progressions and references against major-scale relationships
test('all 24 cards use defined options and correct scale degrees', () => {
  const data = initialData();
  validateData(data);
  assert.equal(data.decks.flatMap(d => d.cards).length, 24);
  for (const deck of data.decks) for (const card of deck.cards) {
    const root = parseChord(card.question[0]).pitch;
    const chords = card.answer.map(parseChord);
    assert.deepEqual(chords.map(c => (c.pitch - root + 12) % 12), deck.id.startsWith('145-') ? [5, 7] : [9, 5, 7]);
    assert.deepEqual(chords.map(c => c.intervals[1]), deck.id.startsWith('145-') ? [4, 4] : [3, 4, 4]);
  }
  assert.equal('length' in data.settings, false);
  assert.equal('scope' in data.settings, false);
});

// Match chord suffixes without requiring Tab or committing partial names too early
test('continuous typing keeps accidentals and minor suffixes in the same slot', () => {
  const options = initialData().decks.find(deck => deck.id === '1645-homework').options;
  let state = { values: ['', '', ''], active: 0 };
  for (const char of 'F#mDE') state = editSequence(state, char, options, 'chord');
  assert.deepEqual(state, { values: ['F#m', 'D', 'E'], active: 3 });
  state = { values: ['', '', ''], active: 0 };
  for (const char of 'BbmGbAb') state = editSequence(state, char, options, 'chord');
  assert.deepEqual(state.values, ['Bbm', 'Gb', 'Ab']);
  state = { values: ['', ''], active: 0 };
  for (const char of 'Cdimm7') state = editSequence(state, char, ['C', 'Cdim', 'm7'], 'chord');
  assert.deepEqual(state.values, ['Cdim', 'm7']);
});

// Backspace traverses completed slots in reverse and preserves partial suffixes
test('backspace reverses slot entry and allows correction', () => {
  const options = initialData().decks.find(deck => deck.id === '1645-homework').options;
  let state = { values: ['F#m', 'D', 'E'], active: 3 };
  for (let i = 0; i < 3; i++) state = editSequence(state, 'Backspace', options, 'chord');
  assert.deepEqual(state, { values: ['F#', '', ''], active: 0 });
  for (const char of 'mDE') state = editSequence(state, char, options, 'chord');
  assert.deepEqual(state.values, ['F#m', 'D', 'E']);
});

// Use the same matcher for terms containing spaces and overlapping prefixes
test('generic terms auto-match and disambiguate longer options', () => {
  const options = ['major', 'major seventh', 'third', 'fifth'];
  let state = { values: ['', ''], active: 0 };
  for (const char of 'major sevenththird') state = editSequence(state, char, options, 'text');
  assert.deepEqual(state.values, ['major seventh', 'third']);
  state = { values: ['', ''], active: 0 };
  for (const char of 'major third') state = editSequence(state, char, options, 'text');
  assert.deepEqual(state.values, ['major', 'third']);
  state = { values: ['', ''], active: 0 };
  for (const char of 'THIRDfifth') state = editSequence(state, char, options, 'text');
  assert.deepEqual(state.values, ['third', 'fifth']);
});

// Grade sequence order and chord quality independently of enharmonic spelling
test('grading accepts equivalents but rejects missing accidentals and reordered answers', () => {
  assert.equal(grade(['F#m', 'D', 'E'], ['F#m', 'D', 'E'], 'chord').status, 'correct');
  assert.equal(grade(['Gbm', 'D', 'E'], ['F#m', 'D', 'E'], 'chord').status, 'equivalent');
  assert.equal(grade(['Fm', 'D', 'E'], ['F#m', 'D', 'E'], 'chord').status, 'wrong');
  assert.equal(grade(['F#', 'D', 'E'], ['F#m', 'D', 'E'], 'chord').status, 'wrong');
  assert.equal(grade(['third', 'root'], ['root', 'third'], 'text').status, 'wrong');
});

// Return errors after intervening cards without imposing any session length
test('scheduler supports continuous runs, retries and a single-card deck', () => {
  const cards = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const retries = { a: 3 };
  assert.equal(chooseCard(cards, {}, retries, 1, ['a'], 0, () => 0).id, 'b');
  assert.equal(chooseCard(cards, {}, retries, 2, ['a', 'b'], 0, () => 0).id, 'c');
  assert.equal(chooseCard(cards, {}, retries, 3, ['b', 'c'], 0).id, 'a');
  for (let step = 0; step < 100; step++) assert.equal(chooseCard([{ id: 'a' }], {}, {}, step, ['a'], 0).id, 'a');
  const first = updatedProgress(undefined, 'correct', 0);
  assert.ok(updatedProgress(first, 'correct', 0).due > first.due);
  assert.equal(updatedProgress(first, 'wrong', 0).streak, 0);
});

// Reject imported cards that bypass the deck's defined option bank
test('backup validation checks unique options and all card references', () => {
  const data = initialData();
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(data))), data);
  data.decks[0].cards[0].answer[0] = 'not-in-bank';
  assert.throws(() => validateData(data));
  const duplicate = initialData(); duplicate.decks[0].options.push('C');
  assert.throws(() => validateData(duplicate));
});
