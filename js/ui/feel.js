// さわり心地：押したときに「ふにょっ」と縮んで戻る動きと、触覚フィードバック（ブルッ）
import * as store from '../store.js';

/**
 * 触覚フィードバック。
 * iPhone の Safari は navigator.vibrate がないので、iOS 18 からの「スイッチ型のチェックボックス」を
 * 見えないところで押すと、本物のスイッチと同じ軽い振動が出る（指で押した直後だけ）
 */
export function haptic() {
  if (!store.state.settings.haptics) return;
  try {
    if (typeof navigator.vibrate === 'function' && !/iPhone|iPad|iPod/.test(navigator.userAgent)) {
      navigator.vibrate(8);
      return;
    }
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    document.head.append(label);
    label.click();
    label.remove();
  } catch {
    /* 振動できない端末 */
  }
}

// 押すと縮むもの（行のような大きいものは少しだけ）
const PRESSABLE = '.icon-btn, .pill, .btn, .tile, .action, .chip-btn, .segments button, .tab, .sync-tap, .selbar button, .track, .artist-row, .result, .mini, button.cell, .lyrics .ln, .bm';
// 押したら振動するもの（ボタンだけ。曲の行やスクロールでは振動しない）
const BUZZ = '.icon-btn, .pill, .btn, .action, .chip-btn, .segments button, .tab, .sync-tap, .selbar button, .tile, .switch input, .lyrics .ln, .bm';

export function installFeel() {
  let pressed = null;
  let sx = 0;
  let sy = 0;
  const release = () => {
    if (!pressed) return;
    pressed.classList.remove('pressed');
    pressed = null;
  };
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target.closest(PRESSABLE);
      if (!el || el.disabled) return;
      release();
      pressed = el;
      sx = e.clientX;
      sy = e.clientY;
      el.classList.add('pressed');
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      // スクロールし始めたら戻す
      if (pressed && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) release();
    },
    { passive: true, capture: true },
  );
  for (const t of ['pointerup', 'pointercancel', 'scroll']) document.addEventListener(t, release, { passive: true, capture: true });

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest(BUZZ)) haptic();
    },
    { capture: true },
  );
}
