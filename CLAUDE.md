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
| `js/main.js` | 起動、タブ（ライブラリ / ブラウザ / 設定）。検索はライブラリの一番上の検索欄 |
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
| `js/ui/feel.js` | さわり心地：押すと縮んでばねで戻る（`.pressed`）、触覚フィードバック（iOS 18 の `<input type=checkbox switch>` を見えないところで押すと振動する。指で押した直後だけ。設定 `haptics`） |
| `js/ui/*.js` | 画面。`dom.js`（部品・シート・アイコン）、`library.js`（見出しと検索欄は作り直さない。作り直すと入力中に文字が打てなくなる）、`browser.js`（よく使うサイトと URL・言葉で開く。サイトは iPhone の仕組みで音蔵の上に Safari の画面で開く。データは `js/bookmarks.js`、kv の `bookmarks`、バックアップの `bookmarks.json`。最初は Google・YouTube・ニコニコ。ロゴは使わず頭文字）、`nowplaying.js`（ミニプレーヤー・再生画面・歌詞・キュー）、`lyricsTools.js`（歌詞の検索・編集・タイミング合わせ・補正）、`common.js`（曲の行とメニュー、追加）、`settings.js`、`install.js` |

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
- ロック画面・コントロールセンターから操作したときに音が消えることがあった（2026-10-18、Ken の報告）。押されてから IndexedDB を読んだり、ジャケットを読んだりして `await` してから `play()` すると、iPhone が「押した直後」と見なさなくなるため。今の曲と前後の曲の blob URL を先に用意しておき（`player.js` の `urlCache` / `prefetch`）、押されたら待たずに `play()` する。ロック画面の情報（ジャケット）は再生のあとで更新する
- ロック画面のボタンは、iPhone が最初から「10秒戻る / 進む」を出す。`seekbackward` / `seekforward` を `null` にしないと「前の曲 / 次の曲」が出ない（2026-10-18）。曲を切り替えるたびに付け直す（`setupRemoteControls`）。ロック画面に次の曲の一覧を出す仕組みは Web にはない
- ロック画面のジャケットは data: の URL で渡す（blob: だと出ないことがある）
- 長さは、まずタグ（mp3 のフレーム、mp4 の mvhd）から取る。iPhone は再生するまで video / audio を読み込まないことがあるので、`probeMedia` は 5 秒で諦める。再生したときに本当の長さで直す
- Safari のタブとホーム画面のアプリは保存場所が別。ホーム画面に追加して使う。`navigator.storage.persist()` を頼む
- **iPhone では touchmove を `preventDefault` すると、そのあとの click が起きない**。下に引っぱって閉じる（`dom.js` の `dragToClose`）は、指が 12px 下に動くまで何もしない。前は 1px で止めていたので、再生画面のボタンが指のぶれで反応しなかった（2026-10-18。Chromium ではこの違いが再現しない）
- アプリの版は `sw.js` の `VERSION` と `backup.js` の `APP_VERSION` を同じ番号で上げる（設定の画面に出るので、Ken の iPhone が新しい版になったか分かる）
- 歌詞のスクロール（`nowplaying.js` の `lyricsFrame`）：指で動かしたら、最後に動いてから3秒（慣性のスクロール中も延ばす）は自動で戻さない。一時停止中に動かしたら再生するまで戻さない。戻るときはゆっくりのばね。曲の情報が変わっただけ（長さの修正など）では歌詞を作り直さない（前は作り直して一番上から「ギュン」と戻っていた。2026-10-18）。開いたときはすぐ今の行に合わせる（`np.snap`）
- 最初のタッチで audio を「起こす」とき、同じタップで再生も押されていたら止めない（`playToken`。前は押した曲がすぐ止まることがあった）
- 歌詞の上下の余白は `padding` ではなく、中に置いた `.lyr-space` で作り、高さは箱の高さから決める（上 28%、下 40%。`sizeSpacers`）（`padding: 30vh … 45vh` だと iPhone の画面では箱が縮まず、歌詞が操作ボタンの上にはみ出してボタンが押せなかった。2026-10-18）
- **iPhone の Web アプリは画面の向きを固定できない**（manifest の `orientation` も `screen.orientation.lock` も効かない）。横向きは `css/app.css` の最後の `@media (orientation: landscape) and (max-height: 600px)` で並べ方を変える（再生画面は右に曲名と操作（右手で押しやすいように）、左にジャケット・歌詞・キュー。左右のカメラの出っぱりは `safe-area-inset-left/right` で避ける。2026-10-18）
- 歌詞が今の行を追わなくなることがあった（2026-10-18、Ken の報告。アプリを閉じると直る）。考えられる原因2つを直した：Ken の画面録画では、スクロールとぼかしは動くのに今の行の色（カラオケ）だけ光らなかった。iPhone が戻ったあと歌詞の中の色の変化を描き直さないことがあるとみて、戻ってきたとき（`visibilitychange` / `pageshow`）と再生画面を開くたびに歌詞を作り直すようにした（`np.panelFor = null`）。ほかに：毎フレームの処理（`loop`）で1回でも失敗すると次のフレームを頼まずに止まっていた → 先に次を頼み、失敗は握りつぶす。歌詞に触れた状態（`np.touching`）が、歌詞の外で指を離したときや touchcancel で残っていた → document で拾って戻す
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
