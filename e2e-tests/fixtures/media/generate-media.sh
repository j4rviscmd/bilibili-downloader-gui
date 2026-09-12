#!/bin/sh
# Regenerates the committed E2E media fixtures. Run locally with ffmpeg on
# PATH; outputs are committed so CI never depends on ffmpeg at test time.
#
# Requirements the fixtures must satisfy (see e2e-tests/helpers/fixture-server.ts
# and the download pipeline they feed):
# - Real demuxable MP4s: the backend merges with `ffmpeg -c:v copy -c:a copy`
#   and runs an integrity demux on the video stream.
# - Larger than MIN_MEDIA_BYTES (1 KiB) or the downloader rejects them.
# - Smaller than the 32 MiB segment size so each downloads as one segment.
set -e
cd "$(dirname "$0")"

# Video-only H.264 MP4: testsrc pattern, baseline profile, yuv420p so any
# decoder handles it; +faststart keeps ftyp as the first box (the E2E spec
# asserts that magic).
ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=2:size=160x120:rate=15 \
  -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart -an \
  video-only.mp4

# Audio-only AAC MP4: 32 kbps sine tone.
ffmpeg -y -loglevel error -f lavfi -i sine=frequency=440:duration=2 \
  -c:a aac -b:a 32k -movflags +faststart -vn \
  audio-only.mp4

# Fail loudly now instead of as a confusing ERR inside the app under test.
for f in video-only.mp4 audio-only.mp4; do
  size=$(stat -f %z "$f")
  [ "$size" -gt 1024 ] || { echo "$f is ${size} bytes (<= 1 KiB floor)"; exit 1; }
done

# Smoke-check the exact production merge path against the fresh files.
ffmpeg -y -loglevel error -i video-only.mp4 -i audio-only.mp4 \
  -c:v copy -c:a copy "${TMPDIR:-/tmp}/e2e-fixture-merge-check.mp4"
rm -f "${TMPDIR:-/tmp}/e2e-fixture-merge-check.mp4"

echo "fixtures regenerated:"
ls -l video-only.mp4 audio-only.mp4
