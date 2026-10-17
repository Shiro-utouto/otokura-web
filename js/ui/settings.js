// 設定：歌詞、容量、バックアップと復元、このアプリについて
import { h, icon, sheet, toast, confirmDialog, pickFiles } from './dom.js';
import * as store from '../store.js';
import { estimate, requestPersist } from '../db.js';
import { createBackup, restoreBackup, inspectBackup, saveBlob, APP_VERSION } from '../backup.js';
import { formatBytes } from '../localFiles.js';
import { isStandalone } from './install.js';
import { convertTrackToAudio, isVideoTrack } from '../importer.js';

function toggle(key, label, desc) {
  const input = h('input', {
    type: 'checkbox',
    checked: !!store.state.settings[key],
    onchange: (e) => store.setSetting(key, e.target.checked),
  });
  return h('label.cell', h('div.grow', h('div', label), desc ? h('div.desc', desc) : null), h('span.switch', input, h('i')));
}

function busySheet(title) {
  const msg = h('div', { style: { textAlign: 'center', padding: '10px 20px 4px', color: 'var(--sub)' } }, '準備しています…');
  const bar = h('i', { style: { width: '0%' } });
  const s = sheet([msg, h('div.progress-card', { style: { background: 'transparent' } }, h('div.pbar', bar))], { title });
  return {
    set(text, pct) {
      msg.textContent = text;
      if (pct != null) bar.style.width = `${pct}%`;
    },
    close: () => s.close(),
  };
}

export function mountSettings(view) {
  const page = h('div');
  view.append(page);
  view.addEventListener('scroll', () => page.querySelector('.topbar')?.classList.toggle('scrolled', view.scrollTop > 40));

  async function render() {
    const est = await estimate();
    let persisted = false;
    try {
      persisted = (await navigator.storage?.persisted?.()) || false;
    } catch {
      /* なし */
    }
    const used = store.state.tracks.reduce((n, t) => n + (t.size || 0), 0);
    const quota = est.quota || 0;
    const videos = store.state.tracks.filter(isVideoTrack);
    const videoCount = videos.length;
    const videoBytes = videos.reduce((n, t) => n + (t.size || 0), 0);

    page.replaceChildren(
      h('div.topbar', h('div.small-title', '設定')),
      h('h1.big-title', '設定'),

      h('div.group-title', '歌詞'),
      h(
        'div.group',
        toggle('autoFetchLyrics', '曲を追加したら歌詞を自動で探す', '曲名とアーティスト、曲の長さで LRCLIB（無料の歌詞データベース）を探します'),
        toggle('karaoke', 'カラオケ風に1文字ずつ塗る', 'オフにすると、今の行だけを明るくします'),
      ),

      h('div.group-title', '操作'),
      h('div.group', toggle('haptics', '触覚フィードバック', 'ボタンを押したときに軽く振動します（iOS 18 以降。iPhone の「サウンドと触覚」の「システムの触覚」がオンのとき）')),

      h('div.group-title', '動画'),
      h(
        'div.group',
        toggle('videoAsAudio', '動画は音声だけにして保存する', '容量が数十分の1になり、iPhone が再生できない映像の形式（AV1 など）の動画でも聞けます。音質は変わりません'),
        videoCount
          ? h(
              'button.cell.link',
              { type: 'button', onclick: convertAllVideos },
              h('div.grow', h('div', `入っている動画 ${videoCount} 曲を音声だけにする`), h('div.desc', `今 ${formatBytes(videoBytes)} 使っています`)),
            )
          : null,
      ),

      h('div.group-title', '容量'),
      h(
        'div.group',
        h(
          'div.cell',
          h(
            'div.grow',
            h('div', `曲 ${store.state.tracks.length} 曲 ・ ${formatBytes(used)}`),
            h('div.desc', est.usage != null ? `このアプリが使っている容量：${formatBytes(est.usage)}${quota ? `（使える目安 ${formatBytes(quota)}）` : ''}` : ''),
            quota ? h('div.meter', h('i', { style: { width: `${Math.min(100, ((est.usage || 0) / quota) * 100).toFixed(1)}%` } })) : null,
          ),
        ),
        h(
          'button.cell',
          {
            type: 'button',
            onclick: async () => {
              const ok = await requestPersist();
              toast(ok ? '消えにくい保存になっています' : 'iPhone が許可しませんでした。ホーム画面に追加して使うと消えにくくなります', 4000);
              render();
            },
          },
          h('div.grow', h('div', '保存の状態'), h('div.desc', persisted ? 'iPhone の容量が足りなくなっても消されにくい状態です' : '容量が足りなくなると、iPhone が消すことがあります。ときどきバックアップしてください')),
          h('span.val', persisted ? '保護あり' : '通常'),
        ),
      ),
      !isStandalone() ? h('p.note', 'Safari のタブではなく、ホーム画面に追加したアプリで使うのがおすすめです（全画面で開けて、データも消えにくくなります）。') : null,

      h('div.group-title', 'バックアップ'),
      h(
        'div.group',
        h('button.cell.link', { type: 'button', onclick: () => backupFlow(false) }, icon('folder'), h('div.grow', h('div', 'バックアップ（曲のファイルなし）'), h('div.desc', '曲の情報・歌詞・タイミング・ジャケット・プレイリスト。軽いです'))),
        h('button.cell.link', { type: 'button', onclick: () => backupFlow(true) }, icon('folder'), h('div.grow', h('div', 'バックアップ（曲のファイルも入れる）'), h('div.desc', '全部入り。曲が多いと大きくなります'))),
        h('button.cell.link', { type: 'button', onclick: restoreFlow }, icon('back'), h('div.grow', h('div', 'バックアップから復元'), h('div.desc', '今の曲は残したまま、バックアップの曲とプレイリストを足します。Android 版の音蔵のバックアップも読めます'))),
      ),
      h('p.note', 'できた zip は「ファイルに保存」で iCloud Drive などに置いておくと安心です。'),

      h('div.group-title', 'このアプリについて'),
      h(
        'div.group',
        h('div.cell', h('div.grow', '音蔵（iPhone 版）'), h('span.val', APP_VERSION)),
        h('div.cell', h('div.grow', h('div', '曲と歌詞の置き場所'), h('div.desc', 'すべてこの iPhone の中だけに保存し、どこにも送りません。歌詞の検索のときだけ、曲名とアーティストを LRCLIB に送ります。'))),
        h('a.cell.link', { href: 'https://lrclib.net', target: '_blank', rel: 'noopener', style: { textDecoration: 'none' } }, h('div.grow', '歌詞データ：LRCLIB')),
      ),
      store.state.issues.length ? h('div', h('div.group-title', 'お知らせ'), h('div.group', store.state.issues.map((m) => h('div.cell', h('div.desc', m))))) : null,
    );
  }

  async function convertAllVideos() {
    const list = store.state.tracks.filter(isVideoTrack);
    if (!(await confirmDialog(`動画 ${list.length} 曲を音声だけにしますか？\n映像は消えます（音声はそのまま）。`, { ok: '音声だけにする' }))) return;
    const b = busySheet('動画を音声だけにする');
    let saved = 0;
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      b.set(`${i + 1} / ${list.length}：${list[i].title}`, (i / list.length) * 100);
      try {
        saved += await convertTrackToAudio(list[i].id);
      } catch (e) {
        failed.push(`${list[i].title}（${e.message}）`);
      }
    }
    b.close();
    toast(`${formatBytes(saved)} 減りました${failed.length ? `\nできなかった曲：${failed.join('、')}` : ''}`, 5000);
    render();
  }

  async function backupFlow(includeMedia) {
    if (!store.state.tracks.length) return toast('まだ曲がありません');
    const b = busySheet('バックアップ');
    try {
      const blob = await createBackup({ includeMedia, onProgress: (d, n) => b.set(`まとめています… ${d} / ${n}`, n ? (d / n) * 100 : 0) });
      b.close();
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      // 共有シートは「指で押した直後」でないと開けないので、もう一度押してもらう
      const s = sheet(
        h(
          'div.dialog',
          h('p.dialog-msg', `バックアップができました（${formatBytes(blob.size)}）。\n「ファイルに保存」から iCloud Drive などに保存してください。`),
          h(
            'div.dialog-buttons',
            h(
              'button.btn',
              {
                type: 'button',
                onclick: async () => {
                  const r = await saveBlob(blob, `otokura-backup-${stamp}.zip`);
                  if (r !== 'cancelled') s.close();
                  if (r === 'downloaded') toast('ダウンロードしました。「ファイル」アプリのダウンロードにあります', 4000);
                },
              },
              icon('folder'),
              '保存する',
            ),
          ),
        ),
        { title: 'バックアップ' },
      );
    } catch (e) {
      b.close();
      toast(`バックアップを作れませんでした：${e.message}`, 5000);
    }
  }

  async function restoreFlow() {
    const [f] = await pickFiles({ accept: '.zip,application/zip', multiple: false });
    if (!f) return;
    try {
      const { manifest } = await inspectBackup(f);
      const c = manifest.counts || {};
      const when = manifest.createdAt ? new Date(manifest.createdAt).toLocaleString('ja-JP') : '不明';
      const ok = await confirmDialog(
        `このバックアップを復元しますか？\n作った日時：${when}\n曲 ${c.tracks ?? '?'} ・ プレイリスト ${c.playlists ?? '?'} ・ 歌詞 ${c.lyrics ?? '?'}\n${manifest.includesMedia ? '曲のファイルも入っています' : '曲のファイルは入っていません（曲の情報と歌詞だけ）'}\n\n今の曲は残ります。同じ曲は上書きします。`,
        { ok: '復元' },
      );
      if (!ok) return;
      const b = busySheet('復元');
      try {
        const r = await restoreBackup(f, (d, n) => b.set(`取り出しています… ${d} / ${n}`, n ? (d / n) * 100 : 0));
        b.close();
        toast(`復元しました：曲 ${r.tracks}・プレイリスト ${r.playlists}・歌詞 ${r.lyrics}${r.missingMedia ? `\n${r.missingMedia} 曲はファイルがないので再生できません` : ''}`, 5000);
      } catch (e) {
        b.close();
        throw e;
      }
    } catch (e) {
      toast(`復元できませんでした：${e.message}`, 5000);
    }
  }

  store.subscribe((w) => (w === 'settings' || w === 'tracks' || w === 'all') && view.classList.contains('active') && render());
  return { render };
}
