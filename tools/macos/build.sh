#!/bin/sh
set -eu
task_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
task_out=${1:-"$task_dir/../../dist/Live Photo Importer.app"}
task_sdk=${LIVE_PHOTO_MACOS_SDK:-$(xcrun --show-sdk-path)}
mkdir -p "$task_out/Contents/MacOS"
cp "$task_dir/Info.plist" "$task_out/Contents/Info.plist"
task_build_dir=$(mktemp -d)
trap 'rm -rf "$task_build_dir"' EXIT INT TERM
for task_arch in arm64 x86_64; do
  xcrun swiftc -O -target "$task_arch-apple-macos14.0" -sdk "$task_sdk" -framework AppKit -framework Photos -framework UniformTypeIdentifiers "$task_dir/LivePhotoImporter.swift" -o "$task_build_dir/LivePhotoImporter-$task_arch"
done
xcrun lipo -create "$task_build_dir/LivePhotoImporter-arm64" "$task_build_dir/LivePhotoImporter-x86_64" -output "$task_out/Contents/MacOS/LivePhotoImporter"
codesign --force --deep --sign - "$task_out"
printf 'Built %s\n' "$task_out"
