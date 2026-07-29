#!/bin/bash
# 生成 e2e 测试音频夹具（需要 ffmpeg）：用法 ./gen-fixtures.sh <输出目录>
set -e
OUT="${1:?用法: ./gen-fixtures.sh <输出目录>}"
mkdir -p "$OUT/sub"

# 带完整元数据的 mp3
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=2" \
  -metadata title="测试歌曲" -metadata artist="测试歌手" -metadata album="测试专辑" "$OUT/test1.mp3"
# 无标签文件（验证文件名回退）
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=550:duration=2" "$OUT/sub/无标签.m4a"
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=660:duration=2" -f flac "$OUT/sub/test3.flac"
# 带内嵌封面的 mp3（验证封面提取缓存）
ffmpeg -y -loglevel error -f lavfi -i "color=c=blue:s=64x64:d=1" -frames:v 1 "$OUT/cover.png"
ffmpeg -y -loglevel error -i "$OUT/test1.mp3" -i "$OUT/cover.png" -map 0:a -map 1:v -c copy \
  -id3v2_version 3 -metadata:s:v title="Album cover" "$OUT/test-cover.mp3"
# 非音频文件（验证过滤）
echo "not-audio" > "$OUT/note.txt"
# LRC 歌词（时间戳须在音频时长 2s 内）
printf '[ti:测试歌曲]\n[00:00.30]第一句歌词\n[00:01.00]第二句歌词\n[00:01.60]第三句歌词\n' > "$OUT/test1.lrc"
printf '[00:00.50]简体中文GBK歌词\n' | iconv -f UTF-8 -t GBK > "$OUT/test-cover.lrc"

echo "夹具已生成到 $OUT"
