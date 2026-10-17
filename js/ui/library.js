// ライブラリ：プレイリスト / 曲 / アーティスト、プレイリストとアーティストの詳細、複数選択
import { h, icon, iconButton, cover, actionSheet, confirmDialog, promptDialog, toast, clear } from './dom.js';
import * as store from '../store.js';
import * as player from '../player.js';
import { trackRow, addSongsFlow, addToPlaylistFlow, deleteFlow, progressCard } from './common.js';
import { installHint } from './install.js';

const ui = {
  root: null,
  seg: 'songs',
  stack: [], // 詳細ページ: { kind: 'playlist'|'artist', id, scroll }
  selecting: null, // Set of ids
  scrollRoot: 0,
};

try {
  ui.seg = localStorage.getItem('otokura.seg') || 'songs';
} catch {
  /* 保存できなくても動く */
}

export function mountLibrary(view) {
  ui.root = view;
  render();
  view.addEventListener('scroll', () => {
    const bar = view.querySelector('.topbar');
    if (bar) bar.classList.toggle('scrolled', view.scrollTop > 40);
  });
  store.subscribe((what) => {
    if (what.startsWith('lyrics:')) return;
    render();
  });
  player.subscribe(() => refreshPlaying());
}

let lastPlaying = null;
let lastPlayingState = null;
function refreshPlaying() {
  const id = player.q.currentId;
  if (id === lastPlaying && player.q.playing === lastPlayingState) return;
  lastPlaying = id;
  lastPlayingState = player.q.playing;
  render();
}

function sortedTracks() {
  return [...store.state.tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function artistsOf(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const name = t.artist?.trim() || 'アーティスト不明';
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, { name, tracks: [] });
    map.get(key).tracks.push(t);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export function render() {
  const v = ui.root;
  if (!v) return;
  const top = ui.stack[ui.stack.length - 1];
  const keepScroll = v.scrollTop;
  if (top?.kind === 'playlist') clear(v, playlistPage(top.id));
  else if (top?.kind === 'artist') clear(v, artistPage(top.id));
  else clear(v, rootPage());
  v.scrollTop = keepScroll;
  renderSelBar();
}

function push(entry) {
  if (!ui.stack.length) ui.scrollRoot = ui.root.scrollTop;
  ui.stack.push(entry);
  ui.selecting = null;
  render();
  ui.root.scrollTop = 0;
}

export function back() {
  if (ui.selecting) {
    ui.selecting = null;
    render();
    return true;
  }
  if (!ui.stack.length) return false;
  ui.stack.pop();
  render();
  if (!ui.stack.length) ui.root.scrollTop = ui.scrollRoot;
  return true;
}

/** タブをもう一度押したら一番上へ */
export function resetToRoot() {
  ui.stack = [];
  ui.selecting = null;
  render();
  ui.root.scrollTo({ top: 0, behavior: 'smooth' });
}

export function openPlaylist(id) {
  ui.stack = [];
  push({ kind: 'playlist', id });
}

export function openArtist(name) {
  ui.stack = [];
  push({ kind: 'artist', id: name });
}

// ---------------- ライブラリのトップ ----------------
function rootPage() {
  const page = h('div');
  const addBtn = iconButton('plus', '曲を追加', () => addSongsFlow(), 'accent');
  page.append(h('div.topbar', h('div.small-title', 'ライブラリ'), h('div.actions-right', ui.selecting ? h('button.back', { type: 'button', onclick: () => back() }, '完了') : addBtn)));
  page.append(h('h1.big-title', 'ライブラリ'));
  const hint = installHint();
  if (hint) page.append(hint);
  const pc = progressCard();
  if (pc) page.append(pc);

  if (!store.state.tracks.length) {
    page.append(
      h(
        'div.empty',
        icon('note'),
        h('h3', 'まだ曲がありません'),
        h('div', '「ファイル」アプリにある曲（mp3・m4a・mp4 など）を選んで追加します。同じ名前の .lrc を一緒に選ぶと歌詞になります。'),
        h('button.btn', { type: 'button', onclick: () => addSongsFlow() }, icon('plus'), '曲を追加'),
      ),
    );
    return page;
  }

  const segs = [
    ['playlists', 'プレイリスト'],
    ['songs', '曲'],
    ['artists', 'アーティスト'],
  ];
  page.append(
    h(
      'div.segments',
      segs.map(([k, label]) =>
        h(
          `button${ui.seg === k ? '.on' : ''}`,
          {
            type: 'button',
            onclick: () => {
              ui.seg = k;
              ui.selecting = null;
              try {
                localStorage.setItem('otokura.seg', k);
              } catch {
                /* なし */
              }
              render();
            },
          },
          label,
        ),
      ),
    ),
  );
  if (ui.seg === 'playlists') page.append(playlistGrid());
  else if (ui.seg === 'artists') page.append(artistList());
  else page.append(songList(sortedTracks()));
  return page;
}

function playButtons(ids) {
  return h(
    'div.row-buttons',
    h('button.pill', { type: 'button', onclick: () => player.playList(ids, ids[0], { shuffle: false }) }, icon('play'), '再生'),
    h('button.pill', { type: 'button', onclick: () => player.shuffleAll(ids) }, icon('shuffle'), 'シャッフル'),
  );
}

function songList(tracks, opts = {}) {
  const ids = tracks.map((t) => t.id);
  const wrap = h('div');
  if (!ui.selecting && !opts.noButtons) wrap.append(playButtons(ids));
  const list = h('div.list');
  for (const t of tracks) {
    list.append(
      trackRow(t, {
        showSize: true,
        selectable: !!ui.selecting,
        selected: ui.selecting?.has(t.id),
        onTap: () => {
          if (ui.selecting) {
            ui.selecting.has(t.id) ? ui.selecting.delete(t.id) : ui.selecting.add(t.id);
            render();
          } else player.playList(ids, t.id, { shuffle: false });
        },
        onLongPress: () => {
          if (ui.selecting) return;
          ui.selecting = new Set([t.id]);
          render();
        },
        menuExtra: opts.menuExtra?.(t),
      }),
    );
  }
  wrap.append(list);
  return wrap;
}

function renderSelBar() {
  document.querySelector('.selbar')?.remove();
  if (!ui.selecting) return;
  const ids = () => [...ui.selecting];
  const n = ui.selecting.size;
  const need = (fn) => () => (n ? fn() : toast('曲を選んでください'));
  const visible = currentListIds();
  const allSelected = visible.length && visible.every((id) => ui.selecting.has(id));
  const bar = h(
    'div.selbar',
    h(
      'button',
      {
        type: 'button',
        onclick: () => {
          ui.selecting = allSelected ? new Set() : new Set(visible);
          render();
        },
      },
      icon('check'),
      allSelected ? '選択解除' : 'すべて選択',
    ),
    h('button', { type: 'button', onclick: need(() => (player.playNext(ids()), toast(`${n} 曲を次に再生します`), back())) }, icon('next'), '次に再生'),
    h('button', { type: 'button', onclick: need(() => (player.addToQueue(ids()), toast(`${n} 曲をキューに追加しました`), back())) }, icon('queue'), 'キューに追加'),
    h('button', { type: 'button', onclick: need(() => (addToPlaylistFlow(ids()), back())) }, icon('plus'), 'プレイリスト'),
    h('button.danger', { type: 'button', onclick: need(async () => (await deleteFlow(ids())) && back()) }, icon('trash'), `削除${n ? `(${n})` : ''}`),
  );
  document.body.append(bar);
}

function currentListIds() {
  const top = ui.stack[ui.stack.length - 1];
  if (top?.kind === 'playlist') return store.state.playlists.find((p) => p.id === top.id)?.trackIds || [];
  if (top?.kind === 'artist') return artistTracks(top.id).map((t) => t.id);
  return sortedTracks().map((t) => t.id);
}

// ---------------- プレイリスト ----------------
function mosaic(ids, cls = 'mosaic') {
  const ts = ids.map((id) => store.getTrack(id)).filter(Boolean);
  const withArt = ts.filter((t) => t.thumbFile);
  const pick = (withArt.length >= 4 ? withArt : ts).slice(0, 4);
  const el = h(`div.${cls}${pick.length < 4 ? '.one' : ''}`);
  if (!pick.length) {
    const c = cover(null);
    c.style.background = 'linear-gradient(135deg, #3a2748, #1e1d26)';
    el.append(c);
  } else if (pick.length < 4) el.append(cover(pick[0]));
  else el.append(...pick.map((t) => cover(t)));
  return el;
}

async function newPlaylist() {
  const name = await promptDialog('プレイリストの名前', '', { ok: '作成' });
  if (!name) return;
  const p = await store.createPlaylist(name);
  openPlaylist(p.id);
}

function playlistGrid() {
  const grid = h('div.grid');
  grid.append(h('button.tile.new', { type: 'button', onclick: newPlaylist }, h('div.mosaic', icon('plus')), h('div.name', '新しいプレイリスト'), h('div.count', ' ')));
  for (const p of [...store.state.playlists].sort((a, b) => b.updatedAt - a.updatedAt)) {
    grid.append(h('button.tile', { type: 'button', onclick: () => openPlaylist(p.id) }, mosaic(p.trackIds), h('div.name', p.name), h('div.count', `${p.trackIds.length} 曲`)));
  }
  return grid;
}

function playlistPage(id) {
  const p = store.state.playlists.find((x) => x.id === id);
  const page = h('div.page');
  if (!p) {
    ui.stack.pop();
    return rootPage();
  }
  const tracks = p.trackIds.map((tid) => store.getTrack(tid)).filter(Boolean);
  page.append(
    h(
      'div.topbar',
      h('button.back', { type: 'button', onclick: () => back() }, icon('back'), 'ライブラリ'),
      h('div.small-title', p.name),
      h(
        'div.actions-right',
        ui.selecting
          ? h('button.back', { type: 'button', onclick: () => back() }, '完了')
          : iconButton('more', 'プレイリストのメニュー', () => playlistMenu(p), 'accent'),
      ),
    ),
  );
  page.append(h('div.detail-head', mosaic(p.trackIds), h('h2', p.name), h('div.sub', `${tracks.length} 曲`)));
  if (!tracks.length) {
    page.append(h('div.empty', h('div', 'まだ曲が入っていません。曲のメニューの「プレイリストに追加…」か、曲を長押しして選んで追加します。')));
    return page;
  }
  if (ui.reorder === id) {
    page.append(reorderList(p, tracks));
    return page;
  }
  page.append(
    songList(tracks, {
      menuExtra: (t) => [
        {
          label: 'このプレイリストから外す',
          icon: 'close',
          onSelect: async () => {
            await store.removeFromPlaylist(p.id, t.id);
            toast('外しました');
          },
        },
      ],
    }),
  );
  // プレイリストの曲を選んで再生したら、そのプレイリストの順で流す
  return page;
}

function playlistMenu(p) {
  actionSheet(
    [
      { label: '次に再生', icon: 'next', onSelect: () => (player.playNext(p.trackIds), toast('次に再生します')) },
      { label: '再生キューに追加', icon: 'queue', onSelect: () => (player.addToQueue(p.trackIds), toast('再生キューに追加しました')) },
      {
        label: '曲の順番を変える',
        icon: 'grip',
        onSelect: () => {
          ui.reorder = p.id;
          render();
        },
      },
      {
        label: '名前を変える',
        icon: 'note',
        onSelect: async () => {
          const name = await promptDialog('新しい名前', p.name, { ok: '変更' });
          if (name) await store.renamePlaylist(p.id, name);
        },
      },
      {
        label: 'プレイリストを削除',
        icon: 'trash',
        danger: true,
        onSelect: async () => {
          if (!(await confirmDialog(`「${p.name}」を削除しますか？\n曲そのものはライブラリに残ります。`, { ok: '削除', danger: true }))) return;
          await store.deletePlaylist(p.id);
          back();
          toast('削除しました');
        },
      },
    ],
    { title: p.name, subtitle: `${p.trackIds.length} 曲` },
  );
}

/** ドラッグで並べ替え（右のつまみを動かす） */
function reorderList(p, tracks) {
  let order = tracks.map((t) => t.id);
  const wrap = h('div');
  wrap.append(
    h(
      'div.row-buttons',
      h(
        'button.pill',
        {
          type: 'button',
          onclick: async () => {
            await store.reorderPlaylist(p.id, order);
            ui.reorder = null;
            render();
            toast('順番を保存しました');
          },
        },
        icon('check'),
        '完了',
      ),
    ),
  );
  const list = h('div.list');
  const rows = tracks.map((t) => {
    const grip = h('div.grip', icon('grip'));
    const row = trackRow(t, { extraRight: grip });
    row.dataset.id = t.id;
    let startY = 0;
    let rowH = 0;
    let startIndex = 0;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      startY = e.clientY;
      rowH = row.offsetHeight;
      startIndex = order.indexOf(t.id);
      row.classList.add('dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!row.classList.contains('dragging')) return;
      const dy = e.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const target = Math.max(0, Math.min(order.length - 1, startIndex + Math.round(dy / rowH)));
      // ほかの行をずらして見せる
      for (const r of list.children) {
        if (r === row) continue;
        const i = order.indexOf(r.dataset.id);
        let shift = 0;
        if (startIndex < target && i > startIndex && i <= target) shift = -rowH;
        if (startIndex > target && i < startIndex && i >= target) shift = rowH;
        r.style.transition = 'transform 0.18s';
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      }
    });
    const end = (e) => {
      if (!row.classList.contains('dragging')) return;
      const dy = e.clientY - startY;
      const target = Math.max(0, Math.min(order.length - 1, startIndex + Math.round(dy / rowH)));
      order.splice(target, 0, ...order.splice(startIndex, 1));
      row.classList.remove('dragging');
      for (const r of list.children) {
        r.style.transition = '';
        r.style.transform = '';
      }
      list.replaceChildren(...order.map((id) => rows.find((x) => x.dataset.id === id)));
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    return row;
  });
  list.append(...rows);
  wrap.append(list);
  return wrap;
}

// ---------------- アーティスト ----------------
function artistTracks(name) {
  const key = name.toLowerCase();
  return sortedTracks().filter((t) => (t.artist?.trim() || 'アーティスト不明').toLowerCase() === key);
}

function artistList() {
  const list = h('div.list');
  for (const a of artistsOf(sortedTracks())) {
    const withArt = a.tracks.find((t) => t.thumbFile) || a.tracks[0];
    list.append(h('div.artist-row', { onclick: () => openArtist(a.name) }, cover(withArt), h('div.meta', h('div', a.name), h('div.n', `${a.tracks.length} 曲`))));
  }
  return list;
}

function artistPage(name) {
  const tracks = artistTracks(name);
  const page = h('div.page');
  page.append(h('div.topbar', h('button.back', { type: 'button', onclick: () => back() }, icon('back'), 'ライブラリ'), h('div.small-title', name), h('div.actions-right', ui.selecting ? h('button.back', { type: 'button', onclick: () => back() }, '完了') : null)));
  if (!tracks.length) {
    ui.stack.pop();
    return rootPage();
  }
  const head = cover(tracks.find((t) => t.thumbFile) || tracks[0]);
  head.style.borderRadius = '50%';
  page.append(h('div.detail-head', head, h('h2', name), h('div.sub', `${tracks.length} 曲`)));
  page.append(songList(tracks));
  return page;
}
