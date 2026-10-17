// 検索：曲名・アーティスト・プレイリスト名で探す
import { h, icon, cover } from './dom.js';
import * as store from '../store.js';
import * as player from '../player.js';
import { trackRow } from './common.js';
import { openArtist, openPlaylist } from './library.js';

let query = '';

function norm(s) {
  // ひらがな・カタカナ、全角・半角、大文字・小文字の違いを気にしない
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

export function mountSearch(view, onGoLibrary) {
  const input = h('input', { type: 'search', placeholder: '曲名・アーティスト・プレイリスト', enterkeyhint: 'search', autocomplete: 'off', value: query });
  const results = h('div');
  const page = h(
    'div',
    h('div.topbar', h('div.small-title', '検索')),
    h('h1.big-title', '検索'),
    h('label.searchbox', icon('search'), input),
    results,
  );
  view.append(page);
  view.addEventListener('scroll', () => page.querySelector('.topbar').classList.toggle('scrolled', view.scrollTop > 40));

  function render() {
    query = input.value;
    const q = norm(query);
    results.replaceChildren();
    if (!q) {
      results.append(h('p.empty', '入っている曲の中から探します'));
      return;
    }
    const tracks = store.state.tracks.filter((t) => norm(t.title).includes(q) || norm(t.artist).includes(q) || norm(t.album).includes(q));
    const artists = [...new Set(store.state.tracks.map((t) => t.artist?.trim()).filter((a) => a && norm(a).includes(q)))];
    const pls = store.state.playlists.filter((p) => norm(p.name).includes(q));
    if (!tracks.length && !artists.length && !pls.length) {
      results.append(h('p.empty', '見つかりませんでした'));
      return;
    }
    if (artists.length) {
      results.append(h('div.section-title', 'アーティスト'));
      for (const a of artists.slice(0, 8)) {
        const t = store.state.tracks.find((x) => x.artist?.trim() === a && x.thumbFile) || store.state.tracks.find((x) => x.artist?.trim() === a);
        results.append(
          h(
            'div.artist-row',
            {
              onclick: () => {
                onGoLibrary();
                openArtist(a);
              },
            },
            cover(t),
            h('div.meta', h('div', a)),
          ),
        );
      }
    }
    if (pls.length) {
      results.append(h('div.section-title', 'プレイリスト'));
      for (const p of pls) {
        const t = p.trackIds.map((id) => store.getTrack(id)).find((x) => x?.thumbFile);
        results.append(
          h(
            'div.artist-row',
            {
              onclick: () => {
                onGoLibrary();
                openPlaylist(p.id);
              },
            },
            cover(t),
            h('div.meta', h('div', p.name), h('div.n', `${p.trackIds.length} 曲`)),
          ),
        );
      }
    }
    if (tracks.length) {
      results.append(h('div.section-title', '曲'));
      const ids = tracks.map((t) => t.id);
      for (const t of tracks) results.append(trackRow(t, { onTap: () => player.playList(ids, t.id, { shuffle: false }) }));
    }
  }
  input.addEventListener('input', render);
  store.subscribe((w) => !w.startsWith('lyrics:') && w !== 'lyricsQueue' && w !== 'import' && render());
  render();
  return { focus: () => input.focus() };
}
