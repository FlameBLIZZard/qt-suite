/* Beam polish pass: Ink Arcade microanimations layered on top of app.js / extras.js without touching their logic. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const restart = (node, cls) => { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
const COLORS = ['var(--qt-beam)', '#4dc3ff', 'var(--qt-soundboard)', 'var(--qt-warn)', 'var(--qt-fg)'];

/* ink burst from the middle of a node */
function burst(node, n = 9) {
  if (calm || !node || document.hidden) return;
  const r = node.getBoundingClientRect();
  if (!r.width) return;
  const b = document.createElement('div');
  b.className = 'ink-burst';
  b.style.left = r.left + r.width / 2 + 'px'; b.style.top = r.top + r.height / 2 + 'px';
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * .5, d = 34 + Math.random() * 30;
    const p = document.createElement('i');
    p.style.setProperty('--x', Math.cos(a) * d + 'px'); p.style.setProperty('--y', Math.sin(a) * d + 'px');
    p.style.setProperty('--r', (Math.random() * 240 - 120) + 'deg');
    p.style.background = COLORS[i % COLORS.length];
    p.style.animationDelay = Math.random() * 60 + 'ms';
    b.append(p);
  }
  document.body.append(b);
  setTimeout(() => b.remove(), 900);
}
window.Beam && (window.Beam.burst = burst);

/* tab pill squashes as it slides */
const pill = $('#tabPill');
let pillAt = null;
if (pill) new MutationObserver(() => {
  const at = pill.style.transform;
  if (pillAt !== null && at !== pillAt) restart(pill, 'squash');
  pillAt = at;
}).observe(pill, {attributes: true, attributeFilter: ['style']});

/* download icons dip when tapped */
document.addEventListener('click', e => {
  const a = e.target.closest('a.icon-btn[download]');
  if (a) { restart(a, 'dl-go'); setTimeout(() => a.classList.remove('dl-go'), 600); }
}, true);

/* drop zone arrow launches when a batch starts sending */
const drop = $('#drop');
if (drop) new MutationObserver(() => {
  if (drop.classList.contains('burst')) { restart(drop, 'launch'); setTimeout(() => drop.classList.remove('launch'), 750); }
}).observe(drop, {attributes: true, attributeFilter: ['class']});

/* transfers: burst when a row turns done */
const tr = $('#transfers');
if (tr) new MutationObserver(muts => {
  for (const m of muts) {
    const n = m.target;
    if (m.type === 'attributes' && n.classList && n.classList.contains('done') && !n._burst) {
      n._burst = true; burst(n.querySelector('.thumb') || n);
    }
  }
}).observe(tr, {subtree: true, attributes: true, attributeFilter: ['class']});

/* connection chip pops when the PC answers again */
const chip = $('#linkChip');
let wasOn = null;
if (chip) new MutationObserver(() => {
  const on = chip.classList.contains('on');
  if (wasOn === false && on) { restart(chip, 'pop'); burst(chip.querySelector('.dot'), 6); }
  wasOn = on;
}).observe(chip, {attributes: true, attributeFilter: ['class']});

/* small text counters bump when they change */
function bumpOnChange(sel) {
  const node = $(sel); if (!node) return;
  let last = node.textContent;
  new MutationObserver(() => {
    const now = node.textContent;
    if (now && now !== last && last) restart(node, 'bump');
    last = now;
  }).observe(node, {childList: true, characterData: true, subtree: true});
}
['#itemsHint', '#vaultCount'].forEach(bumpOnChange);

/* card titles nudge when new rows land in them */
function freshOnAdd(listSel) {
  const list = $(listSel); if (!list) return;
  const card = list.closest('.card');
  let ready = false; setTimeout(() => { ready = true; }, 1500);
  new MutationObserver(muts => {
    if (!ready || !muts.some(m => [...m.addedNodes].some(x => x.classList && x.classList.contains('enter')))) return;
    restart(card, 'fresh'); setTimeout(() => card.classList.remove('fresh'), 600);
  }).observe(list, {childList: true});
}
['#items', '#notes', '#clips'].forEach(freshOnAdd);

/* remote: the play button beats */
const play = document.querySelector('.round.big[data-k=play]');
if (play) play.addEventListener('pointerdown', () => { restart(play, 'playing'); setTimeout(() => play.classList.remove('playing'), 520); });
})();
