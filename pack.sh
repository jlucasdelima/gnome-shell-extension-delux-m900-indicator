#!/bin/sh
# Builds dist/<uuid>.shell-extension.zip, the file uploaded to
# extensions.gnome.org and installed by install.sh.
set -e
cd "$(dirname "$0")"
# A fresh dist/: pack segfaults on a missing --out-dir (GNOME 51.1), and
# install.sh expects a single zip.
rm -rf dist && mkdir dist
gnome-extensions pack extension --extra-source=reader.js --extra-source=state.js \
  --extra-source=../LICENSE \
  --out-dir=dist --force
ls dist/*.shell-extension.zip
