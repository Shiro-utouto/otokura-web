// 歌詞・曲名の推測などのロジックのテスト（node --test tests/）
// 多くは Android 版のユニットテストと同じ例。歌詞は自作のダミー文
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guess, cleanArtist, looksSwapped } from '../js/titleCleaner.js';
import { guessFromFileName, decideTitleArtist, stripDownloaderNoise } from '../js/localFiles.js';
import { parseLrc, withoutCredits, buildLrc } from '../js/lrc.js';
import { litChars, currentIndex } from '../js/karaoke.js';
import { autoFetch, setFetch } from '../js/lrclib.js';

const g = (t, ch = '') => guess(t, ch, false);

test('YouTube のタイトルの付け方', () => {
  const cases = [
    ['Artist - Song (Official Music Video)', 'ArtistVEVO', ['Song', 'Artist']],
    ['Artist - Song [Official Audio]', '', ['Song', 'Artist']],
    ['Artist - Song | Official Visualizer', '', ['Song', 'Artist']],
    ['アーティスト『曲名』MV', 'アーティスト Official', ['曲名', 'アーティスト']],
    ['アーティスト「曲名」Official Music Video', '', ['曲名', 'アーティスト']],
    ['曲名 / アーティスト', '', ['曲名', 'アーティスト']],
    ['【MV】曲名 / アーティスト', '', ['曲名', 'アーティスト']],
    ['曲名 / アーティスト 【公式】', '', ['曲名', 'アーティスト']],
    ['曲名 (Music Video)', 'アーティスト - Topic', ['曲名', 'アーティスト']],
    ['曲名 ミュージックビデオ', 'アーティスト公式チャンネル', ['曲名', 'アーティスト']],
    ['【初音ミク】曲名', '', ['曲名', '初音ミク']],
    ['【初音ミク】曲名', 'ボカロP', ['曲名', 'ボカロP']],
    ['【歌ってみた】曲名', '', ['曲名', '']],
    ['Amazing Grace - "The President\'s Own" U.S. Marine Band - Tour 2016', 'United States Marine Band', ['Amazing Grace', 'United States Marine Band']],
    ['Song - Artist', 'Artist', ['Song', 'Artist']],
    ['Artist - Song', 'Artist', ['Song', 'Artist']],
    ['曲名 / アーティスト', 'アーティスト', ['曲名', 'アーティスト']],
    ['アーティスト / 曲名', 'アーティスト公式チャンネル', ['曲名', 'アーティスト']],
  ];
  for (const [title, ch, expected] of cases) assert.deepEqual(g(title, ch), expected, title);
});

test('アニメの曲（Android 版で逆になった実例）', () => {
  const remember = '【Official MV】Remember – yuigot / 月見ヤチヨ(cv.早見沙織) from 超かぐや姫！';
  const ray = '【Official MV】ray 超かぐや姫！Version / かぐや (cv.夏吉ゆうこ)、月見ヤチヨ (cv.早見沙織) from #超かぐや姫！';
  for (const ch of ['『超かぐや姫 ! 』公式', '', '早見沙織', 'yuigot', '月見ヤチヨ(cv.早見沙織)']) {
    assert.deepEqual(g(remember, ch), ['Remember', 'yuigot / 月見ヤチヨ'], `Remember / ${ch}`);
    assert.deepEqual(g(ray, ch), ['ray 超かぐや姫！Version', 'かぐや、月見ヤチヨ'], `ray / ${ch}`);
  }
});

test('かっこの中の歌声だけで決めない', () => {
  assert.deepEqual(g('じん / ロスタイムメモリー (IA)【OFFICIAL MUSIC VIDEO】', 'IA PROJECT'), ['じん', 'ロスタイムメモリー']);
});

test('ニコニコ動画の付け方', () => {
  assert.deepEqual(g('『初音ミク』千本桜『オリジナル曲PV』', '黒うさ'), ['千本桜', '黒うさ']);
  assert.deepEqual(g('『初音ミク』千本桜『オリジナル曲PV』', ''), ['千本桜', '初音ミク']);
  assert.deepEqual(g('【初音ミク】曲名【オリジナルMV】', 'ボカロP'), ['曲名', 'ボカロP']);
  assert.deepEqual(g('【鏡音リン・レン】曲名【オリジナル】', 'ボカロP'), ['曲名', 'ボカロP']);
  assert.deepEqual(g('【GUMI】曲名【Official MV】', 'ボカロP'), ['曲名', 'ボカロP']);
  assert.deepEqual(g('アーティスト『Original Sin』', ''), ['Original Sin', 'アーティスト']);
});

test('入れ替わりの判定とチャンネル名', () => {
  assert.ok(looksSwapped('じん', 'ロスタイムメモリー', 'ロスタイムメモリー', 'じん'));
  assert.ok(looksSwapped('じん', 'ロスタイムメモリー', 'ロスタイムメモリー', 'IA'));
  assert.ok(!looksSwapped('ロスタイムメモリー', 'じん', 'ロスタイムメモリー', 'じん'));
  assert.ok(!looksSwapped('Weezer', 'Weezer', 'Weezer', 'Weezer'));
  assert.ok(!looksSwapped('曲名', '', '曲名', '誰か'));
  assert.equal(cleanArtist('Artist - Topic'), 'Artist');
  assert.equal(cleanArtist('ArtistVEVO'), 'Artist');
  assert.equal(cleanArtist('Artist Official YouTube Channel'), 'Artist');
  assert.equal(cleanArtist('アーティスト公式チャンネル'), 'アーティスト');
  assert.equal(cleanArtist('VEVO'), 'VEVO');
});

test('ファイル名からの推測（Android 版と同じ）', () => {
  const cases = [
    ['01 曲名.mp3', ['曲名', '']],
    ['01. 曲名.mp3', ['曲名', '']],
    ['1-02 曲名.flac', ['曲名', '']],
    ['アーティスト - 曲名.flac', ['曲名', 'アーティスト']],
    ['03 - アーティスト - 曲名.m4a', ['曲名', 'アーティスト']],
    ['Artist_-_Song_Title.mp3', ['Song Title', 'Artist']],
    ['曲名', ['曲名', '']],
    ['7 Rings.mp3', ['7 Rings', '']],
    ['1984.mp3', ['1984', '']],
  ];
  for (const [name, expected] of cases) assert.deepEqual(guessFromFileName(name), expected, name);
});

test('ダウンロードサイトのファイル名', () => {
  assert.equal(stripDownloaderNoise('y2mate.com - Artist - Song (Official Video)'), 'Artist - Song (Official Video)');
  assert.equal(stripDownloaderNoise('Artist - Song (128 kbps)'), 'Artist - Song');
  assert.equal(stripDownloaderNoise('Artist - Song_320k'), 'Artist - Song');
  assert.equal(stripDownloaderNoise('[ytmp3.cc] 曲名 / アーティスト'), '曲名 / アーティスト');
  assert.deepEqual(decideTitleArtist('y2mate.is - アーティスト「曲名」Official Music Video-abc_128k.mp3', '', ''), ['曲名', 'アーティスト']);
  assert.deepEqual(decideTitleArtist('Artist - Song (Official Video).mp3', '', ''), ['Song', 'Artist']);
  assert.deepEqual(decideTitleArtist('【MV】曲名 / アーティスト.m4a', '', ''), ['曲名', 'アーティスト']);
  assert.deepEqual(decideTitleArtist('01 曲名.mp3', '', ''), ['曲名', '']);
  // タグがきれいならそのまま
  assert.deepEqual(decideTitleArtist('x.mp3', 'Song', 'Artist'), ['Song', 'Artist']);
  // タグの曲名が動画タイトルなら、タグのアーティストをチャンネル名として推測
  assert.deepEqual(decideTitleArtist('x.mp3', '曲名 (Music Video)', 'アーティスト - Topic'), ['曲名', 'アーティスト']);
  // アーティストの欄がサイト名なら使わない
  assert.deepEqual(decideTitleArtist('x.mp3', 'Artist - Song', 'y2mate.com'), ['Song', 'Artist']);
});

test('LRC の読み取り', () => {
  const l = parseLrc('[ti:ダミー]\n[offset:500]\n[00:01.00]はじめの行\n[00:03.50][00:10.00]くりかえし\n[00:05.00]<00:05.00>たん<00:05.50>ご<00:06.00>');
  assert.ok(l.synced);
  assert.equal(l.lines.length, 4);
  assert.equal(l.lines[0].startMs, 500);
  assert.equal(l.lines[1].text, 'くりかえし');
  assert.equal(l.lines[1].words, null);
  assert.equal(l.lines[2].text, 'たんご');
  assert.equal(l.lines[2].words.length, 2);
  assert.equal(l.lines[2].words[1].endMs, 5500);
  const p = parseLrc('\n\nテキストだけ\n\nの歌詞\n');
  assert.ok(!p.synced);
  assert.deepEqual(p.lines.map((x) => x.text), ['テキストだけ', '', 'の歌詞']);
  const c = withoutCredits(parseLrc('[00:00.10]作詞 : だれか\n[00:01.00]本文'));
  assert.deepEqual(c.lines.map((x) => x.text), ['本文']);
  assert.equal(buildLrc([[61230, 'b'], [1000, 'a']]), '[00:01.00]a\n[01:01.23]b');
});

test('カラオケの塗り', () => {
  const line = { startMs: 1000, text: 'あいうえお', words: null };
  assert.equal(litChars(line, 5000, 500), 0);
  assert.equal(litChars(line, 5000, 100000), 5);
  const mid = litChars(line, 5000, 1800);
  assert.ok(mid > 0 && mid < 5);
  const w = { startMs: 0, text: 'たんご', words: [{ startMs: 0, text: 'たん' }, { startMs: 1000, text: 'ご', endMs: 2000 }] };
  assert.equal(litChars(w, null, 500), 1);
  assert.equal(litChars(w, null, 1500), 2.5);
  assert.equal(currentIndex([{ startMs: 0 }, { startMs: 1000 }, { startMs: 2000 }], 1500), 1);
  assert.equal(currentIndex([{ startMs: 1000 }], 500), -1);
});

function fakeLrclib(db) {
  setFetch(async (url) => {
    const u = new URL(url);
    const t = u.searchParams.get('track_name');
    const a = u.searchParams.get('artist_name');
    const q = u.searchParams.get('q');
    const hits = db.filter((r) => (t ? r.trackName === t : true) && (a ? r.artistName === a : true) && (q ? q.includes(r.trackName) && q.includes(r.artistName) : true));
    return { ok: true, json: async () => hits };
  });
}

test('歌詞の自動取得：長さが合わない候補は使わない', async () => {
  fakeLrclib([
    { id: 1, trackName: '曲', artistName: '人', duration: 239, syncedLyrics: '[00:01.00]ちがう版' },
    { id: 2, trackName: '曲', artistName: '人', duration: 150, syncedLyrics: '[00:01.00]あう版' },
  ]);
  const r = await autoFetch({ title: '曲', artist: '人', durationMs: 149000 });
  assert.equal(r.lyrics, '[00:01.00]あう版');
});

test('歌詞の自動取得：逆の推測を入れ替えて探し、直すべきと分かる', async () => {
  fakeLrclib([{ id: 1, trackName: 'ロスタイムメモリー', artistName: 'じん', duration: 200, syncedLyrics: '[00:01.00]ダミー' }]);
  const r = await autoFetch({ title: 'じん', artist: 'ロスタイムメモリー', durationMs: 200000 });
  assert.equal(r.lyrics, '[00:01.00]ダミー');
  assert.ok(r.swap);
});

test('歌詞の自動取得：見つからなければファイルの中の歌詞', async () => {
  fakeLrclib([]);
  const r = await autoFetch({ title: 'x', artist: 'y', durationMs: 1000 }, 'ファイルの歌詞');
  assert.equal(r.lyrics, 'ファイルの歌詞');
  assert.equal(r.source, 'file');
});
