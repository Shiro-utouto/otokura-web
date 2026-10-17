// ミニプレーヤーと再生画面（ジャケット・歌詞・再生キュー）
import { h, icon, iconButton, cover, trackColors, actionSheet, dragToClose, toast } from './dom.js';
import * as store from '../store.js';
import * as player from '../player.js';
import { parseLrc, withoutCredits } from '../lrc.js';
import { litChars, currentIndex, chars } from '../karaoke.js';
import { formatDuration } from '../localFiles.js';
import { trackMenu, trackHeader, addToPlaylistFlow, editTrack, eq } from './common.js';
import { openLyricsSearch, openLyricsEditor, openSyncEditor, openOffsetSheet } from './lyricsTools.js';
import { openArtist } from './library.js';

const np = {
  el: null,
  mini: null,
  open: false,
  mode: 'art',
  trackId: null,
  lyrics: null, // { lines, synced } 表示用
  lyricsFor: null,
  lineEls: [],
  curIdx: -2,
  manualUntil: 0,
  touching: false,
  scrollY: 0,
  scrollV: 0,
  raf: 0,
  seeking: null,
};

try {
  np.mode = localStorage.getItem('otokura.npMode') || 'art';
  if (!['art', 'lyrics', 'queue'].includes(np.mode)) np.mode = 'art';
} catch {
  /* なし */
}

// ---------------- ミニプレーヤー ----------------
function buildMini() {
  const m = h('div.mini', { role: 'button', 'aria-label': '再生画面を開く' });
  m.addEventListener('click', (e) => {
    if (e.target.closest('.icon-btn')) return;
    openNowPlaying();
  });
  // 上にスワイプでも開く
  let sy = null;
  m.addEventListener('touchstart', (e) => (sy = e.touches[0].clientY), { passive: true });
  m.addEventListener(
    'touchend',
    (e) => {
      if (sy != null && sy - e.changedTouches[0].clientY > 30) openNowPlaying();
      sy = null;
    },
    { passive: true },
  );
  document.body.append(m);
  return m;
}

function renderMini() {
  const t = player.q.current;
  const m = np.mini;
  m.classList.toggle('show', !!t);
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  if (m.dataset.id !== t.id) {
    m.dataset.id = t.id;
    m.replaceChildren(
      cover(t),
      h('div.meta', h('div.t', t.title), h('div.a', t.artist || 'アーティスト不明')),
      (m._play = iconButton('play', '再生・一時停止', () => player.toggle())),
      iconButton('next', '次の曲', () => player.next()),
      h('div.bar', (m._bar = h('i'))),
    );
  } else {
    m.querySelector('.t').textContent = t.title;
    m.querySelector('.a').textContent = t.artist || 'アーティスト不明';
  }
  m._play.replaceChildren(icon(player.q.playing ? 'pause' : 'play'));
}

// ---------------- 再生画面 ----------------
function buildNp() {
  const el = h('div.np', { role: 'dialog', 'aria-label': '再生画面' });
  el.innerHTML = '';
  const bg = h('div.np-bg');
  const shade = h('div.np-shade');
  const handle = h('div.np-handle');
  const top = h(
    'div.np-top',
    iconButton('down', '閉じる', () => closeNowPlaying()),
    (np.badge = h('div', { style: { fontSize: '13px', color: 'rgba(255,255,255,.7)', fontWeight: 600 } })),
    iconButton('more', 'メニュー', () => npMenu()),
  );
  np.art = h('div.np-art-wrap');
  np.miniHead = h('div.np-mini-head');
  np.panel = h('div.np-panel');
  const main = h('div.np-main', np.art, np.miniHead, np.panel);
  np.info = h('div.np-info');
  np.err = h('div.err');

  // 再生位置のバー
  np.seekFill = h('i');
  np.seekEl = h('div.seek.no-drag', h('div.track-line', np.seekFill));
  np.tCur = h('span', '0:00');
  np.tRemain = h('span', '-0:00');
  const seekAt = (e) => {
    const r = np.seekEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  np.seekEl.addEventListener('pointerdown', (e) => {
    np.seekEl.setPointerCapture(e.pointerId);
    np.seekEl.classList.add('active');
    np.seeking = seekAt(e);
    paintTime();
  });
  np.seekEl.addEventListener('pointermove', (e) => {
    if (np.seeking == null) return;
    np.seeking = seekAt(e);
    paintTime();
  });
  const endSeek = () => {
    if (np.seeking == null) return;
    player.seek(np.seeking * player.durationMs());
    np.seeking = null;
    np.seekEl.classList.remove('active');
    np.manualUntil = 0;
  };
  np.seekEl.addEventListener('pointerup', endSeek);
  np.seekEl.addEventListener('pointercancel', endSeek);

  np.playBtn = iconButton('pause', '再生・一時停止', () => player.toggle(), 'big');
  np.shuffleBtn = iconButton('shuffle', 'シャッフル', () => {
    player.setShuffle(!player.q.shuffle);
    toast(player.q.shuffle ? 'シャッフル：オン' : 'シャッフル：オフ', 1500);
  });
  np.repeatBtn = iconButton('repeat', 'リピート', () => {
    player.cycleRepeat();
    toast({ off: 'リピート：オフ', all: 'リピート：全曲', one: 'リピート：1曲' }[player.q.repeat], 1500);
  });
  np.lyricsBtn = iconButton('lyrics', '歌詞', () => setMode(np.mode === 'lyrics' ? 'art' : 'lyrics'));
  np.queueBtn = iconButton('queue', '再生キュー', () => setMode(np.mode === 'queue' ? 'art' : 'queue'));

  const controls = h(
    'div.np-controls',
    np.seekEl,
    h('div.times', np.tCur, np.tRemain),
    h('div.transport', iconButton('prev', '前の曲', () => player.prev()), np.playBtn, iconButton('next', '次の曲', () => player.next())),
    h('div.np-bottom', np.lyricsBtn, np.shuffleBtn, np.repeatBtn, np.queueBtn),
  );
  el.append(bg, shade, handle, top, main, np.info, np.err, controls);
  np.bg = bg;
  document.body.append(el);

  // 上部・ジャケット・操作ボタンを下にスワイプすると閉じる（歌詞とキューのスクロールでは閉じない）
  dragToClose(el, null, () => closeNowPlaying(), el);
  return el;
}

export function openNowPlaying() {
  if (!player.q.current) return;
  np.open = true;
  np.el.classList.add('open');
  renderNp(true);
  startLoop();
}

export function closeNowPlaying() {
  np.open = false;
  np.el.classList.remove('open');
}

export function isNowPlayingOpen() {
  return np.open;
}

function setMode(m) {
  np.mode = m;
  try {
    localStorage.setItem('otokura.npMode', m);
  } catch {
    /* なし */
  }
  renderNp(true);
}

function npMenu() {
  const t = player.q.current;
  if (!t) return;
  actionSheet(
    [
      { label: 'プレイリストに追加…', icon: 'plus', onSelect: () => addToPlaylistFlow([t.id]) },
      {
        label: 'アーティストを見る',
        icon: 'person',
        onSelect: () => {
          closeNowPlaying();
          document.querySelector('.tab[data-tab="library"]')?.click();
          openArtist(t.artist?.trim() || 'アーティスト不明');
        },
      },
      { label: '曲の情報を編集', icon: 'note', onSelect: () => editTrack(t) },
      { label: '歌詞を探し直す…', icon: 'search', onSelect: () => openLyricsSearch(t) },
      { label: '歌詞を編集・貼り付け', icon: 'lyrics', onSelect: () => openLyricsEditor(t) },
      { label: 'タイミングを合わせる', icon: 'time', onSelect: () => openSyncEditor(t) },
      { label: '歌詞の表示タイミングを調整', icon: 'time', onSelect: () => openOffsetSheet(t) },
    ],
    { header: trackHeader(t) },
  );
}

function renderNp(force = false) {
  const t = player.q.current;
  if (!t) {
    if (np.open) closeNowPlaying();
    return;
  }
  const el = np.el;
  el.classList.toggle('paused', !player.q.playing);
  el.classList.remove('mode-art', 'mode-lyrics', 'mode-queue');
  el.classList.add(`mode-${np.mode}`);
  np.playBtn.replaceChildren(icon(player.q.playing ? 'pause' : 'play'));
  np.shuffleBtn.classList.toggle('on', player.q.shuffle);
  np.repeatBtn.classList.toggle('on', player.q.repeat !== 'off');
  np.repeatBtn.classList.toggle('mode-one', player.q.repeat === 'one');
  np.lyricsBtn.classList.toggle('on', np.mode === 'lyrics');
  np.queueBtn.classList.toggle('on', np.mode === 'queue');
  np.err.textContent = player.q.error || '';

  const changed = np.trackId !== t.id;
  if (changed || force) {
    np.trackId = t.id;
    const [c1, c2, c3] = trackColors(t);
    np.bg.style.setProperty('--c1', c1);
    np.bg.style.setProperty('--c2', c2);
    np.bg.style.setProperty('--c3', c3);
    np.art.replaceChildren(cover(t, 'np-art'));
    np.miniHead.replaceChildren(cover(t), h('div.meta', h('div.t', t.title), h('div.a', t.artist || 'アーティスト不明')));
    np.info.replaceChildren(
      h('div.meta', h('div.t', t.title), h('div.a', t.artist || 'アーティスト不明')),
      iconButton('more', '曲のメニュー', () => trackMenu(t)),
    );
    if (np.mode === 'lyrics') mountLyrics(t);
    else if (np.mode === 'queue') mountQueue();
    else np.panel.replaceChildren();
  } else if (np.mode === 'queue') mountQueue();
  np.badge.textContent = np.mode === 'lyrics' ? '歌詞' : np.mode === 'queue' ? '再生キュー' : '';
}

// ---------------- 歌詞 ----------------
async function mountLyrics(t) {
  const box = h('div.lyrics.no-drag');
  np.panel.replaceChildren(box);
  np.lyricsBox = box;
  np.lineEls = [];
  np.curIdx = -2;
  np.lyrics = null;
  np.lyricsFor = t.id;
  const raw = await store.getLyrics(t.id);
  if (np.lyricsFor !== t.id || np.lyricsBox !== box) return;
  if (!raw || !raw.trim()) {
    box.classList.add('plain');
    box.style.paddingTop = '12vh';
    box.append(
      h(
        'div.note-box',
        h('div', 'この曲の歌詞はまだありません'),
        h('button.btn', { type: 'button', onclick: () => openLyricsSearch(t) }, icon('search'), '歌詞を探す'),
        h('button.btn.secondary', { type: 'button', onclick: () => openLyricsEditor(t) }, '貼り付ける'),
      ),
    );
    return;
  }
  const lyr = withoutCredits(parseLrc(raw));
  np.lyrics = lyr;
  if (!lyr.synced) {
    box.classList.add('plain');
    box.style.paddingTop = '4vh';
    box.style.paddingBottom = '20vh';
    for (const l of lyr.lines) box.append(h(`div.ln${l.text.trim() ? '' : '.empty-line'}`, l.text));
    box.append(h('div.note-box', h('div', '文字だけの歌詞です。タイミングを付けるとカラオケ表示になります。'), h('button.btn.secondary', { type: 'button', onclick: () => openSyncEditor(t) }, 'タイミングを合わせる')));
    return;
  }
  box.classList.toggle('karaoke', !!store.state.settings.karaoke);
  np.intro = h('div.dots', h('i'), h('i'), h('i'));
  box.append(np.intro);
  lyr.lines.forEach((l, i) => {
    const el = h(`div.ln${l.text.trim() ? '' : '.empty-line'}`, l.text);
    el.addEventListener('click', () => {
      const off = store.getTrack(t.id)?.lyricsOffsetMs || 0;
      player.seek(Math.max(0, l.startMs - off));
      np.manualUntil = 0;
      if (!player.q.playing) player.toggle();
    });
    np.lineEls.push(el);
    box.append(el);
  });
  // 指でスクロールしたら3秒は自動スクロールしない
  box.addEventListener('touchstart', () => {
    np.touching = true;
    box.classList.add('manual');
  }, { passive: true });
  box.addEventListener('touchend', () => {
    np.touching = false;
    np.manualUntil = performance.now() + 3000;
  }, { passive: true });
  box.addEventListener('wheel', () => {
    np.manualUntil = performance.now() + 3000;
    box.classList.add('manual');
  }, { passive: true });
  np.scrollY = box.scrollTop;
  np.scrollV = 0;
}

function setCurrentLine(idx) {
  np.curIdx = idx;
  const els = np.lineEls;
  // 前の行を文字だけに戻す（カラオケの1文字ずつの部品を外す）
  for (let i = 0; i < els.length; i++) {
    if (i !== idx && els[i].classList.contains('cur')) {
      els[i].classList.remove('cur');
      els[i].textContent = np.lyrics.lines[i].text;
    }
  }
  np.intro.style.display = idx < 0 && np.lyrics.lines[0]?.startMs > 2500 ? '' : 'none';
  for (let i = 0; i < els.length; i++) {
    const d = Math.abs(i - idx);
    els[i].classList.toggle('past', i < idx);
    els[i].style.setProperty('--b', d === 0 ? '0px' : d <= 6 ? `${Math.min(2.4, 0.6 + d * 0.4)}px` : '2.4px');
  }
  const cur = els[idx];
  if (cur) {
    cur.classList.add('cur');
    if (store.state.settings.karaoke) {
      cur.replaceChildren(...chars(np.lyrics.lines[idx].text).map((c) => h('span.c', c)));
      cur._lit = -1;
    }
  }
}

function paintKaraoke(pos) {
  const idx = np.curIdx;
  const cur = np.lineEls[idx];
  if (!cur || !store.state.settings.karaoke) return;
  const lines = np.lyrics.lines;
  const lit = litChars(lines[idx], lines[idx + 1]?.startMs ?? null, pos);
  const full = Math.floor(lit);
  const frac = lit - full;
  const spans = cur.children;
  const key = Math.round(lit * 20);
  if (cur._lit === key) return;
  cur._lit = key;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (i < full) {
      if (!s.classList.contains('lit')) s.className = 'c lit';
    } else if (i === full && frac > 0.02) {
      // 文字の途中は、明るさを少しずつ上げる
      s.className = 'c part';
      s.style.setProperty('--a', (0.45 + frac * 0.55).toFixed(2));
    } else if (s.className !== 'c') s.className = 'c';
  }
}

function lyricsFrame(dt) {
  const box = np.lyricsBox;
  if (!box || !np.lyrics?.synced || !box.isConnected) return;
  const t = player.q.current;
  const off = t?.lyricsOffsetMs || 0;
  const pos = player.currentTimeMs() + off;
  const idx = currentIndex(np.lyrics.lines, pos);
  if (idx !== np.curIdx) setCurrentLine(idx);
  paintKaraoke(pos);

  const now = performance.now();
  const manual = np.touching || now < np.manualUntil;
  if (manual) {
    np.scrollY = box.scrollTop;
    np.scrollV = 0;
    return;
  }
  box.classList.remove('manual');
  const target = idx >= 0 && np.lineEls[idx] ? np.lineEls[idx] : np.intro;
  if (!target) return;
  const goal = Math.max(0, target.offsetTop - box.clientHeight * 0.28);
  // ばねのように動かす
  const k = 120;
  const c = 2 * Math.sqrt(k) * 0.9;
  const step = Math.min(dt, 0.05);
  np.scrollV += (k * (goal - np.scrollY) - c * np.scrollV) * step;
  np.scrollY += np.scrollV * step;
  if (Math.abs(goal - np.scrollY) < 0.5 && Math.abs(np.scrollV) < 1) np.scrollY = goal;
  box.scrollTop = np.scrollY;
}

// ---------------- 再生キュー ----------------
function mountQueue() {
  const q = player.q;
  const box = h('div.queue.no-drag');
  const upcoming = q.order.slice(q.pos + 1);
  box.append(h('h4', '次に再生', h('span', { style: { color: 'rgba(255,255,255,.55)', fontWeight: 400, fontSize: '13px', marginLeft: '8px' } }, q.shuffle ? 'シャッフル中' : '')));
  if (!upcoming.length) box.append(h('p.note', { style: { color: 'rgba(255,255,255,.6)' } }, q.repeat === 'all' ? '最後まで流れたら最初に戻ります' : 'この曲で最後です'));
  upcoming.forEach((id, i) => {
    const t = store.getTrack(id);
    if (!t) return;
    const pos = q.pos + 1 + i;
    const row = h(
      'div.track',
      { onclick: (e) => !e.target.closest('.icon-btn') && player.jumpTo(pos) },
      cover(t),
      h('div.meta', h('div.t', t.title), h('div.a', t.artist || 'アーティスト不明')),
      iconButton('close', 'キューから外す', () => player.removeFromQueue(pos)),
    );
    box.append(row);
  });
  const old = np.panel.querySelector('.queue');
  const keep = old ? old.scrollTop : 0;
  np.panel.replaceChildren(box);
  box.scrollTop = keep;
}

// ---------------- 毎フレームの更新 ----------------
function paintTime() {
  const dur = player.durationMs();
  const pos = np.seeking != null ? np.seeking * dur : player.currentTimeMs();
  const f = dur ? Math.min(1, pos / dur) : 0;
  np.seekFill.style.width = `${f * 100}%`;
  np.tCur.textContent = formatDuration(pos);
  np.tRemain.textContent = `-${formatDuration(Math.max(0, dur - pos))}`;
}

let lastT = 0;
function loop(now) {
  const dt = lastT ? (now - lastT) / 1000 : 0.016;
  lastT = now;
  if (np.mini._bar) {
    const d = player.durationMs();
    np.mini._bar.style.width = `${d ? Math.min(100, (player.currentTimeMs() / d) * 100) : 0}%`;
  }
  if (np.open) {
    paintTime();
    if (np.mode === 'lyrics') lyricsFrame(dt);
  }
  np.raf = requestAnimationFrame(loop);
}

function startLoop() {
  if (!np.raf) np.raf = requestAnimationFrame(loop);
}

export function mountNowPlaying() {
  np.mini = buildMini();
  np.el = buildNp();
  player.subscribe(() => {
    renderMini();
    renderNp();
  });
  store.subscribe((what) => {
    const id = player.q.currentId;
    if (what === `lyrics:${id}` && np.mode === 'lyrics' && np.open) mountLyrics(player.q.current);
    if (what === 'tracks' || what === 'all') {
      np.mini.dataset.id = '';
      renderMini();
      renderNp(true);
    }
    if (what === 'settings' && np.mode === 'lyrics') renderNp(true);
  });
  renderMini();
  startLoop();
  // 画面が隠れている間は止まり、戻ったら位置を合わせ直す
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      np.curIdx = -2;
      lastT = 0;
    }
  });
}

export { eq };
