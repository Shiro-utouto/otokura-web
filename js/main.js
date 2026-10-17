// 起動：データを読み、画面を組み立てる
import { h, icon, toast } from './ui/dom.js';
import * as store from './store.js';
import * as player from './player.js';
import { requestPersist } from './db.js';
import { mountLibrary, resetToRoot, back as libraryBack } from './ui/library.js';
import { mountNowPlaying } from './ui/nowplaying.js';
import { mountSearch } from './ui/search.js';
import { mountSettings } from './ui/settings.js';
import { runImport } from './ui/common.js';

async function boot() {
  const app = document.getElementById('app');
  try {
    await store.load();
  } catch (e) {
    app.replaceChildren(h('div.boot', `データを読めませんでした：${e.message}`));
    return;
  }
  player.init();

  const views = {
    library: h('div.view'),
    search: h('div.view'),
    settings: h('div.view'),
  };
  const tabs = [
    ['library', 'ライブラリ', 'library'],
    ['search', '検索', 'search'],
    ['settings', '設定', 'gear'],
  ];
  let current = 'library';
  const tabEls = {};
  const tabbar = h('nav.tabbar');
  for (const [key, label, ic] of tabs) {
    tabEls[key] = h(
      'button.tab',
      {
        type: 'button',
        dataset: { tab: key },
        onclick: () => {
          if (current === key) {
            if (key === 'library') resetToRoot();
            else views[key].scrollTo({ top: 0, behavior: 'smooth' });
            if (key === 'search') searchApi.focus();
            return;
          }
          show(key);
        },
      },
      icon(ic),
      label,
    );
    tabbar.append(tabEls[key]);
  }
  function show(key) {
    current = key;
    for (const k of Object.keys(views)) {
      views[k].classList.toggle('active', k === key);
      tabEls[k].classList.toggle('active', k === key);
    }
    if (key === 'settings') settingsApi.render();
    document.querySelector('.selbar')?.remove();
    if (key !== 'library') libraryBack();
  }

  app.replaceChildren(views.library, views.search, views.settings, tabbar);
  mountLibrary(views.library);
  const searchApi = mountSearch(views.search, () => show('library'));
  const settingsApi = mountSettings(views.settings);
  mountNowPlaying();
  show('library');

  await player.restoreSession();
  if (store.state.issues.length) toast(store.state.issues[0], 6000);

  // 曲が入ったら、iPhone に「消さないで」と頼む
  if (store.state.tracks.length) requestPersist();
  store.subscribe((w) => w === 'tracks' && store.state.tracks.length === 1 && requestPersist());

  // ファイルをドラッグで落としたとき（iPad や PC で試すとき用）
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const list = [...(e.dataTransfer?.files || [])];
    if (list.length) runImport(list);
  });
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // 新しい版が入ったら、次に開いたときに切り替わる
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!window.__reloading && !document.querySelector('.np.open')) {
      window.__reloading = true;
      toast('アプリを更新しました');
    }
  });
}

boot();
