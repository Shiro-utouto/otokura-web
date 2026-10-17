// ブラウザ：よく使うサイトと、URL・言葉で開く。サイトは音蔵の上に Safari の画面で開く（「完了」で戻る）
// Web アプリの中には他のサイトを表示できない（多くのサイトが埋め込みを禁止している）ので、iPhone の仕組みで開く
import { h, icon, iconButton, actionSheet, confirmDialog, sheet, toast, onLongPress, clear } from './dom.js';
import { DEFAULT_BOOKMARKS, loadBookmarks, setBookmarks, getBookmarks } from '../bookmarks.js';
import { fallbackColors } from '../image.js';
import { addSongsFlow } from './common.js';
import { isStandalone } from './install.js';

/** 「example.com」や「https://…」なら URL、それ以外は検索する言葉 */
export function toUrl(text) {
  const s = text.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`;
  return null;
}

export function searchUrl(bm, words) {
  return bm.search.replace('{q}', encodeURIComponent(words.trim()));
}

/** iPhone のホーム画面のアプリでは、音蔵の上に Safari の画面が重なって開く */
export function openSite(url) {
  const a = h('a', { href: url, target: '_blank', rel: 'noopener', style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
}

export function mountBrowser(view) {
  const input = h('input', {
    type: 'text',
    inputmode: 'url',
    autocapitalize: 'off',
    autocomplete: 'off',
    spellcheck: false,
    enterkeyhint: 'go',
    placeholder: 'URL か、検索する言葉',
  });
  const chips = h('div.search-chips');
  const tiles = h('div.bm-grid');
  const form = h(
    'form.searchbox.urlbox',
    {
      onsubmit: (e) => {
        e.preventDefault();
        const text = input.value;
        if (!text.trim()) return;
        const url = toUrl(text);
        const g = getBookmarks().find((b) => b.search) || DEFAULT_BOOKMARKS[0];
        openSite(url || searchUrl(g, text));
        input.blur();
      },
    },
    icon('search'),
    input,
  );
  const page = h(
    'div',
    h('div.topbar', h('div.small-title', 'ブラウザ')),
    h('h1.big-title', 'ブラウザ'),
    form,
    chips,
    h('div.section-title', 'よく使うサイト'),
    tiles,
    h('p.note', isStandalone() ? 'サイトは音蔵の上に Safari の画面で開きます。「完了」を押すと戻れます。' : 'サイトは Safari の新しいタブで開きます。'),
    h('div.section-title', '曲を入れる'),
    h('div.row-buttons', { style: { marginTop: '8px' } }, h('button.pill', { type: 'button', onclick: () => addSongsFlow() }, icon('folder'), 'ファイルから曲を追加')),
    h('p.note', 'Safari で保存したファイルは、「ファイル」アプリの「ダウンロード」フォルダに入っています。'),
  );
  view.append(page);
  view.addEventListener('scroll', () => page.querySelector('.topbar').classList.toggle('scrolled', view.scrollTop > 40));

  function renderChips() {
    const text = input.value.trim();
    if (!text) return clear(chips);
    const url = toUrl(text);
    clear(
      chips,
      url ? h('button.chip-btn', { type: 'button', onclick: () => openSite(url) }, `${url.replace(/^https?:\/\//, '').slice(0, 30)} を開く`) : null,
      getBookmarks().filter((b) => b.search).map((b) => h('button.chip-btn', { type: 'button', onclick: () => openSite(searchUrl(b, text)) }, `${b.name} で検索`)),
    );
  }
  input.addEventListener('input', renderChips);

  function renderTiles() {
    clear(
      tiles,
      getBookmarks().map((b) => {
        const [c1, c2] = fallbackColors(b.name);
        const tile = h(
          'button.bm',
          { type: 'button', onclick: () => openSite(b.url) },
          h('div.bm-icon', { style: { background: `linear-gradient(135deg, ${c1}, ${c2})` } }, Array.from(b.name.trim() || '?')[0].toUpperCase()),
          h('div.bm-name', b.name),
        );
        onLongPress(tile, () => bookmarkMenu(b));
        return tile;
      }),
      h('button.bm', { type: 'button', onclick: () => editBookmark(null) }, h('div.bm-icon.add', icon('plus')), h('div.bm-name', '追加')),
    );
  }

  function bookmarkMenu(b) {
    actionSheet(
      [
        { label: '開く', icon: 'search', onSelect: () => openSite(b.url) },
        { label: '編集', icon: 'note', onSelect: () => editBookmark(b) },
        {
          label: '削除',
          icon: 'trash',
          danger: true,
          onSelect: async () => {
            if (!(await confirmDialog(`「${b.name}」をよく使うサイトから外しますか？`, { ok: '外す', danger: true }))) return;
            await setBookmarks(getBookmarks().filter((x) => x.id !== b.id));
            renderTiles();
            renderChips();
          },
        },
      ],
      { title: b.name, subtitle: b.url },
    );
  }

  function editBookmark(b) {
    const name = h('input.text', { value: b?.name || '', placeholder: '名前' });
    const url = h('input.text', { value: b?.url || '', placeholder: 'https://…', inputmode: 'url', autocapitalize: 'off', spellcheck: false });
    const s = sheet(
      h(
        'form.dialog',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            const u = toUrl(url.value) || (url.value.trim() ? `https://${url.value.trim()}` : '');
            if (!u) return toast('URL を入れてください');
            const n = name.value.trim() || u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
            if (b) await setBookmarks(getBookmarks().map((x) => (x.id === b.id ? { ...x, name: n, url: u } : x)));
            else await setBookmarks([...getBookmarks(), { id: `bm${Date.now().toString(36)}`, name: n, url: u }]);
            s.close();
            renderTiles();
            renderChips();
          },
        },
        h('label.field', h('span', '名前'), name),
        h('label.field', h('span', 'URL'), url),
        h('div.dialog-buttons', h('button.btn.secondary', { type: 'button', onclick: () => s.close() }, 'キャンセル'), h('button.btn', { type: 'submit' }, '保存')),
      ),
      { title: b ? 'サイトを編集' : 'よく使うサイトを追加' },
    );
  }

  loadBookmarks().then(renderTiles);
  return { focus: () => input.focus(), refresh: () => loadBookmarks().then(renderTiles) };
}
