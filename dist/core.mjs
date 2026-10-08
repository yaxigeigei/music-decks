// Seed the homework and remaining-key decks with correctly spelled progressions
export function initialData() {
  const keys = [
    ['C', 'Am', 'F', 'G'], ['G', 'Em', 'C', 'D'], ['D', 'Bm', 'G', 'A'],
    ['A', 'F#m', 'D', 'E'], ['E', 'C#m', 'A', 'B'], ['B', 'G#m', 'E', 'F#'],
    ['F#', 'D#m', 'B', 'C#'], ['Db', 'Bbm', 'Gb', 'Ab'], ['Ab', 'Fm', 'Db', 'Eb'],
    ['Eb', 'Cm', 'Ab', 'Bb'], ['Bb', 'Gm', 'Eb', 'F'], ['F', 'Dm', 'Bb', 'C'],
  ];
  const roots = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C#', 'D#', 'F#', 'G#', 'A#', 'Db', 'Eb', 'Gb', 'Ab', 'Bb'];
  return splitHomeworkDecks({ decks: [
    { id: '145', name: '1–4–5', description: '大调的主、下属与属和弦', kind: 'chord', options: roots, cards: keys.map(([cue, , four, five]) => ({ id: `145-${cue}`, question: [cue], answer: [four, five] })) },
    { id: '1645', name: '1–6–4–5', description: '加入六级小和弦，练习常见进行', kind: 'chord', options: roots.flatMap(root => [root, root + 'm']), cards: keys.map(([cue, six, four, five]) => ({ id: `1645-${cue}`, question: [cue], answer: [six, four, five] })) },
  ], progress: {}, selected: ['145'], settings: { sound: true, includeQuestion: true, lang: 'zh' } });
}

// Split the original decks once, retaining card IDs, option banks and learning records
export function splitHomeworkDecks(data) {
  const otherKeys = ['F#', 'Db', 'Ab', 'Eb', 'Bb'];
  const defaults = { '145': '大调的主、下属与属和弦', '1645': '加入六级小和弦，练习常见进行' };
  data.decks = data.decks.flatMap(deck => {
    if (!Object.hasOwn(defaults, deck.id)) return [deck];
    return [
      { ...deck, id: `${deck.id}-homework`, name: `${deck.name} · 自然音主音`, description: deck.description === defaults[deck.id] ? 'C · G · D · A · E · B · F' : deck.description, cards: deck.cards.filter(card => !otherKeys.includes(card.question[0])) },
      { ...deck, id: `${deck.id}-other`, name: `${deck.name} · 升降音主音`, description: deck.description === defaults[deck.id] ? 'F♯ · D♭ · A♭ · E♭ · B♭' : deck.description, options: [...deck.options], cards: deck.cards.filter(card => otherKeys.includes(card.question[0])) },
    ];
  });
  data.selected = data.selected.map(id => Object.hasOwn(defaults, id) ? `${id}-homework` : id);
  // Rename only the former built-in labels, leaving custom names untouched
  const oldNames = { '145-homework': '1–4–5 · 老师作业', '145-other': '1–4–5 · 其余五调', '1645-homework': '1–6–4–5 · 老师作业', '1645-other': '1–6–4–5 · 其余五调' };
  for (const deck of data.decks) {
    if (deck.name === oldNames[deck.id]) deck.name = deck.name.replace('老师作业', '自然音主音').replace('其余五调', '升降音主音');
  }
  return data;
}

// Parse chord names into pitch classes and intervals for grading and playback
export function parseChord(value) {
  const match = value.trim().replaceAll('♯', '#').replaceAll('♭', 'b').toLowerCase().match(/^([a-g])([#b]?)(maj7|m7b5|dim7|m7|dim|aug|sus2|sus4|maj|m|7)?$/);
  if (!match) return null;
  const [, letter, accidental, quality = ''] = match;
  const pitch = (({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[letter]) + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;
  const intervals = { '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9] }[quality];
  return { pitch, intervals, name: letter.toUpperCase() + accidental + (quality === 'maj' ? '' : quality) };
}

// Voice I-IV-V and I-vi-IV-V using the taught five-string and six-string guitar shapes
export function chordVoicings(names) {
  const chords = names.map(parseChord);
  const tonic = 48 + chords[0].pitch;
  const degrees = chords.map(chord => (chord.pitch - chords[0].pitch + 12) % 12).join(',');
  const qualities = chords.map(chord => chord.intervals.join(',')).join(';');
  const is145 = degrees === '0,5,7' && qualities === '0,4,7;0,4,7;0,4,7';
  const is1645 = degrees === '0,9,5,7' && qualities === '0,4,7;0,3,7;0,4,7;0,4,7';
  if (is145 || is1645) {
    const shapes = [[0, 7, 12, 16, 19], [-7, 0, 5, 9, 12, 17], [-5, 2, 7, 11, 14, 19]];
    if (is1645) shapes.splice(1, 0, [-3, 4, 9, 12, 16, 21]);
    return shapes.map(shape => shape.map(semitones => tonic + semitones));
  }
  return chords.map(chord => [48 + chord.pitch, ...chord.intervals.map(n => 60 + chord.pitch + n)]);
}

// Accept common separators without weakening chord-quality checks
export function tokens(value) {
  return value.trim().split(/[\s,，、;；\-–—→]+/).filter(Boolean);
}

// Distinguish exact spelling, enharmonic equivalents, and incorrect answers
export function grade(input, answer, kind) {
  const entered = input;
  const expected = answer;
  const marks = expected.map((name, i) => {
    if (kind === 'text') return (entered[i] || '').trim().toLowerCase() === name.toLowerCase() ? 'correct' : 'wrong';
    const a = parseChord(entered[i] || '');
    const b = parseChord(name);
    if (!a || !b || a.pitch !== b.pitch || a.intervals.join() !== b.intervals.join()) return 'wrong';
    return a.name === b.name ? 'correct' : 'equivalent';
  });
  return { status: entered.length !== expected.length || marks.includes('wrong') ? 'wrong' : marks.includes('equivalent') ? 'equivalent' : 'correct', marks };
}

// Match input against the option bank while keeping longer shared prefixes editable
export function editSequence(state, key, options, kind) {
  const values = [...state.values];
  let active = state.active;
  const normalize = text => kind === 'chord' ? text.replaceAll('♯', '#').replaceAll('♭', 'b') : text.toLowerCase();
  const exact = text => options.find(option => normalize(option) === normalize(text));
  const prefix = text => options.some(option => normalize(option).startsWith(normalize(text)));
  if (key === 'Backspace') {
    active = Math.min(active, values.length - 1);
    if (!values[active] && active > 0) active--;
    values[active] = [...values[active]].slice(0, -1).join('');
    return { values, active };
  }
  if (key === 'Delete') { if (active < values.length) values[active] = ''; return { values, active }; }
  if (key === 'ArrowLeft') return { values, active: Math.max(0, active - 1) };
  if (key === 'ArrowRight') return { values, active: Math.min(values.length, active + 1) };
  if (key.length > 1) return state;
  // Extend the previous matched value when a suffix still belongs to that option
  if (active > 0 && (active === values.length || !values[active]) && values[active - 1] && prefix(values[active - 1] + key)) active--;
  if (active === values.length) return { values, active };
  // A manually revisited complete value starts the next field on a new option
  if (exact(values[active]) && !prefix(values[active] + key) && !/\s/.test(key)) {
    active++;
    if (active === values.length) return { values, active };
  }
  if (!values[active] && /\s/.test(key)) return { values, active };
  const candidate = values[active] + key;
  // Resolve an abandoned longer prefix into the previous complete option and new input
  if (!prefix(candidate)) {
    const boundary = options.filter(option => normalize(candidate).startsWith(normalize(option))).sort((a, b) => b.length - a.length)[0];
    if (boundary && candidate.length > boundary.length && active + 1 < values.length) {
      values[active] = boundary;
      let next = { values, active: active + 1 };
      for (const char of candidate.slice(boundary.length).trimStart()) next = editSequence(next, char, options, kind);
      return next;
    }
  }
  values[active] = candidate;
  const matched = exact(values[active]);
  if (matched) { values[active] = matched; active++; }
  return { values, active };
}

// Schedule repeated errors sooner and consecutive successes farther apart
export function updatedProgress(previous, status, now) {
  const p = previous || { correct: 0, wrong: 0, equivalent: 0, streak: 0, due: 0 };
  const streak = status === 'correct' ? p.streak + 1 : status === 'wrong' ? 0 : p.streak;
  const intervals = [0, 10 * 60000, 86400000, 3 * 86400000, 7 * 86400000, 14 * 86400000, 30 * 86400000];
  return { correct: p.correct + (status === 'correct' ? 1 : 0), wrong: p.wrong + (status === 'wrong' ? 1 : 0), equivalent: p.equivalent + (status === 'equivalent' ? 1 : 0), streak, due: now + (status === 'wrong' ? 60000 : status === 'equivalent' ? 10 * 60000 : intervals[Math.min(streak, 6)]) };
}

// Prioritize scheduled session retries, then sample with error-sensitive weights
export function chooseCard(cards, progress, retries, step, recent, now, random = Math.random) {
  const avoid = cards.length === 1 ? [] : recent.slice(-Math.min(2, cards.length - 1));
  let available = cards.filter(c => !avoid.includes(c.id));
  const dueRetries = available.filter(c => retries[c.id] !== undefined && retries[c.id] <= step);
  if (dueRetries.length) return dueRetries.reduce((a, b) => retries[a.id] <= retries[b.id] ? a : b);
  const ready = available.filter(c => retries[c.id] === undefined || retries[c.id] <= step);
  if (ready.length) available = ready;
  const weights = available.map(c => {
    const p = progress[c.id];
    return p ? (1 + Math.min(p.wrong, 5) * 2 + (p.due <= now ? 4 : 0)) / (1 + p.streak * 2) : 5;
  });
  let pick = random() * weights.reduce((a, b) => a + b, 0);
  return available.find((c, i) => (pick -= weights[i]) < 0) || available.at(-1);
}

// Validate imported user data before replacing a working library
export function validateData(data) {
  if (!data || !Array.isArray(data.decks) || !data.progress || typeof data.progress !== 'object' || Array.isArray(data.progress) || !Array.isArray(data.selected) || !data.settings) throw Error('备份格式不正确');
  const ids = new Set();
  for (const deck of data.decks) {
    if (typeof deck.id !== 'string' || ids.has(deck.id) || typeof deck.name !== 'string' || !deck.name.trim() || typeof deck.description !== 'string' || !['chord', 'text'].includes(deck.kind) || !Array.isArray(deck.cards) || !Array.isArray(deck.options) || !deck.options.every(v => typeof v === 'string' && v.trim() === v && v.length > 0) || new Set(deck.options.map(v => v.toLowerCase())).size !== deck.options.length) throw Error('Deck 格式不正确');
    if (deck.kind === 'chord' && !deck.options.every(parseChord)) throw Error('选项含不支持的和弦名称');
    ids.add(deck.id);
    for (const card of deck.cards) {
      if (typeof card.id !== 'string' || ids.has(card.id) || !Array.isArray(card.question) || !card.question.length || !Array.isArray(card.answer) || !card.answer.length || ![...card.question, ...card.answer].every(value => deck.options.includes(value))) throw Error('题目必须使用卡组选项');
      ids.add(card.id);
    }
  }
  for (const p of Object.values(data.progress)) {
    if (!p || !['correct', 'wrong', 'equivalent', 'streak', 'due'].every(k => Number.isFinite(p[k]) && p[k] >= 0)) throw Error('练习记录格式不正确');
  }
  if (!data.selected.every(id => data.decks.some(d => d.id === id)) || typeof data.settings.sound !== 'boolean' || typeof data.settings.includeQuestion !== 'boolean' || !['zh', 'en'].includes(data.settings.lang)) throw Error('练习设置格式不正确');
  return data;
}
