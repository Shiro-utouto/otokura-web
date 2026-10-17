import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readTags } from '../js/tags.js';
// 曲のファイルは tests/make-media.sh で作る（MEDIA にそのフォルダを指定）
const dir = process.env.MEDIA;
const media = dir ? test : test.skip;
const blob = (f) => new Blob([fs.readFileSync(`${dir}/${f}`)]);
media('mp3 の ID3', async () => {
  const t = await readTags(blob('tagged.mp3'));
  assert.equal(t.title, 'テスト曲A');
  assert.equal(t.artist, 'テストアーティスト');
  assert.equal(t.lyrics, 'タグの中の歌詞'); // ffmpeg は TXXX:lyrics に入れる
  assert.ok(t.picture && t.picture.size > 1000, 'cover');
  assert.equal(t.picture.type, 'image/jpeg');
});
media('m4a のタグ', async () => {
  const t = await readTags(blob('tagged.m4a'));
  assert.equal(t.title, 'タグ付きM4A');
  assert.equal(t.artist, 'M4Aの人');
  assert.equal(t.lyrics, '[00:01.00]m4aの歌詞');
  assert.ok(t.picture && t.picture.size > 1000, 'cover');
  assert.equal(t.hasVideo, false);
});
media('mp4 の映像判定', async () => {
  const t = await readTags(blob('【MV】ひかりの道 - Video Artist.mp4'));
  assert.ok(t.hasVideo);
});
media('タグなし', async () => {
  const t = await readTags(blob('01 しずかな朝.mp3'));
  assert.equal(t.title, undefined);
});
// USLT（UTF-16、Android 版の書き出しと同じ形）を自分で作って確かめる
function id3WithUslt(text) {
  const enc = (s) => { const b = Buffer.from('﻿' + s, 'utf16le'); return b; };
  const body = Buffer.concat([Buffer.from([1]), Buffer.from('jpn'), enc(''), Buffer.from([0, 0]), enc(text)]);
  const frame = Buffer.concat([Buffer.from('USLT'), Buffer.from([0, 0, (body.length >> 8) & 255, body.length & 255, 0, 0]), body]);
  const tit = Buffer.concat([Buffer.from([3]), Buffer.from('曲', 'utf8')]);
  const f2 = Buffer.concat([Buffer.from('TIT2'), Buffer.from([0, 0, 0, tit.length, 0, 0]), tit]);
  const all = Buffer.concat([f2, frame]);
  const n = all.length;
  const hdr = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
  return new Blob([hdr, all, Buffer.alloc(200)]);
}
test('USLT の歌詞', async () => {
  const t = await readTags(id3WithUslt('[00:01.00]一行目\n二行目'));
  assert.equal(t.title, '曲');
  assert.equal(t.lyrics, '[00:01.00]一行目\n二行目');
});
