#!/bin/sh
# Installs the GNOME Shell extension for the current user and enables it. On
# Wayland, log out and back in afterwards so GNOME Shell loads a newly
# installed extension.
set -e
cd "$(dirname "$0")"
zip=$(./pack.sh)
gnome-extensions install --force "$zip"
uuid=$(basename "$zip" .shell-extension.zip)
# `gnome-extensions enable` refuses an extension the running shell has not
# loaded yet, so add it to the setting the shell reads at login instead.
enabled=$(gsettings get org.gnome.shell enabled-extensions)
gsettings set org.gnome.shell enabled-extensions "$(python3 -I -c '
import ast, sys
current = ast.literal_eval(sys.argv[1].removeprefix("@as "))
print(current if sys.argv[2] in current else current + [sys.argv[2]])
' "$enabled" "$uuid")"
echo "Installed $uuid; log out and back in to load it"
