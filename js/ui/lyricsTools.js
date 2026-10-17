// 歌詞の検索（LRCLIB）、貼り付け・編集、タイミング合わせ、表示タイミングの補正
import { h, icon, iconButton, sheet, toast, confirmDialog, pickFiles } from './dom.js';
import * as store from '../store.js';
import * as player from '../player.js';
import { search } from '../lrclib.js';
import { parseLrc, buildLrc, formatLrcTime, plainText } from '../lrc.js';
import { formatDuration } from '../localFiles.js';

function fmtSec(sec) {
  return formatDuration(sec * 1000);
}

/** LRCLIB で歌詞を探して選ぶ */
export function openLyricsSearch(t) {
  const title = h('input.text', { value: t.title, enterkeyhint: 'search' });
  const artist = h('input.text', { value: t.artist, enterkeyhint: 'search', placeholder: '分からなければ空でOK' });
  const results = h('div');
  const status = h('p.note', { style: { margin: '10px 20px' } });
  const durSec = (t.durationMs || 0) / 1000;

  async function run(e) {
    e?.preventDefault();
    title.blur();
    artist.blur();
    results.replaceChildren();
    status.textContent = '探しています…';
    try {
      const list = await search(title.value, artist.value);
      // 長さが合うもの、タイミング付きのものを上に
      const score = (r) => (durSec && r.durationSec ? Math.abs(r.durationSec - durSec) <= 4 : 0) * 2 + (r.synced ? 1 : 0);
      list.sort((a, b) => score(b) - score(a));
      status.textContent = list.length ? `${list.length} 件見つかりました。長さが合うものがおすすめです。` : '見つかりませんでした。曲名だけにしたり、英語の表記で探したりしてみてください。';
      for (const r of list.filter((x) => !x.instrumental && (x.synced || x.plain))) {
        const diff = durSec && r.durationSec ? Math.abs(r.durationSec - durSec) : null;
        results.append(
          h(
            'button.result',
            { type: 'button', onclick: () => preview(r) },
            h('div.t', r.trackName),
            h('div.a', [r.artistName, r.albumName].filter(Boolean).join(' ・ ')),
            h(
              'div.tags',
              r.synced ? h('span.tagchip.good', 'タイミング付き') : h('span.tagchip', '文字だけ'),
              r.durationSec ? h(`span.tagchip${diff != null && diff > 4 ? '.warn' : ''}`, `${fmtSec(r.durationSec)}${diff != null ? (diff <= 4 ? '（長さが合う）' : '（長さが違う）') : ''}`) : null,
            ),
          ),
        );
      }
    } catch {
      status.textContent = '歌詞を検索できませんでした。ネットにつながっているか確かめてください。';
    }
  }

  function preview(r) {
    const text = r.synced || r.plain;
    const p = sheet(
      [
        h('div.preview', plainText(text).slice(0, 3000)),
        h(
          'div.dialog',
          h(
            'div.dialog-buttons',
            h('button.btn.secondary', { type: 'button', onclick: () => p.close() }, '戻る'),
            h(
              'button.btn',
              {
                type: 'button',
                onclick: async () => {
                  await store.saveLyrics(t.id, text);
                  p.close();
                  s.close();
                  toast(r.synced ? '歌詞を保存しました' : '歌詞を保存しました（タイミングは「タイミングを合わせる」で付けられます）', 3500);
                },
              },
              'この歌詞にする',
            ),
          ),
        ),
      ],
      { title: `${r.trackName} / ${r.artistName}` },
    );
  }

  const s = sheet(
    [
      h(
        'form.dialog',
        { onsubmit: run },
        h('label.field', h('span', '曲名'), title),
        h('label.field', h('span', 'アーティスト'), artist),
        h('button.btn', { type: 'submit', style: { width: '100%' } }, icon('search'), '探す'),
      ),
      status,
      results,
    ],
    { title: '歌詞を探す', full: true },
  );
  run();
}

/** 歌詞の文字をそのまま編集・貼り付け */
export async function openLyricsEditor(t) {
  const raw = (await store.getLyrics(t.id)) || '';
  const area = h('textarea.text', { value: raw.trim(), placeholder: '歌詞を貼り付けてください。\n[00:12.34] のような時刻付き（LRC）でも、文字だけでも大丈夫です。', spellcheck: false });
  area.style.minHeight = '46vh';
  const s = sheet(
    h(
      'div.dialog',
      area,
      h('p.note', { style: { margin: '8px 2px 0' } }, '文字だけの歌詞は、保存したあと「タイミングを合わせる」でカラオケ表示にできます。'),
      h(
        'div.dialog-buttons',
        raw
          ? h(
              'button.btn.danger',
              {
                type: 'button',
                onclick: async () => {
                  if (!(await confirmDialog('この曲の歌詞を消しますか？', { ok: '消す', danger: true }))) return;
                  await store.deleteLyrics(t.id);
                  s.close();
                  toast('歌詞を消しました');
                },
              },
              '消す',
            )
          : null,
        h(
          'button.btn',
          {
            type: 'button',
            onclick: async () => {
              const v = area.value.trim();
              if (!v) return toast('歌詞が空です');
              await store.saveLyrics(t.id, v);
              s.close();
              toast('歌詞を保存しました');
            },
          },
          '保存',
        ),
      ),
    ),
    { title: '歌詞', full: true },
  );
}

/** .lrc / .txt を選んでこの曲の歌詞にする */
export async function importLyricsFile(t) {
  const [f] = await pickFiles({ accept: '.lrc,.txt,text/plain', multiple: false });
  if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('shift_jis').decode(buf);
  }
  text = text.replace(/^﻿/, '');
  if (!text.trim()) return toast('ファイルが空でした');
  await store.saveLyrics(t.id, text);
  toast('歌詞を読み込みました');
}

/** 表示タイミングの補正（プラスで早く表示。Android 版と同じ） */
export function openOffsetSheet(t) {
  const val = h('div.val');
  const render = () => {
    const ms = store.getTrack(t.id)?.lyricsOffsetMs || 0;
    val.textContent = `${ms > 0 ? '+' : ''}${(ms / 1000).toFixed(1)} 秒`;
  };
  const change = async (d) => {
    const cur = store.getTrack(t.id)?.lyricsOffsetMs || 0;
    await store.updateTrack(t.id, { lyricsOffsetMs: d === 0 ? 0 : Math.round(cur + d) });
    render();
  };
  render();
  sheet(
    [
      h('p.note', { style: { margin: '0 20px 12px', textAlign: 'center' } }, '歌詞が遅れて見えるならプラス、早すぎるならマイナスにします。'),
      h(
        'div.offset-row',
        h('button.chip-btn', { type: 'button', onclick: () => change(-500) }, '−0.5'),
        h('button.chip-btn', { type: 'button', onclick: () => change(-100) }, '−0.1'),
        val,
        h('button.chip-btn', { type: 'button', onclick: () => change(100) }, '+0.1'),
        h('button.chip-btn', { type: 'button', onclick: () => change(500) }, '+0.5'),
      ),
      h('div', { style: { textAlign: 'center', paddingBottom: '8px' } }, h('button.chip-btn', { type: 'button', onclick: () => change(0) }, '0 に戻す')),
    ],
    { title: '歌詞の表示タイミング' },
  );
}

/** タイミング合わせ：曲を流しながら、行が始まったところでボタンを押す */
export async function openSyncEditor(t) {
  const raw = (await store.getLyrics(t.id)) || '';
  const parsed = parseLrc(raw);
  let lines = parsed.lines.filter((l) => l.text.trim()).map((l) => ({ text: l.text, ms: parsed.synced ? l.startMs : null }));
  if (!lines.length) {
    toast('先に歌詞を貼り付けるか、探してください', 3000);
    openLyricsEditor(t);
    return;
  }
  // この曲を流す
  if (player.q.currentId !== t.id) await player.playList([t.id], t.id, { shuffle: false });

  // すでにタイミングがある歌詞でも、最初の行から順に合わせ直す（行を押せば途中からやり直せる）
  let next = 0;
  const history = [];
  const listEl = h('div.sync-lines');
  const timeEl = h('div', { style: { fontVariantNumeric: 'tabular-nums', color: 'var(--sub)', fontSize: '14px', minWidth: '70px' } });
  const playBtn = iconButton(player.q.playing ? 'pause' : 'play', '再生・一時停止', () => player.toggle());

  function render() {
    listEl.replaceChildren(
      ...lines.map((l, i) =>
        h(
          `div.sync-line${l.ms != null && i < next ? '.done' : ''}${i === next ? '.next' : ''}`,
          {
            onclick: () => {
              next = i;
              if (l.ms != null) player.seek(Math.max(0, l.ms - 2000));
              render();
            },
          },
          h('span.tm', l.ms != null ? formatLrcTime(l.ms) : '--:--.--'),
          h('span', l.text),
        ),
      ),
    );
    const el = listEl.children[next];
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const tap = h(
    'button.sync-tap',
    {
      type: 'button',
      onclick: () => {
        if (next >= lines.length) return toast('最後の行まで合わせました。保存してください');
        // 押してから反応するまでの遅れを少し引く
        const ms = Math.max(0, Math.round(player.currentTimeMs() - 150));
        history.push({ i: next, prev: lines[next].ms });
        lines[next] = { ...lines[next], ms };
        next++;
        render();
      },
    },
    'この行が始まったら押す',
  );

  const unsub = player.subscribe(() => playBtn.replaceChildren(icon(player.q.playing ? 'pause' : 'play')));
  const tick = setInterval(() => (timeEl.textContent = formatLrcTime(player.currentTimeMs())), 100);

  const s = sheet(
    h(
      'div.sync',
      { style: { height: 'calc(100vh - var(--safe-top) - 80px)' } },
      h('p.note', { style: { margin: '0 20px 4px' } }, '曲を流しながら、ピンクの行が歌い始めたところで下のボタンを押します。行を押すとそこからやり直せます。'),
      listEl,
      h(
        'div.sync-pad',
        h(
          'div.row',
          playBtn,
          timeEl,
          h('button.chip-btn', { type: 'button', onclick: () => player.seek(Math.max(0, player.currentTimeMs() - 3000)) }, '3秒戻る'),
          h(
            'button.chip-btn',
            {
              type: 'button',
              onclick: () => {
                const last = history.pop();
                if (!last) return;
                lines[last.i] = { ...lines[last.i], ms: last.prev };
                next = last.i;
                render();
              },
            },
            '1つ戻す',
          ),
          h('div', { style: { flex: 1 } }),
          h(
            'button.chip-btn',
            {
              type: 'button',
              style: { background: 'var(--accent)', color: '#2b0a1c' },
              onclick: async () => {
                const timed = lines.filter((l) => l.ms != null);
                if (!timed.length) return toast('まだ1行も合わせていません');
                if (timed.length < lines.length && !(await confirmDialog(`${lines.length - timed.length} 行はまだタイミングがありません。その行は外して保存しますか？`, { ok: '保存' }))) return;
                await store.saveLyrics(t.id, buildLrc(timed.map((l) => [l.ms, l.text])));
                s.close();
                toast('タイミングを保存しました');
              },
            },
            '保存',
          ),
        ),
        tap,
      ),
    ),
    {
      title: 'タイミングを合わせる',
      full: true,
      onClose: () => {
        unsub();
        clearInterval(tick);
      },
    },
  );
  render();
}
