# 音蔵（Otokura）iPhone 版 — 開発メモ

Ken 個人用の音楽プレーヤーの **iPhone 版（Web アプリ / PWA）**。Android 版（非公開リポジトリ `Shiro-utouto/otokura`）の再現。Ken は iPhone だけを持っている（Galaxy は友達のもの）。UI の文言はすべて日本語。

- 公開場所：GitHub Pages（`https://shiro-utouto.github.io/otokura-web/`）。iPhone の Safari で開き「ホーム画面に追加」して使う
- このリポジトリは**公開**（GitHub Pages を無料で使うため）。置くのはコードだけ。曲・歌詞・ジャケットは iPhone の中（IndexedDB）にだけ保存する
- ビルドの手順はない（素の HTML / CSS / JavaScript の ES モジュール）。`main` に push すれば Pages に出る

## Android 版との違い（決まったこと）

- **YouTube などからの取り込みは作らない**（規約のため）。曲は「ファイル」アプリから選んで追加する。Ken が自分でダウンロードサイトや a-Shell の yt-dlp を使って保存したファイルを入れるのは Ken の判断
- そのため、曲名とアーティストは「タグ → ファイル名」から推測する。ダウンロードサイトのファイル名の飾り（`y2mate.is - …`、`_128k`、`(320 kbps)` など）を外してから、Android 版の `TitleCleaner` と同じ規則で推測する（`js/localFiles.js` の `decideTitleArtist`）
- バックアップの zip は Android 版と同じ形（`manifest.json` / `library.json` / `playlists.json` / `settings.json` / `tracks/<id>/…`）。Android 版のバックアップも復元できる（deflate も読める）

## 構成

| ファイル | 役割 |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js` | 入口、ホーム画面に追加したときの情報、オフライン用の Service Worker（`APP_FILES` と `VERSION`） |
| `js/main.js` | 起動、タブ（ライブラリ / 検索 / 設定） |
| `js/db.js` | IndexedDB（`kv` / `files` / `lyrics`）。版付き JSON の読み書きと変換（`FORMATS`、`upgrade`） |
| `js/store.js` | 曲・プレイリスト・設定の状態と変更通知 |
| `js/player.js` | 再生（audio 要素1つ）、キュー（`order` と `base`）、シャッフル、リピート、次に再生、Media Session（ロック画面）、前回の続き（`kv` の `session`） |
| `js/importer.js` | 曲の追加（中身をコピーして保存、重複は「名前＋大きさ」で判定）、同じ名前の .lrc（歌詞）と画像（ジャケット）、歌詞の自動取得の順番待ち |
| `js/tags.js` | タグ読み取り：mp3（ID3v2.2〜2.4、USLT と TXXX の歌詞、APIC、長さ）、m4a / mp4（ilst、mvhd の長さ、映像の有無）、FLAC |
| `js/mp4audio.js` | mp4 の動画から音声（AAC）だけを取り出して m4a にする（変換なし・音は同じ）。音声のトラックだけ残し、チャンクを並べ直して stco / co64 を書き換える |
| `js/image.js` | ジャケットの縮小、背景のグラデーション用の色、動画の1コマ、長さの調査（`probeMedia`） |
| `js/lrc.js`, `js/karaoke.js` | Android 版 `Lrc.kt` / `Karaoke.kt` の移植 |
| `js/titleCleaner.js`, `js/localFiles.js` | Android 版 `TitleCleaner.kt` / `LocalFiles.kt` の移植 ＋ ダウンロードサイトのファイル名対応 |
| `js/lrclib.js` | LRCLIB の検索と自動取得（Android 版 `LrcLib.kt` / `LyricsRepository.autoFetch` の移植：長さ ±4 秒、入れ替えて再検索、`looksSwapped` で直す） |
| `js/zip.js`, `js/backup.js` | zip の読み書き、バックアップと復元（統合） |
| `js/ui/*.js` | 画面。`dom.js`（部品・シート・アイコン）、`library.js`、`nowplaying.js`（ミニプレーヤー・再生画面・歌詞・キュー）、`lyricsTools.js`（歌詞の検索・編集・タイミング合わせ・補正）、`common.js`（曲の行とメニュー、追加）、`search.js`、`settings.js`、`install.js` |

## 守ること

- DRM の解除や回避の機能は作らない。YouTube などのサイトから取ってくる機能は作らない
- 歌詞は同梱しない。LRCLIB から取得するか、ユーザーが入れたものだけ。テスト用の歌詞は自作のダミー文
- 既存のデータを壊さない。保存する JSON には `formatVersion`。形式を変えるときは版を上げて `db.js` の `FORMATS[...].migrations` に変換を足し、テストを書く（古い変換は消さない）。変換前の元データは `kv` の `backup:<名前>:<日時>` に控える
- バックアップの形式を変えるときも、古いバックアップ（Android 版のものも）を読めるようにする
- 他社のロゴ・アイコン・商標は使わない（Apple Music は雰囲気だけ参考）。アイコンは Android 版と同じ自作の音符と波
- アプリのファイルを足したら `sw.js` の `APP_FILES` に足し、`VERSION` を上げる（上げないと iPhone で古いファイルが使われ続けることがある）
- 返答は途中の短い説明も含めてすべて日本語。コミットメッセージも Ken が読んで分かる日本語
- コミットは `git -c user.name=Shiro-utouto -c user.email=ninten2017@gmail.com commit …`

## iPhone（Safari）で気をつけること

- 音は「指で触った直後」でないと出せない。最初のタッチで audio を無音で鳴らして「起こす」（`player.js` の `unlockAudio`）
- 共有シート（`navigator.share`）も指で押した直後しか開けない。バックアップは作ったあとに「保存する」をもう一度押してもらう
- ロック画面のジャケットは data: の URL で渡す（blob: だと出ないことがある）
- 長さは、まずタグ（mp3 のフレーム、mp4 の mvhd）から取る。iPhone は再生するまで video / audio を読み込まないことがあるので、`probeMedia` は 5 秒で諦める。再生したときに本当の長さで直す
- Safari のタブとホーム画面のアプリは保存場所が別。ホーム画面に追加して使う。`navigator.storage.persist()` を頼む
- 歌詞の上下の余白は `padding` ではなく、中に置いた `.lyr-space` で作る（`padding: 30vh … 45vh` だと iPhone の画面では箱が縮まず、歌詞が操作ボタンの上にはみ出してボタンが押せなかった。2026-10-18）
- `File` をそのまま IndexedDB に入れず、`arrayBuffer()` でコピーしてから保存する
- **yt-dlp の 1080p の mp4 は映像が AV1 などで、iPhone によっては映像も音声も再生できない**（2026-10-17、Ken の iPhone で「この形式は iPhone で再生できないようです」）。そのため動画は取り込み時に音声だけの m4a にする（設定 `videoAsAudio`、最初はオン）。再生に失敗した動画の曲も、その場で音声だけにしてから再生し直す（`player.js` の `recoverFromError`）。設定にまとめて変えるボタンもある。音声が Opus の mp4 は取り出せない

## テスト

```
node --test tests/*.mjs                       # ロジック（曲名の推測、LRC、カラオケ、歌詞の自動取得）
bash tests/make-media.sh /tmp/media           # テスト用の曲を ffmpeg で作る
MEDIA=/tmp/media node --test tests/*.mjs      # タグ読み取りのテストも
```

画面の確認は、`python3 -m http.server` で配り、Playwright の Chromium を iPhone の大きさ（393×852、タッチあり）で動かして行った（LRCLIB は `page.route` で差し替え）。Chromium は AAC / H.264 を再生できないので、m4a / mp4 の長さやジャケットの1コマはこの環境では確かめられない（iPhone では動く想定。長さはタグからも取る）。最後は Ken の iPhone で確かめてもらう。

## 状態（2026-10-17）

- 最初の版を作った：ファイルからの追加、ライブラリ（プレイリスト / 曲 / アーティスト、複数選択）、再生画面（ジャケットの色の背景、歌詞のカラオケ表示・ぼかし・ばねのスクロール・行タップ・3秒の手動スクロール）、キュー、シャッフル・リピート、歌詞の検索・貼り付け・タイミング合わせ・表示タイミング、曲の編集、検索、バックアップと復元、オフライン
- Ken の iPhone で、歌詞の自動取得（LRCLIB）が動くのを確認（2026-10-17）。a-Shell の yt-dlp で取った 1080p の mp4 が再生できなかった → 音声だけにする仕組みを足した
- まだ：動画の曲の映像の表示はない（音声だけにして保存するのが基本）
