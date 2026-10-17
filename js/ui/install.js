// 「ホーム画面に追加」の案内（Safari のタブで開いているときだけ）
import { h, iconButton } from './dom.js';

export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

function dismissed() {
  try {
    return localStorage.getItem('otokura.installHint') === 'off';
  } catch {
    return false;
  }
}

export function installHint() {
  if (isStandalone() || dismissed()) return null;
  const el = h(
    'div.install-hint',
    iconButton('close', '閉じる', () => {
      try {
        localStorage.setItem('otokura.installHint', 'off');
      } catch {
        /* なし */
      }
      el.remove();
    }),
    h('div', h('b', 'ホーム画面に追加'), 'してから使ってください。'),
    h('div', 'Safari の下の「共有」ボタン →「ホーム画面に追加」。アプリのように全画面で開けて、曲のデータも消えにくくなります。'),
    h('div', { style: { fontSize: '12.5px', color: 'var(--sub)', marginTop: '4px' } }, '※ Safari で追加した曲と、ホーム画面のアプリの曲は別々に保存されます。'),
  );
  return el;
}
