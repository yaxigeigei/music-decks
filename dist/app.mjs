import { initialData, splitHomeworkDecks, parseChord, chordVoicings, grade, editSequence, updatedProgress, chooseCard, validateData } from './core.mjs';

// Persist authored decks and learning history independently from the active session
const storageKey = 'music-decks-v1';
const saved = localStorage.getItem(storageKey);
let data = saved ? splitHomeworkDecks(validateData(JSON.parse(saved))) : initialData();
// Persist requested built-in deck updates without resetting progress
if (saved && JSON.stringify(data) !== saved) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}
let libraryId = data.decks[0]?.id;
let run = null, current, result, entry, edit, confirmation, toastTimer, audioContext;
let focusingEntry = false;
let voices = [];
const $ = id => document.getElementById(id);
const t = (zh, en) => data.settings.lang === 'zh' ? zh : en;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Surface persistence errors instead of silently discarding user work
function save() { localStorage.setItem(storageKey, JSON.stringify(data)); }
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000);
}
function confirmAction(title, body, action) {
  $('confirm-title').textContent = title; $('confirm-body').textContent = body;
  confirmation = action; $('confirm-dialog').showModal();
}

// Translate controls while preserving all user-authored labels
const copy = [
  ['practice-tab', '练习', 'Practice'], ['library-tab', '题库', 'Library'],
  ['saved-label', '● 本地保存', '● Saved locally'], ['welcome', '一点一点，练成直觉。', 'A little practice. A lasting memory.'],
  ['choose-title', '选择卡组', 'Choose your decks'], ['select-all', '全选', 'Select all'],
  ['start', '开始练习 →', 'Start practicing →'], ['manage-link', '＋ 管理题库与自定义卡组', '＋ Manage cards & custom decks'],
  ['end-session', '← 结束练习', '← End practice'], ['question-label', '完成答案序列', 'COMPLETE THE ANSWER SEQUENCE'],
  ['question-play', '▷ 播放题目', '▷ Play question'], ['auto-sound-label', '提交后自动播放', 'Auto-play after checking'],
  ['include-question-label', '播放时包含题目', 'Include question in playback'],
  ['backspace', '⌫ 退格', '⌫ Backspace'], ['clear-answer', '清空', 'Clear'], ['skip', '暂时想不起来', 'Show the answer'],
  ['full-play', '▷ 播放正确答案', '▷ Play correct answer'], ['infinite-label', '无限循环 · 随时结束', 'Continuous practice · Stop anytime'],
  ['result-title', '今天，又熟悉了一点。', 'A little more familiar.'], ['retry-errors', '继续练错题', 'Practice missed cards'],
  ['back-setup', '返回选择卡组 →', 'Choose decks →'], ['library-title', '你的题库。', 'Your library.'],
  ['new-deck', '＋ 新建卡组', '＋ New deck'], ['backup-description', '题库与进度保存在当前浏览器，不跨设备自动同步。', 'Your library and progress stay in this browser. No automatic device sync.'],
  ['export', '导出备份', 'Export backup'], ['import', '导入备份', 'Import backup'], ['footer-copy', '一点一点，让陌生变熟悉。', 'A little practice goes a long way.'],
  ['cancel-editor', '取消', 'Cancel'], ['save-editor', '保存', 'Save'], ['confirm-cancel', '取消', 'Cancel'], ['confirm-ok', '确认', 'Confirm'],
];
function translate() {
  document.documentElement.lang = data.settings.lang === 'zh' ? 'zh-CN' : 'en';
  copy.forEach(([id, zh, en]) => $(id).textContent = t(zh, en));
  $('language').textContent = t('EN', '中文'); $('language').setAttribute('aria-label', t('切换到英文', 'Switch to Chinese'));
  $('close-editor').setAttribute('aria-label', t('关闭', 'Close')); document.querySelector('nav').setAttribute('aria-label', t('主导航', 'Main navigation'));
  renderSetup(); renderLibrary();
  if (run && !$('session').hidden) renderQuestion(false);
  if (run && !$('results').hidden) renderResults();
}
function deckTitle(deck) {
  const standard = { '145-homework': '1–4–5 · 自然音主音', '145-other': '1–4–5 · 升降音主音', '1645-homework': '1–6–4–5 · 自然音主音', '1645-other': '1–6–4–5 · 升降音主音' };
  if (data.settings.lang === 'en' && deck.name === standard[deck.id]) return deck.name.replace('自然音主音', 'Natural tonics').replace('升降音主音', 'Sharp/flat tonics');
  return deck.name;
}

// Use every card in the selected decks without a second range filter
function pool() { return data.decks.filter(d => data.selected.includes(d.id)).flatMap(deck => deck.cards.map(card => ({ ...card, deckId: deck.id, kind: deck.kind }))); }
function renderSetup() {
  $('deck-selection').innerHTML = data.decks.length ? data.decks.map((deck, i) => `<label class="deck-option ${data.selected.includes(deck.id) ? 'selected' : ''}"><input type="checkbox" data-select="${escape(deck.id)}" ${data.selected.includes(deck.id) ? 'checked' : ''}><span class="deck-art" aria-hidden="true">${deck.kind === 'chord' ? (i % 2 ? '♬' : '♮') : 'Aa'}</span><div class="deck-info"><h3>${escape(deckTitle(deck))}</h3><p>${escape(deck.description)}</p><small>${deck.cards.length} ${t('题', 'cards')} · ${deck.options.length} ${t('个选项', 'options')}</small></div></label>`).join('') : `<p class="empty">${t('还没有卡组，先到题库创建一个吧。', 'No decks yet. Create one in the library.')}</p>`;
  const cards = pool(); $('pool-count').textContent = t(`已选 ${data.selected.length} 个卡组 · ${cards.length} 道题`, `${data.selected.length} decks selected · ${cards.length} cards`); $('start').disabled = !cards.length;
}

// Play only recognizable chords with a synthesized keyboard timbre
function stopAudio() { voices.forEach(osc => osc.stop()); voices = []; }
async function play(names, from = 0, to = names.length) {
  const chords = names.map(parseChord);
  if (!chords.length || chords.some(chord => !chord)) { toast(t('这组文字选项不提供音频。', 'Audio is not available for these text options.')); return; }
  audioContext ||= new AudioContext(); await audioContext.resume(); stopAudio();
  const start = audioContext.currentTime + .04;
  chordVoicings(names).slice(from, to).forEach((notes, i) => {
    notes.forEach((midi, j) => [1, 2, 3].forEach((harmonic, h) => {
      const osc = audioContext.createOscillator(), gain = audioContext.createGain(), at = start + i * .85 + j * .013;
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12) * harmonic;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.11 / notes.length / (h + 1) ** 2, at + .015); gain.gain.exponentialRampToValueAtTime(.0001, at + .82);
      osc.connect(gain).connect(audioContext.destination); osc.start(at); osc.stop(at + .85); voices.push(osc);
      osc.onended = () => { voices = voices.filter(v => v !== osc); osc.disconnect(); gain.disconnect(); };
    }));
  });
}

// Keep the same voicing whether playback includes the question or only the answer
function playAnswer() {
  const hasChordQuestion = current.question.every(parseChord);
  const names = hasChordQuestion ? [...current.question, ...current.answer] : current.answer;
  const from = hasChordQuestion && !data.settings.includeQuestion ? current.question.length : 0;
  play(names, from);
}

// Draw an endless session until the user explicitly ends it
function startSession(cards = pool()) {
  stopAudio(); run = { cards, step: 0, correct: 0, equivalent: 0, wrong: 0, errors: new Set(), retries: {}, recent: [] };
  $('setup').hidden = $('results').hidden = true; $('session').hidden = false; nextCard();
}
function nextCard() {
  stopAudio(); current = chooseCard(run.cards, data.progress, run.retries, run.step, run.recent, Date.now());
  delete run.retries[current.id]; run.recent = [...run.recent.slice(-1), current.id]; result = null;
  entry = { values: current.answer.map(() => ''), active: 0 }; renderQuestion(true);
}
function renderQuestion(focus) {
  const deck = data.decks.find(d => d.id === current.deckId);
  $('question-deck').textContent = deckTitle(deck); $('review-badge').textContent = data.progress[current.id]?.wrong ? t('错题复习', 'Review card') : t('记忆卡片', 'Recall card');
  $('question-text').textContent = current.question.join(' · '); $('answer-slots').setAttribute('aria-label', t('答案序列', 'Answer sequence'));
  $('auto-sound').checked = data.settings.sound; $('include-question').checked = data.settings.includeQuestion;
  const playable = current.answer.every(parseChord);
  $('auto-sound').disabled = !playable; $('include-question').disabled = !playable || !current.question.every(parseChord);
  $('question-play').hidden = !current.question.every(parseChord); $('full-play').hidden = !result || !playable;
  $('full-play').textContent = data.settings.includeQuestion && current.question.every(parseChord) ? t('▷ 播放题目与正确答案 · P', '▷ Play question & correct answer · P') : t('▷ 播放正确答案 · P', '▷ Play correct answer · P');
  $('full-play').setAttribute('aria-keyshortcuts', 'P');
  $('skip').hidden = !!result; $('submit').textContent = result ? t('下一题 ↵', 'Next card ↵') : t('检查答案 ↵', 'Check answer ↵');
  $('session-count').textContent = t(`已答 ${run.step} 题`, `${run.step} answered`); $('session-score').textContent = t(`正确 ${run.correct} · 等音 ${run.equivalent} · 待巩固 ${run.wrong}`, `Correct ${run.correct} · Enharmonic ${run.equivalent} · Missed ${run.wrong}`);
  $('sequence-actions').hidden = $('virtual-keyboard').hidden = !!result;
  // Lay the complete bank out in four rows with direct one-click entry
  $('virtual-keyboard').className = 'option-keyboard'; $('virtual-keyboard').style.setProperty('--columns', Math.ceil(deck.options.length / 4));
  $('virtual-keyboard').innerHTML = deck.options.map((option, i) => `<button type="button" class="option-key" data-option="${i}">${escape(option)}</button>`).join('');
  renderEntry(focus); renderFeedback();
}
function renderEntry(focus) {
  const deck = data.decks.find(d => d.id === current.deckId);
  $('answer-slots').innerHTML = entry.values.map((value, i) => `<input class="answer-slot ${entry.active === i ? 'active' : ''} ${result ? result.marks[i] || 'wrong' : ''}" data-slot="${i}" value="${escape(value)}" aria-label="${t('答案', 'Answer')} ${i + 1}" placeholder="${i + 1}" autocomplete="off" autocapitalize="off" spellcheck="false" ${result ? 'readonly' : ''} style="--slot-size:${Math.max(3, Math.min(16, value.length + 1))}ch">`).join('');
  $('answer-slots').classList.toggle('text-sequence', deck.kind === 'text');
  if (focus && !result) { const field = $('answer-slots').querySelector(`[data-slot="${Math.min(entry.active, entry.values.length - 1)}"]`); focusingEntry = true; field.focus({ preventScroll: true }); focusingEntry = false; field.setSelectionRange(field.value.length, field.value.length); }
}
function renderFeedback() {
  $('feedback').innerHTML = ''; $('feedback').className = ''; if (!result) return;
  $('feedback').className = result.status;
  const title = result.status === 'correct' ? t('✓ 正确。', '✓ Correct.') : result.status === 'equivalent' ? t('≈ 音高正确，注意拼写。', '≈ Correct pitches. Check the spelling.') : t('这题稍后再来。', 'This card will return soon.');
  $('feedback').innerHTML = `<b>${title}</b><p>${t('正确答案', 'Expected answer')}：${current.answer.map((value, i) => `<span class="answer-chip ${result.marks[i] || ''}">${escape(value)}</span>`).join(' ')}</p>${result.status === 'wrong' ? `<p>${t('已记录并提高后续出现概率。', 'Saved for review with higher future priority.')}</p>` : ''}`;
}
function checkAnswer(skipped = false) {
  if (result) { nextCard(); return; }
  if (!skipped && entry.values.some(value => !value.trim())) { toast(t('请填完答案，或选择“暂时想不起来”。', 'Complete the sequence or choose “Show the answer”.')); return; }
  result = skipped ? { status: 'wrong', marks: [] } : grade(entry.values, current.answer, current.kind);
  run[result.status]++; data.progress[current.id] = updatedProgress(data.progress[current.id], result.status, Date.now());
  if (result.status === 'wrong') { run.errors.add(current.id); run.retries[current.id] = run.step + 3; }
  if (result.status === 'equivalent') run.retries[current.id] = run.step + 5;
  run.step++; save(); renderQuestion(false); $('submit').focus({ preventScroll: true });
  if (data.settings.sound && current.answer.every(parseChord)) playAnswer();
}
function finishSession() { stopAudio(); $('session').hidden = true; $('results').hidden = false; renderResults(); }
function renderResults() {
  $('results-message').textContent = t(`已完成 ${run.step} 次作答，进度已保存。`, `${run.step} answers completed. Progress saved.`);
  $('result-stats').innerHTML = [[run.correct, t('正确', 'Correct')], [run.equivalent, t('等音正确', 'Enharmonic')], [run.wrong, t('需要巩固', 'Missed')]].map(([n, label]) => `<div><strong>${n}</strong><span>${label}</span></div>`).join('');
  $('result-errors').innerHTML = run.cards.filter(c => run.errors.has(c.id)).map(c => `<div class="error-row"><span>${escape(c.question.join(' · '))} · ${escape(deckTitle(data.decks.find(d => d.id === c.deckId)))}</span><b>${escape(c.answer.join(' · '))}</b></div>`).join(''); $('retry-errors').hidden = !run.errors.size;
}

// Route typing, paste and composition through one option matcher
// Handle feedback shortcuts without activating the focused control
document.addEventListener('keydown', event => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || !result || $('session').hidden || document.querySelector('dialog[open]')) return;
  const replay = event.key.toLowerCase() === 'p' && !$('full-play').hidden;
  if (event.key !== 'Enter' && !replay) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  if (replay) $('full-play').click();
  else nextCard();
}, true);

function inputKeys(text) {
  const deck = data.decks.find(d => d.id === current.deckId);
  for (const char of text) entry = editSequence(entry, char, deck.options, deck.kind);
  renderEntry(true);
}
$('answer-slots').addEventListener('focusin', event => {
  const index = Number(event.target.dataset.slot); if (!Number.isInteger(index) || result || focusingEntry) return;
  entry.active = index;
});
$('answer-slots').onclick = event => { if (event.target.dataset.slot !== undefined && !result) { entry.active = Number(event.target.dataset.slot); renderEntry(true); } };
$('answer-slots').addEventListener('keydown', event => {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) checkAnswer(); return; } if (result) return;
  if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const deck = data.decks.find(d => d.id === current.deckId); entry = editSequence(entry, event.key, deck.options, deck.kind); renderEntry(true); }
  else if (event.key.length === 1) {
    event.preventDefault(); const field = event.target;
    if (field.selectionStart === 0 && field.selectionEnd === field.value.length && field.value) { entry.active = Number(field.dataset.slot); entry.values[entry.active] = ''; }
    inputKeys(event.key);
  }
});
$('answer-slots').addEventListener('paste', event => {
  if (result) return; event.preventDefault(); const field = event.target;
  if (field.selectionStart === 0 && field.selectionEnd === field.value.length && field.value) { entry.active = Number(field.dataset.slot); entry.values[entry.active] = ''; }
  inputKeys(event.clipboardData.getData('text'));
});
$('answer-slots').addEventListener('input', event => { if (result || event.isComposing) return; entry.active = Number(event.target.dataset.slot); entry.values[entry.active] = ''; inputKeys(event.target.value); });
$('answer-slots').addEventListener('compositionend', event => { entry.active = Number(event.target.dataset.slot); entry.values[entry.active] = ''; inputKeys(event.target.value); });
$('virtual-keyboard').onclick = event => {
  const button = event.target.closest('[data-option]'); if (!button || result) return;
  const deck = data.decks.find(d => d.id === current.deckId);
  if (entry.active === entry.values.length) { toast(t('答案已填满。点击某一格可修改。', 'All fields are filled. Select a field to change it.')); return; }
  entry.values[entry.active++] = deck.options[Number(button.dataset.option)]; renderEntry(false);
};
$('virtual-keyboard').onkeydown = event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) checkAnswer(); }
  else if (event.key === 'Backspace') { event.preventDefault(); const deck = data.decks.find(d => d.id === current.deckId); entry = editSequence(entry, event.key, deck.options, deck.kind); renderEntry(true); }
  else if (event.key.length === 1) { event.preventDefault(); inputKeys(event.key); }
};

// Expose the option bank before the deck's authored cards
function renderLibrary() {
  const deck = data.decks.find(d => d.id === libraryId);
  $('library-decks').innerHTML = data.decks.map(d => `<button class="library-deck ${d.id === libraryId ? 'active' : ''}" data-library-deck="${escape(d.id)}"><b>${escape(deckTitle(d))}</b><small>${d.cards.length} ${t('题', 'cards')} · ${d.options.length} ${t('选项', 'options')}</small></button>`).join('');
  if (!deck) { $('library-content').innerHTML = `<p class="empty">${t('先创建一个卡组。', 'Create a deck to begin.')}</p>`; return; }
  $('library-content').innerHTML = `<div class="library-head"><div><h2>${escape(deckTitle(deck))}</h2><p>${escape(deck.description)}</p></div><button class="text-button" data-action="edit-deck">${t('编辑卡组', 'Edit deck')}</button></div><div class="bank-heading"><h3>${t('选项库', 'Option bank')} <span class="muted">${deck.options.length}</span></h3><button class="secondary" data-action="edit-options">${t('编辑选项', 'Edit options')}</button></div><div class="bank-preview">${deck.options.map(o => `<span>${escape(o)}</span>`).join('') || `<p class="muted">${t('先定义选项，才能添加题目。', 'Define options before adding cards.')}</p>`}</div><div class="bank-heading"><h3>${t('题目', 'Cards')} <span class="muted">${deck.cards.length}</span></h3><button class="secondary" data-action="add-card" ${deck.options.length ? '' : 'disabled'}>＋ ${t('添加题目', 'Add card')}</button></div>${deck.cards.length ? `<div class="table-wrap"><table><thead><tr><th>${t('题目', 'Question')}</th><th>${t('答案序列', 'Answer sequence')}</th><th>${t('对 / 错', 'Right / Wrong')}</th><th>${t('操作', 'Actions')}</th></tr></thead><tbody>${deck.cards.map(c => { const p = data.progress[c.id]; return `<tr><td>${escape(c.question.join(' · '))}</td><td>${escape(c.answer.join(' · '))}</td><td>${p?.correct || 0} / ${p?.wrong || 0}</td><td><button class="row-button" data-action="edit-card" data-card="${escape(c.id)}">${t('编辑', 'Edit')}</button><button class="row-button danger" data-action="delete-card" data-card="${escape(c.id)}">${t('删除', 'Delete')}</button></td></tr>`; }).join('')}</tbody></table></div>` : `<p class="empty">${t('还没有题目。', 'No cards yet.')}</p>`}<div class="library-actions bottom-actions"><button class="text-button" data-action="reset-deck">${t('重置进度', 'Reset progress')}</button><button class="text-button danger" data-action="delete-deck">${t('删除卡组', 'Delete deck')}</button></div>`;
}
function openEditor(type, cardId) {
  const deck = data.decks.find(d => d.id === libraryId), card = deck?.cards.find(c => c.id === cardId);
  edit = { type, deckId: libraryId, cardId, question: [...(card?.question || [])], answer: [...(card?.answer || [])], target: 'question' };
  $('editor-title').textContent = type === 'new-deck' ? t('新建卡组', 'New deck') : type === 'edit-deck' ? t('编辑卡组', 'Edit deck') : type === 'edit-options' ? t('编辑选项库', 'Edit option bank') : card ? t('编辑题目', 'Edit card') : t('添加题目', 'Add card'); $('editor-error').textContent = '';
  if (type.endsWith('deck')) {
    $('editor-fields').innerHTML = `<label class="field-label" for="edit-name">${t('名称', 'Name')}</label><input id="edit-name" required maxlength="80" value="${escape(type === 'new-deck' ? '' : deck.name)}"><label class="field-label" for="edit-description">${t('说明', 'Description')}</label><input id="edit-description" maxlength="180" value="${escape(type === 'new-deck' ? '' : deck.description)}"><label class="field-label" for="edit-kind">${t('判分方式', 'Grading mode')}</label><select id="edit-kind" ${type === 'edit-deck' ? 'disabled' : ''}><option value="chord">${t('和弦 · 识别等音异名', 'Chords · recognize enharmonic equivalents')}</option><option value="text">${t('通用 · 匹配文字选项', 'General · match text options')}</option></select>`;
    if (type === 'edit-deck') $('edit-kind').value = deck.kind;
  } else if (type === 'edit-options') {
    $('editor-fields').innerHTML = `<label class="field-label" for="edit-options">${t('每行一个选项', 'One option per line')}</label><textarea id="edit-options" rows="12" spellcheck="false">${escape(deck.options.join('\n'))}</textarea>`;
  } else renderCardEditor();
  $('editor').showModal();
}
function renderCardEditor() {
  const deck = data.decks.find(d => d.id === edit.deckId);
  $('editor-fields').innerHTML = `${['question', 'answer'].map(part => `<div class="compose-field ${edit.target === part ? 'selected' : ''}"><button type="button" class="compose-label" data-target="${part}">${part === 'question' ? t('题目', 'Question') : t('答案序列', 'Answer sequence')} ${edit.target === part ? '●' : ''}</button><div class="chosen-options">${edit[part].map((o, i) => `<button type="button" class="chosen-option" data-remove="${part}" data-index="${i}" aria-label="${t('移除', 'Remove')} ${escape(o)}">${escape(o)} ×</button>`).join('') || `<span class="muted small">${t('尚未添加', 'No items yet')}</span>`}</div></div>`).join('')}<div class="editor-options">${deck.options.map((o, i) => `<button type="button" class="option-key" data-pick="${i}">${escape(o)}</button>`).join('')}</div>`;
}
$('editor-fields').onclick = event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.target) edit.target = button.dataset.target;
  if (button.dataset.remove) edit[button.dataset.remove].splice(Number(button.dataset.index), 1);
  if (button.dataset.pick !== undefined) edit[edit.target].push(data.decks.find(d => d.id === edit.deckId).options[Number(button.dataset.pick)]);
  renderCardEditor();
};
$('editor-form').onsubmit = event => {
  event.preventDefault(); const deck = data.decks.find(d => d.id === edit.deckId);
  if (edit.type.endsWith('deck')) {
    const name = $('edit-name').value.trim(); if (!name) { $('editor-error').textContent = t('请填写名称。', 'Enter a name.'); return; }
    if (edit.type === 'new-deck') { const id = crypto.randomUUID(); data.decks.push({ id, name, description: $('edit-description').value.trim(), kind: $('edit-kind').value, options: [], cards: [] }); libraryId = id; data.selected.push(id); }
    else { deck.name = name; deck.description = $('edit-description').value.trim(); }
  } else if (edit.type === 'edit-options') {
    const options = $('edit-options').value.split('\n').map(v => v.trim()).filter(Boolean);
    if (new Set(options.map(v => v.toLowerCase())).size !== options.length) { $('editor-error').textContent = t('选项不能重复（忽略大小写）。', 'Options must be unique, ignoring case.'); return; }
    if (deck.kind === 'chord' && !options.every(parseChord)) { $('editor-error').textContent = t('请使用支持的和弦写法，如 C、F#m、Bb、Cdim；术语使用通用卡组。', 'Use chord names such as C, F#m, Bb, Cdim. Choose a general deck for terms.'); return; }
    const used = [...new Set(deck.cards.flatMap(c => [...c.question, ...c.answer]))].filter(o => !options.includes(o));
    if (used.length) { $('editor-error').textContent = t('以下选项仍在题目中使用：', 'These options are still used by cards: ') + used.join(', '); return; }
    deck.options = options;
  } else {
    if (!edit.question.length || !edit.answer.length) { $('editor-error').textContent = t('请从选项库填入题目和答案。', 'Choose options for both the question and answer.'); return; }
    if (edit.cardId) { const card = deck.cards.find(c => c.id === edit.cardId); if (JSON.stringify([card.question, card.answer]) !== JSON.stringify([edit.question, edit.answer])) delete data.progress[card.id]; Object.assign(card, { question: edit.question, answer: edit.answer }); }
    else deck.cards.push({ id: crypto.randomUUID(), question: edit.question, answer: edit.answer });
  }
  save(); $('editor').close(); renderLibrary(); renderSetup();
};

// Navigate without altering deck contents or starting any deployment
function showView(name) {
  stopAudio(); $('practice-view').hidden = name !== 'practice'; $('library-view').hidden = name !== 'library';
  $('practice-tab').classList.toggle('active', name === 'practice'); $('library-tab').classList.toggle('active', name === 'library');
  if (name === 'library') { run = null; current = null; $('session').hidden = $('results').hidden = true; $('setup').hidden = false; renderLibrary(); } else renderSetup();
}
$('practice-tab').onclick = () => showView('practice');
$('library-tab').onclick = $('manage-link').onclick = () => { if (run && !$('session').hidden) confirmAction(t('结束练习并打开题库？', 'End practice and open the library?'), t('已完成的作答会保留。', 'Completed answers remain saved.'), () => showView('library')); else showView('library'); };
$('deck-selection').onchange = event => { const id = event.target.dataset.select; if (!id) return; data.selected = event.target.checked ? [...data.selected, id] : data.selected.filter(x => x !== id); save(); renderSetup(); };
$('select-all').onclick = () => { data.selected = data.decks.map(d => d.id); save(); renderSetup(); };
$('start').onclick = () => startSession(); $('submit').onclick = () => checkAnswer(); $('skip').onclick = () => checkAnswer(true); $('end-session').onclick = finishSession;
$('auto-sound').onchange = () => { data.settings.sound = $('auto-sound').checked; if (!data.settings.sound) stopAudio(); save(); };
$('include-question').onchange = () => { data.settings.includeQuestion = $('include-question').checked; save(); renderQuestion(false); };
$('question-play').onclick = () => play(current.answer.every(parseChord) ? [...current.question, ...current.answer] : current.question, 0, current.question.length);
$('full-play').onclick = playAnswer;
$('backspace').onclick = () => { const deck = data.decks.find(d => d.id === current.deckId); entry = editSequence(entry, 'Backspace', deck.options, deck.kind); renderEntry(false); };
$('clear-answer').onclick = () => { entry = { values: current.answer.map(() => ''), active: 0 }; renderEntry(false); };
$('retry-errors').onclick = () => startSession(run.cards.filter(c => run.errors.has(c.id)));
$('back-setup').onclick = () => { run = null; current = null; $('results').hidden = true; $('setup').hidden = false; renderSetup(); };
$('language').onclick = () => { data.settings.lang = data.settings.lang === 'zh' ? 'en' : 'zh'; save(); translate(); };
$('new-deck').onclick = () => openEditor('new-deck'); $('close-editor').onclick = $('cancel-editor').onclick = () => $('editor').close();
$('confirm-cancel').onclick = () => $('confirm-dialog').close(); $('confirm-ok').onclick = () => { $('confirm-dialog').close(); confirmation(); };
$('library-decks').onclick = event => { const button = event.target.closest('[data-library-deck]'); if (button) { libraryId = button.dataset.libraryDeck; renderLibrary(); } };
$('library-content').onclick = event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action, deck = data.decks.find(d => d.id === libraryId);
  if (['add-card', 'edit-card', 'edit-deck', 'edit-options'].includes(action)) { openEditor(action, button.dataset.card); return; }
  confirmAction(action === 'delete-deck' ? t('删除卡组？', 'Delete deck?') : action === 'delete-card' ? t('删除题目？', 'Delete card?') : t('重置进度？', 'Reset progress?'), t('此操作不能撤销。可先导出备份。', 'This cannot be undone. Export a backup first if needed.'), () => {
    const ids = action === 'delete-card' ? [button.dataset.card] : deck.cards.map(c => c.id); ids.forEach(id => delete data.progress[id]);
    if (action === 'delete-card') deck.cards = deck.cards.filter(c => c.id !== button.dataset.card);
    if (action === 'delete-deck') { data.decks = data.decks.filter(d => d.id !== deck.id); data.selected = data.selected.filter(id => id !== deck.id); libraryId = data.decks[0]?.id; }
    save(); renderLibrary(); renderSetup();
  });
};

// Export complete local backups and validate references before replacing data
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `music-decks-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async () => {
  const file = $('import-file').files[0]; if (!file) return; let imported;
  try { imported = splitHomeworkDecks(validateData(JSON.parse(await file.text()))); } catch (error) { toast(t(`无法导入：${error.message}`, 'Import failed: invalid Music Decks backup.')); $('import-file').value = ''; return; }
  confirmAction(t('用备份替换题库与进度？', 'Replace library and progress?'), t(`将导入 ${imported.decks.length} 个卡组并替换当前记录。`, `Import ${imported.decks.length} decks and replace the current data.`), () => { data = imported; save(); libraryId = data.decks[0]?.id; run = null; current = null; $('session').hidden = $('results').hidden = true; $('setup').hidden = false; translate(); });
  $('import-file').value = '';
};
window.addEventListener('error', event => toast(t(`发生错误：${event.message}`, `Error: ${event.message}`)));
window.addEventListener('unhandledrejection', event => toast(t(`操作失败：${event.reason.message}`, `Operation failed: ${event.reason.message}`)));
translate();
