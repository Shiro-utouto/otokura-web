// 画面づくりの小さな道具：要素の作成、アイコン、ジャケットの読み込み、シート・ダイアログ・お知らせ
import { files } from '../db.js';
import { fallbackColors } from '../image.js';

/** h('div.cls', { onclick }, ...children) */
export function h(sel, props, ...children) {
  const [tag, ...classes] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---- アイコン（自作の簡単な図形） ----
const P = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/>',
  next: '<path d="M3.5 6.2v11.6a.8.8 0 0 0 1.2.7L13 13.1v4.7a.8.8 0 0 0 1.2.7l8.3-5.8a.85.85 0 0 0 0-1.4l-8.3-5.8a.8.8 0 0 0-1.2.7v4.7L4.7 5.5a.8.8 0 0 0-1.2.7z"/>',
  prev: '<path d="M20.5 6.2v11.6a.8.8 0 0 1-1.2.7L11 13.1v4.7a.8.8 0 0 1-1.2.7l-8.3-5.8a.85.85 0 0 1 0-1.4l8.3-5.8a.8.8 0 0 1 1.2.7v4.7l8.3-5.4a.8.8 0 0 1 1.2.7z"/>',
  shuffle:
    '<path d="M3 7h3.2c1.6 0 3 .8 3.9 2.1l3.8 5.8c.9 1.3 2.3 2.1 3.9 2.1H20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 17h3.2c1.6 0 3-.8 3.9-2.1l.6-.9M13.3 9.1l.6-1c.9-1.3 2.3-2.1 3.9-2.1H20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 3.5 21 6l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  repeat:
    '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m16.5 3.5 2.5 2.5-2.5 2.5M7.5 20.5 5 18l2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  lyrics:
    '<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.6 3.4A.6.6 0 0 1 6.5 20v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M8.2 9.2c0-.8.6-1.3 1.3-1.3.8 0 1.3.6 1.3 1.4 0 1.6-1.3 2.6-2.4 2.9M13.4 9.2c0-.8.6-1.3 1.3-1.3.8 0 1.3.6 1.3 1.4 0 1.6-1.3 2.6-2.4 2.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  queue: '<path d="M4 6.5h11M4 11.5h11M4 16.5h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M15.5 14v6.2l4.5-3.1z"/>',
  more: '<circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.2 15.2 4.6 4.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  gear:
    '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.3 3h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.9l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6V11L4.2 9.4l1.7-2.9 2.3.8 1.6-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  library:
    '<rect x="3" y="4" width="3" height="16" rx="1"/><rect x="8" y="4" width="3" height="16" rx="1"/><path d="m13.3 5.2 2.8-1 5.4 14.6-2.8 1z"/>',
  down: '<path d="m6 9.5 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  grip: '<path d="M5 8h14M5 12h14M5 16h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  note: '<path d="M9 17.5V6.2l10-2.2v11.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.8" cy="17.6" r="2.4"/><circle cx="16.8" cy="15.5" r="2.4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>',
  folder: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5h-8L9.6 5.5H4.5A1.5 1.5 0 0 0 3 7z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
  person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6z"/>',
  time: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', `icon ${cls}`.trim());
  s.setAttribute('fill', 'currentColor');
  s.innerHTML = P[name] || '';
  return s;
}

export function iconButton(name, label, onclick, cls = '') {
  return h(`button.icon-btn${cls ? '.' + cls.split(' ').join('.') : ''}`, { type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

// ---- ジャケット ----
const coverCache = new Map();

export async function coverUrl(track) {
  if (!track?.thumbFile) return null;
  const key = `${track.id}/${track.thumbFile}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const p = files.get(track.id, track.thumbFile).then((b) => (b ? URL.createObjectURL(b) : null));
  coverCache.set(key, p);
  return p;
}

export function forgetCover(track) {
  for (const k of [...coverCache.keys()]) {
    if (k.startsWith(`${track.id}/`)) {
      coverCache.get(k).then((u) => u && URL.revokeObjectURL(u));
      coverCache.delete(k);
    }
  }
}

export function trackColors(track) {
  return track?.colors || fallbackColors(`${track?.title || ''}${track?.artist || ''}`);
}

const lazy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      lazy.unobserve(e.target);
      const t = e.target._track;
      coverUrl(t).then((u) => {
        if (u) {
          const img = new Image();
          img.decoding = 'async';
          img.alt = '';
          img.src = u;
          img.onload = () => e.target.replaceChildren(img);
        }
      });
    }
  },
  { rootMargin: '300px' },
);

/** ジャケット（ないときは曲名から決まる色と音符） */
export function cover(track, cls = '') {
  const el = h(`div.cover${cls ? '.' + cls : ''}`);
  const [a, b] = trackColors(track);
  el.style.background = `linear-gradient(135deg, ${a}, ${b})`;
  el.append(icon('note', 'cover-note'));
  if (track?.thumbFile) {
    el._track = track;
    lazy.observe(el);
  }
  return el;
}

// ---- お知らせ（下から出て消える） ----
let toastEl = null;
let toastTimer = null;
export function toast(msg, ms = 2600) {
  if (!toastEl) {
    toastEl = h('div.toast', { role: 'status' });
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---- 下から出るシート ----
const sheetStack = [];

/** @returns {{ el: HTMLElement, close: () => void, done: Promise<any> }} */
export function sheet(content, { title, full = false, onClose } = {}) {
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const panel = h(`div.sheet${full ? '.full' : ''}`, { role: 'dialog', 'aria-modal': 'true' });
  const backdrop = h('div.backdrop');
  const grab = h('div.sheet-grab');
  if (title) panel.append(h('div.sheet-head', h('div.sheet-title', title), iconButton('close', '閉じる', () => close())));
  else panel.append(grab);
  const body = h('div.sheet-body');
  append(body, [content]);
  panel.append(body);
  const wrap = h('div.layer', backdrop, panel);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  function close(value) {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    const i = sheetStack.indexOf(close);
    if (i >= 0) sheetStack.splice(i, 1);
    setTimeout(() => wrap.remove(), 320);
    onClose?.(value);
    resolveDone(value);
  }
  backdrop.addEventListener('click', () => close());
  dragToClose(panel, body, () => close());
  sheetStack.push(close);
  return { el: panel, body, close, done };
}

/**
 * 下に引っぱると閉じる（中身が一番上までスクロールしているときだけ）。
 * 指が少し（12px）下に動くまでは何もしない。iPhone では touchmove を止める（preventDefault）と
 * そのあとのタップ（click）が起きなくなるので、ボタンを押すときの指のぶれで止めないようにする
 */
export function dragToClose(panel, scroller, onClose, handle = panel) {
  const SLOP = 12;
  let startX = 0;
  let startY = null;
  let dy = 0;
  let dragging = false;
  let startT = 0;
  handle.addEventListener(
    'touchstart',
    (e) => {
      startY = null;
      dragging = false;
      if (e.touches.length !== 1) return;
      if (scroller && scroller.scrollTop > 0 && scroller.contains(e.target)) return;
      if (e.target.closest('input, textarea, .no-drag')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dy = 0;
    },
    { passive: true },
  );
  handle.addEventListener(
    'touchmove',
    (e) => {
      if (startY == null) return;
      const t = e.touches[0];
      const moveY = t.clientY - startY;
      if (!dragging) {
        // 上や横に動いたら、引っぱる操作ではない
        if (moveY < -SLOP || Math.abs(t.clientX - startX) > SLOP) {
          startY = null;
          return;
        }
        if (moveY < SLOP) return;
        dragging = true;
        startY = t.clientY;
        startT = performance.now();
      }
      dy = Math.max(0, t.clientY - startY);
      panel.style.transition = 'none';
      panel.style.transform = `translateY(${dy}px)`;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  const end = () => {
    if (!dragging) {
      startY = null;
      return;
    }
    const v = dy / Math.max(1, performance.now() - startT);
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 110 || (dy > 30 && v > 0.5)) onClose();
    startY = null;
    dragging = false;
  };
  handle.addEventListener('touchend', end);
  handle.addEventListener('touchcancel', end);
}

/** 選択肢のシート。items: [{ label, icon?, danger?, onSelect }] */
export function actionSheet(items, { title, subtitle, header } = {}) {
  const list = h('div.actions');
  const s = sheet(
    [
      header || (title ? h('div.action-head', h('div.action-title', title), subtitle ? h('div.action-sub', subtitle) : null) : null),
      list,
    ],
    {},
  );
  for (const it of items.filter(Boolean)) {
    list.append(
      h(
        `button.action${it.danger ? '.danger' : ''}`,
        {
          type: 'button',
          onclick: () => {
            s.close();
            setTimeout(() => it.onSelect?.(), 10);
          },
        },
        it.icon ? icon(it.icon) : null,
        h('span', it.label),
      ),
    );
  }
  return s;
}

export function confirmDialog(message, { ok = 'OK', danger = false, cancel = 'キャンセル' } = {}) {
  return new Promise((resolve) => {
    const s = sheet(
      h(
        'div.dialog',
        h('p.dialog-msg', message),
        h(
          'div.dialog-buttons',
          h('button.btn.secondary', { type: 'button', onclick: () => s.close(false) }, cancel),
          h(`button.btn${danger ? '.danger' : ''}`, { type: 'button', onclick: () => s.close(true) }, ok),
        ),
      ),
      { onClose: (v) => resolve(!!v) },
    );
  });
}

export function promptDialog(message, value = '', { ok = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const input = h('input.text', { type: 'text', value, placeholder, enterkeyhint: 'done' });
    const s = sheet(
      h(
        'form.dialog',
        {
          onsubmit: (e) => {
            e.preventDefault();
            s.close(input.value.trim() || null);
          },
        },
        h('p.dialog-msg', message),
        input,
        h('div.dialog-buttons', h('button.btn.secondary', { type: 'button', onclick: () => s.close(null) }, 'キャンセル'), h('button.btn', { type: 'submit' }, ok)),
      ),
      { onClose: (v) => resolve(v ?? null) },
    );
    setTimeout(() => input.focus(), 350);
  });
}

/** ファイルを選ぶ（「ファイル」アプリが開く） */
export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve([...(input.files || [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** 長押し（指を動かしたら取り消し） */
export function onLongPress(el, fn, ms = 480) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  let fired = false;
  el.addEventListener(
    'touchstart',
    (e) => {
      fired = false;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      timer = setTimeout(() => {
        fired = true;
        navigator.vibrate?.(10);
        fn(e);
      }, ms);
    },
    { passive: true },
  );
  el.addEventListener(
    'touchmove',
    (e) => {
      if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) clearTimeout(timer);
    },
    { passive: true },
  );
  el.addEventListener('touchend', (e) => {
    clearTimeout(timer);
    if (fired && e.cancelable) e.preventDefault();
  });
  el.addEventListener('touchcancel', () => clearTimeout(timer));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!fired) fn(e);
  });
  return () => fired;
}

export function closeTopSheet() {
  const c = sheetStack[sheetStack.length - 1];
  if (c) {
    c();
    return true;
  }
  return false;
}
