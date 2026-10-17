#!/usr/bin/env bash
# テスト用の曲を ffmpeg で作る（音はただのサイン波、歌詞は自作のダミー文）
set -euo pipefail
OUT="${1:?作る場所のフォルダを指定してください}"
mkdir -p "$OUT" && cd "$OUT"
ffmpeg -loglevel error -y -f lavfi -i "color=c=0xd04080:s=500x500,drawbox=x=100:y=100:w=300:h=300:color=0x40a0ff@1:t=fill" -frames:v 1 cover.jpg
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=440:duration=30" -i cover.jpg -map 0 -map 1 -c:a libmp3lame -b:a 96k -id3v2_version 3 \
  -metadata title="テスト曲A" -metadata artist="テストアーティスト" -metadata lyrics="タグの中の歌詞" -c:v copy tagged.mp3
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=500:duration=15" -i cover.jpg -map 0 -map 1 -c:a aac -b:a 64k -c:v mjpeg -disposition:v attached_pic \
  -metadata title="タグ付きM4A" -metadata artist="M4Aの人" -metadata lyrics="[00:01.00]m4aの歌詞" tagged.m4a
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=330:duration=25" -c:a aac -b:a 96k "y2mate.is - アーティストB「夜明けの歌」Official Music Video-xyz_128k.m4a"
ffmpeg -loglevel error -y -f lavfi -i "testsrc2=s=640x360:d=20" -f lavfi -i "sine=frequency=550:duration=20" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "【MV】ひかりの道 - Video Artist.mp4"
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=660:duration=40" -c:a libmp3lame -b:a 96k "01 しずかな朝.mp3"
printf '[00:01.00]しずかな朝の一行目\n[00:04.00]ふたつめのぎょうです\n[00:08.00]<00:08.00>たん<00:09.00>ご<00:10.00>ごと\n[00:12.00]Last line in English\n' > "01 しずかな朝.lrc"
ls -la
