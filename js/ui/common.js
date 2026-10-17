// 曲の行、曲のメニュー、プレイリストへの追加、曲の編集、曲の追加（取り込み）
import { h, icon, iconButton, cover, actionSheet, confirmDialog, promptDialog, sheet, toast, pickFiles, onLongPress, forgetCover } from './dom.js';
import * as store from '../store.js';
import * as player from '../player.js';
import { importFiles, lyricsStatus } from '../importer.js';
import { formatBytes, formatDuration } from '../localFiles.js';
import { files } from '../db.js';
import { resizeImage, extractColors } from '../image.js';
import { openLyricsSearch, openLyricsEditor, openSyncEditor, importLyricsFile } from './lyricsTools.js';

/** 曲の行。opts: { onTap, selectable, selected, onSelect, extraRight, showSize, list } */
export function trackRow(t, opts = {}) {
  const playing = player.q.currentId === t.id;
  const row = h(`div.track${playing ? '.playing' : ''}${t.missingMedia ? '.missing' : ''}`, { dataset: { id: t.id } });
  if (opts.selectable) {
    row.append(h('div.check', opts.selected ? icon('check') : null));
    if (opts.selected) row.classList.add('selected');
  }
  row.append(cover(t));
  const sub = [t.artist || 'アーティスト不明'];
  if (opts.showSize && t.size) sub.push(formatBytes(t.size));
  row.append(
    h(
      'div.meta',
      h('div.t', playing ? eq() : null, t.title, t.isVideo ? h('span.badge', '動画') : null, t.missingMedia ? h('span.badge', 'ファイルなし') : null),
      h('div.a', sub.join(' ・ ')),
    ),
  );
  if (opts.extraRight) row.append(opts.extraRight);
  else if (!opts.selectable)
    row.append(
      iconButton('more', 'メニュー', (e) => {
        e.stopPropagation();
        trackMenu(t, opts.menuExtra);
      }),
    );
  const wasLong = onLongPress(row, () => opts.onLongPress?.(t));
  row.addEventListener('click', (e) => {
    if (wasLong()) return;
    if (e.target.closest('.icon-btn, .grip')) return;
    opts.onTap?.(t);
  });
  return row;
}

export function eq() {
  return h(`span.eq${player.q.playing ? '' : '.paused'}`, h('i'), h('i'), h('i'));
}

export function trackHeader(t) {
  return h('div.action-track', cover(t), h('div.meta', h('div.action-title', t.title), h('div.action-sub', t.artist || 'アーティスト不明')));
}

/** 曲のメニュー */
export function trackMenu(t, extra = []) {
  const hasLyrics = store.state.lyricsIds.has(t.id);
  actionSheet(
    [
      { label: '次に再生', icon: 'next', onSelect: () => (player.playNext([t.id]), toast('次に再生します')) },
      { label: '再生キューに追加', icon: 'queue', onSelect: () => (player.addToQueue([t.id]), toast('再生キューに追加しました')) },
      { label: 'プレイリストに追加…', icon: 'plus', onSelect: () => addToPlaylistFlow([t.id]) },
      ...extra,
      { label: '曲の情報を編集', icon: 'note', onSelect: () => editTrack(t) },
      { label: hasLyrics ? '歌詞を探し直す…' : '歌詞を探す…', icon: 'search', onSelect: () => openLyricsSearch(t) },
      { label: hasLyrics ? '歌詞を編集' : '歌詞を貼り付ける', icon: 'lyrics', onSelect: () => openLyricsEditor(t) },
      { label: 'タイミングを合わせる', icon: 'time', onSelect: () => openSyncEditor(t) },
      { label: '歌詞ファイル（.lrc）を読み込む', icon: 'folder', onSelect: () => importLyricsFile(t) },
      { label: 'ライブラリから削除', icon: 'trash', danger: true, onSelect: () => deleteFlow([t.id]) },
    ],
    { header: trackHeader(t) },
  );
}

export async function deleteFlow(ids) {
  const msg = ids.length === 1 ? `「${store.getTrack(ids[0])?.title}」を削除しますか？\n曲のファイルと歌詞も iPhone から消えます。` : `${ids.length} 曲を削除しますか？\n曲のファイルと歌詞も iPhone から消えます。`;
  if (!(await confirmDialog(msg, { ok: '削除', danger: true }))) return false;
  await store.deleteTracks(ids);
  toast(ids.length === 1 ? '削除しました' : `${ids.length} 曲を削除しました`);
  return true;
}

/** プレイリストを選んで追加（新しく作ることもできる） */
export function addToPlaylistFlow(ids) {
  const list = h('div.actions');
  const s = sheet([h('div.action-head', h('div.action-title', 'プレイリストに追加'), h('div.action-sub', `${ids.length} 曲`)), list]);
  list.append(
    h(
      'button.action',
      {
        type: 'button',
        onclick: async () => {
          s.close();
          const name = await promptDialog('新しいプレイリストの名前', '', { ok: '作成' });
          if (!name) return;
          await store.createPlaylist(name, ids);
          toast(`「${name}」を作って追加しました`);
        },
      },
      icon('plus'),
      h('span', '新しいプレイリスト…'),
    ),
  );
  for (const p of [...store.state.playlists].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const already = ids.every((id) => p.trackIds.includes(id));
    list.append(
      h(
        'button.action',
        {
          type: 'button',
          onclick: async () => {
            s.close();
            await store.addToPlaylist(p.id, ids);
            toast(already ? `もう「${p.name}」に入っています` : `「${p.name}」に追加しました`);
          },
        },
        icon(already ? 'check' : 'library'),
        h('span', p.name),
      ),
    );
  }
}

/** 曲の情報の編集（曲名・アーティスト・入れ替え・ジャケット） */
export function editTrack(t) {
  const title = h('input.text', { value: t.title, enterkeyhint: 'next' });
  const artist = h('input.text', { value: t.artist, enterkeyhint: 'done' });
  let newCover = null;
  const preview = cover(t, 'edit-cover');
  preview.style.cssText = 'width:96px;height:96px;border-radius:12px;margin:0 auto 14px;';
  const s = sheet(
    h(
      'form.dialog',
      {
        onsubmit: async (e) => {
          e.preventDefault();
          const patch = { title: title.value.trim() || t.title, artist: artist.value.trim() };
          if (newCover) {
            const img = (await resizeImage(newCover)) || newCover;
            await files.put(t.id, 'cover.jpg', img);
            patch.thumbFile = 'cover.jpg';
            patch.colors = await extractColors(img);
            forgetCover(t);
          }
          await store.updateTrack(t.id, patch);
          s.close();
          toast('保存しました');
        },
      },
      preview,
      h(
        'div',
        { style: { textAlign: 'center', marginBottom: '14px' } },
        h(
          'button.chip-btn',
          {
            type: 'button',
            onclick: async () => {
              const [f] = await pickFiles({ accept: 'image/*', multiple: false });
              if (!f) return;
              newCover = f;
              const img = h('img', { src: URL.createObjectURL(f), alt: '' });
              preview.replaceChildren(img);
            },
          },
          'ジャケットを変える',
        ),
      ),
      h('label.field', h('span', '曲名'), title),
      h('label.field', h('span', 'アーティスト'), artist),
      h(
        'button.chip-btn',
        {
          type: 'button',
          onclick: () => {
            const a = title.value;
            title.value = artist.value;
            artist.value = a;
          },
        },
        '曲名とアーティストを入れ替える',
      ),
      h('p.note', { style: { margin: '10px 2px 0' } }, `長さ ${formatDuration(t.durationMs)} ・ ${formatBytes(t.size || 0)}${t.album ? ` ・ アルバム ${t.album}` : ''}`),
      h('div.dialog-buttons', h('button.btn.secondary', { type: 'button', onclick: () => s.close() }, 'キャンセル'), h('button.btn', { type: 'submit' }, '保存')),
    ),
    { title: '曲の情報' },
  );
}

// ---- 曲の追加（取り込み） ----
export const importState = { running: false, done: 0, total: 0, name: '' };

export const ACCEPT = 'audio/*,video/mp4,video/quicktime,.mp3,.m4a,.aac,.flac,.wav,.mp4,.m4v,.mov,.lrc,.txt';

export async function addSongsFlow() {
  const list = await pickFiles({ accept: ACCEPT, multiple: true });
  if (!list.length) return;
  await runImport(list);
}

export async function runImport(list) {
  if (importState.running) {
    toast('いまほかの曲を追加しています');
    return;
  }
  importState.running = true;
  store.notify('import');
  try {
    const r = await importFiles(list, (p) => {
      Object.assign(importState, p);
      store.notify('import');
    });
    const msgs = [];
    if (r.added.length) msgs.push(`${r.added.length} 曲を追加しました`);
    if (r.skipped.length) msgs.push(`${r.skipped.length} 曲はもう入っています`);
    if (r.failed.length) msgs.push(`${r.failed.length} 曲は追加できませんでした`);
    if (r.lyricsAttached) msgs.push(`歌詞ファイル ${r.lyricsAttached} 件`);
    if (!msgs.length) msgs.push('追加できる曲がありませんでした');
    if (r.added.length && store.state.settings.autoFetchLyrics && lyricsStatus.pending + (lyricsStatus.current ? 1 : 0) > 0) msgs.push('歌詞を探しています…');
    toast(msgs.join('\n'), 4000);
    return r;
  } finally {
    importState.running = false;
    store.notify('import');
  }
}

/** 取り込み中・歌詞を探し中の表示 */
export function progressCard() {
  if (importState.running) {
    const pct = importState.total ? Math.round((importState.done / importState.total) * 100) : 0;
    return h('div.progress-card', h('div', '曲を追加中 ', h('b', `${importState.done + 1} / ${importState.total}`)), h('div', { style: { fontSize: '12.5px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, importState.name), h('div.pbar', h('i', { style: { width: `${pct}%` } })));
  }
  if (lyricsStatus.current) {
    return h('div.progress-card', h('div', '歌詞を探しています：', h('b', lyricsStatus.current)), lyricsStatus.pending ? h('div', { style: { fontSize: '12.5px', marginTop: '2px' } }, `あと ${lyricsStatus.pending} 曲`) : null);
  }
  return null;
}
