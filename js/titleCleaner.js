// 動画タイトルから「曲名」と「アーティスト名」を推測する（Android 版 download/TitleCleaner.kt の移植）
// 例: "アーティスト「曲名」Official Music Video" → 曲名 / アーティスト
//     "Artist - Song (Official Video)"          → Song / Artist
//     "【MV】曲名 / アーティスト"                  → 曲名 / アーティスト
//     "『初音ミク』曲名『オリジナル曲PV』"（ニコニコ動画） → 曲名 / 投稿者

const BRACKETED = /[\(\[【（〔［][^\)\]】）〕］]*[\)\]】）〕］]/gu;

/** 英語の飾り（単語の途中には一致させない） */
const NOISE =
  /(?<![\p{L}\p{N}])(official\s*(music\s*)?(video|audio|mv|lyric\s*video|visualizer)|music\s*(video|clip)|lyric\s*video|lyrics?|visualizer|full\s*ver(sion)?\.?|mv|pv|hd|4k|audio)(?![\p{L}\p{N}])/giu;

/** 日本語の飾り */
const NOISE_JA = /(ミュージックビデオ|オフィシャル|公式|フルバージョン|フル\s*ver\.?|歌詞付き?)/giu;

const QUOTED = /^(.*?)[「『](.+?)[」』](.*)$/su;
const LEADING_BRACKET = /^\s*【([^】]+)】(.*)$/su;

/** 先頭の【】の中でも、アーティスト名ではないもの */
const NOT_ARTIST = /(歌ってみた|弾いてみた|踊ってみた|叩いてみた|cover|カバー|ライブ|live|新曲|初公開|切り抜き|mad|amv|nightcore)/iu;

/** true = 「アーティスト - 曲名」の順（YouTube に多い）、false = 「曲名 / アーティスト」の順（日本の動画に多い） */
const SEPARATORS = [
  [' - ', true],
  [' – ', true],
  [' — ', true],
  [' / ', false],
  ['／', false],
  [' | ', false],
];

/** 『』【】で囲んだ部分 */
const TAG_SEGMENT = /[『【]([^』】]+)[』】]/gu;

/** 歌声合成ソフトの名前（かっこの中にこれだけがあれば、曲名ではなく歌い手） */
const VOICE_SYNTH =
  /^(初音ミク|鏡音リン|鏡音レン|巡音ルカ|KAITO|MEIKO|GUMI|Megpoid|IA|ONE|重音テト|可不|KAFU|星界|裏命|結月ゆかり|紲星あかり|v\s*flower|flower|歌愛ユキ|神威がくぽ|がくっぽいど|猫村いろは|MAYU|Fukase|ずんだもん|東北きりたん|東北ずん子|知声|音街ウナ|小春六花|夏色花梨|花隈千冬|琴葉茜|琴葉葵|四国めたん|春日部つむぎ|足立レイ|歌愛ユキ|VY1|VY2)(\s*(v\d\w*|nt|append|dark|soft|sweet|light|solid|power|english|x))?$/iu;

/** 曲名ではない飾りのかっこ（「オリジナル曲PV」「Official MV」「MV」など） */
const TAG_DESCRIPTOR =
  /^\s*(オリジナル曲?|オリジナルソング|original(\s*song)?|公式|official|新曲)?\s*(mv|pv|music\s*video|ミュージックビデオ|full|フル)?\s*$/iu;

const ARTIST_CUE =
  /(\s\/\s|／|、|\s&\s|\s×\s|(?<![\p{L}\p{N}])(feat\.?|ft\.|featuring)(?![\p{L}\p{N}])|(^|\s)from\s|(?<![\p{L}\p{N}])(cv|vo)\s*[.:：])/iu;

function isSinger(c) {
  const parts = c
    .split(/[・&×、,＆]|\s+and\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => VOICE_SYNTH.test(p));
}

function trimChars(s, set) {
  let a = 0;
  let b = s.length;
  while (a < b && set.includes(s[a])) a++;
  while (b > a && set.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function clean(s) {
  const t = s.replace(BRACKETED, ' ').replace(NOISE, ' ').replace(NOISE_JA, ' ').replace(/\s+/gu, ' ');
  return trimChars(t, ' -|/／・　');
}

function tokens(s) {
  return new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

function squash(s) {
  return Array.from(s.toLowerCase())
    .filter((c) => /[\p{L}\p{N}]/u.test(c))
    .join('');
}

/** チャンネル名が丸ごと含まれていれば 1、そうでなければ 0 */
function fullMatch(side, channel) {
  const b = squash(channel);
  return b && squash(side).includes(b) ? 1 : 0;
}

/** 0〜1。チャンネル名の単語がどれだけ含まれているか */
function channelScore(side, channel) {
  if (!channel) return 0;
  const a = squash(side);
  const b = squash(channel);
  if (b && (a === b || a.includes(b))) return 1;
  const ct = tokens(channel);
  if (!ct.size) return 0;
  const st = tokens(side);
  let n = 0;
  for (const t of ct) if (st.has(t)) n++;
  return n / ct.size;
}

function looksLikeArtists(s) {
  return ARTIST_CUE.test(s);
}

/** 末尾の「from 作品名」は作品名なので外す */
function artistSide(s) {
  const r = s
    .replace(/\s+from\s+.*$/iu, '')
    .replace(/\s+([、，,])/gu, '$1')
    .trim();
  return r || s.trim();
}

function artistName(side, channel) {
  if (squash(side) === squash(channel)) return side;
  if (looksLikeArtists(side)) return artistSide(side);
  return channel;
}

/** チャンネル名を整える（「- Topic」「VEVO」「Official」「公式チャンネル」などを外す） */
export function cleanArtist(s) {
  let a = s.replace(BRACKETED, ' ').trim();
  const suffixes = [
    /\s*-\s*topic$/iu,
    /\s*official\s*(youtube\s*)?channel$/iu,
    /(公式|オフィシャル)\s*(youtube\s*)?チャンネル$/iu,
    /(?<=\S)vevo$/iu,
    /\s*official$/iu,
    /\s*公式$/u,
    /\s+channel$/iu,
    /\s*チャンネル$/u,
  ];
  for (;;) {
    const before = a;
    for (const r of suffixes) a = a.replace(r, '').trim();
    if (a === before) break;
  }
  return a || s.trim();
}

/** [曲名, アーティスト] を返す */
export function guess(rawTitle, rawArtist = '', fromMusicMetadata = false) {
  if (fromMusicMetadata) return [rawTitle.trim(), cleanArtist(rawArtist)];
  const original = rawTitle.trim();
  const channel = cleanArtist(rawArtist);

  // 『』【】の中が歌声合成ソフトの名前や「オリジナル曲PV」だけなら外してから考える
  let singer = null;
  let rest = original;
  for (const m of original.matchAll(TAG_SEGMENT)) {
    const c = m[1].trim();
    if (isSinger(c)) {
      if (singer == null) singer = c;
      rest = rest.replaceAll(m[0], ' ');
    } else if (c && TAG_DESCRIPTOR.test(c)) {
      rest = rest.replaceAll(m[0], ' ');
    }
  }
  if (rest !== original && rest.trim()) {
    const [t, a] = guess(rest.replace(/\s+/gu, ' ').trim(), rawArtist, false);
    return [t, a || singer || ''];
  }

  const q = QUOTED.exec(original);
  if (q) {
    const before = clean(q[1]);
    const song = q[2].trim();
    if (song) return [song, before || channel];
  }

  const cleaned = clean(original);
  for (const [sep, artistFirst] of SEPARATORS) {
    const idx = cleaned.indexOf(sep);
    if (idx > 0) {
      const left = cleaned.slice(0, idx).trim();
      const right = cleaned.slice(idx + sep.length).trim();
      if (left && right) {
        const rawIdx = original.indexOf(sep);
        const rawLeft = rawIdx > 0 ? original.slice(0, rawIdx) : left;
        const rawRight = rawIdx > 0 ? original.slice(rawIdx + sep.length) : right;

        // 1. チャンネル名と重なる側がアーティスト
        const l = Math.max(channelScore(left, channel), fullMatch(rawLeft, channel));
        const r = Math.max(channelScore(right, channel), fullMatch(rawRight, channel));
        if (l >= 0.5 && l > r) return [right, artistName(left, channel)];
        if (r >= 0.5 && r > l) return [left, artistName(right, channel)];

        // 2. 「A / B」「feat.」「from 作品名」「cv.」などの印が片側にだけあれば、そちらがアーティスト
        const lc = looksLikeArtists(left);
        const rc = looksLikeArtists(right);
        if (lc && !rc) return [right, artistSide(left)];
        if (rc && !lc) return [left, artistSide(right)];

        // 3. 決まらなければ YouTube に多い順
        return artistFirst ? [right, artistSide(left)] : [left, artistSide(right)];
      }
    }
  }

  // 「【初音ミク】曲名」：チャンネル名が分からないときだけ、先頭の【】をアーティストにする
  if (!channel) {
    const m = LEADING_BRACKET.exec(original);
    if (m) {
      const who = clean(m[1]);
      if (who && !NOT_ARTIST.test(who)) return [cleaned || original, who];
    }
  }
  return [cleaned || original, channel];
}

/** 歌詞のデータベースで見つかった曲名・アーティストと比べて、推測が逆になっていそうか */
export function looksSwapped(title, artist, foundTrack, foundArtist) {
  const similar = (a, b) => {
    const x = squash(a);
    const y = squash(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  };
  if (!artist.trim()) return false;
  return (
    similar(foundTrack, artist) &&
    !similar(foundTrack, title) &&
    (!foundArtist.trim() || similar(foundArtist, title) || !similar(foundArtist, artist))
  );
}
