#!/usr/bin/env bash
set -euo pipefail

# CI builds the exact runtime release because binary mirrors differ by OS.
MOTIFRAME_FFMPEG_VERSION=8.1.2
MOTIFRAME_FFMPEG_SHA256=464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c
MOTIFRAME_FFMPEG_PREFIX="$PWD/.cache/ci-ffmpeg"
MOTIFRAME_FFMPEG_BUILD="$RUNNER_TEMP/motiframe-ffmpeg"

if [[ ! -x "$MOTIFRAME_FFMPEG_PREFIX/bin/ffmpeg" ]]; then
  mkdir -p "$MOTIFRAME_FFMPEG_BUILD"
  curl --fail --location --retry 3 --output "$MOTIFRAME_FFMPEG_BUILD/source.tar.xz" \
    "https://ffmpeg.org/releases/ffmpeg-$MOTIFRAME_FFMPEG_VERSION.tar.xz"
  printf '%s  %s\n' "$MOTIFRAME_FFMPEG_SHA256" "$MOTIFRAME_FFMPEG_BUILD/source.tar.xz" | shasum -a 256 --check
  tar -xJf "$MOTIFRAME_FFMPEG_BUILD/source.tar.xz" -C "$MOTIFRAME_FFMPEG_BUILD"
  (
    cd "$MOTIFRAME_FFMPEG_BUILD/ffmpeg-$MOTIFRAME_FFMPEG_VERSION"
    ./configure --prefix="$MOTIFRAME_FFMPEG_PREFIX" --disable-autodetect \
      --disable-doc --disable-debug --disable-ffplay --enable-gpl --enable-libx264 --enable-zlib
    make -j 3
    make install
  )
fi

"$MOTIFRAME_FFMPEG_PREFIX/bin/ffmpeg" -version
"$MOTIFRAME_FFMPEG_PREFIX/bin/ffprobe" -version
printf '%s\n' "$MOTIFRAME_FFMPEG_PREFIX/bin" >> "$GITHUB_PATH"
