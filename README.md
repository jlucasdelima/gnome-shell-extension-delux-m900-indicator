# DELUX M900 Pro for Omarchy

Omarchy bar widget for the DELUX M900 Pro wireless mouse: battery in the
bar and, in the panel, DPI, polling rate, lighting, sensor and timing
settings. Everything goes through the 2.4G receiver (`1d57:fa60`), without
the Windows driver. With the 2.4G 8K HS receiver (`1d57:fa65`), only the
battery works: that receiver takes settings in another format, not decoded
yet.

- The bar shows 󰍽 and the percentage. The icon takes the warning color at
  15% battery or less, and dims when the receiver or the mouse does not
  respond.
- The tooltip gives the state: on battery, charging or fully charged. With
  no answer, it shows the last level read.
- While charging, the mouse repeats its last measurement instead of
  measuring again, so the level does not climb on its own. The tooltip says
  when that level was measured; turning the mouse off and on with its power
  switch measures it again.
- `showPercentage` option (default `true`): turned off, only the icon stays
  in the bar. A right click on the bar entry flips it.
- A click opens the panel: DPI stages (the current one, the value of each
  and how many are active), polling (125 to 1000 Hz), light mode and color,
  brightness, speed, time to switch off, lift-off, sensor mode, motion
  sync, ripple, angle snapping, sleep, debounce and the function of the 6
  buttons (clicks, DPI, scroll, media, volume and Ctrl shortcuts).
  Restoring factory defaults takes two clicks.
- The mouse does not let its settings be read. The panel shows the last
  profile the mouse confirmed, saved in
  `~/.local/state/delux-m900/profile.json`; before the first change, it
  assumes factory defaults. Changes made on the mouse itself (DPI button)
  arrive through the receiver and update the profile.
- On this mouse, the light modes from Color Static to Marquee 2 use the
  DPI stage color and switch the LED off at the next DPI change; the panel
  warns about it. The factory default (Rainbow Wave) is one of them.
- While asleep, the mouse does not respond: the panel asks you to move it
  and try again.
- IPC: `omarchy-shell com.aeonarc.delux-m900
  toggle|open|close|status|resetDefaults|lastError` and
  `set <field> <json>`, for example `set polling 2`, `set light.mode 1` or
  `set light.color '#ff0000'`.

## Requirements

`python` (the Omarchy default) and the udev rule below, which gives the
local session access to the receiver.

## Installation

```sh
omarchy plugin add https://github.com/AeonArcHQ/omarchy-delux-m900 --enable
sudo install -m 644 "$HOME/.config/omarchy/plugins/com.aeonarc.delux-m900/udev/71-delux-m900-hidraw.rules" /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw
```

The udev rule gives the local session (`uaccess`) access only to interface
2 of the receiver, the vendor interface. Motion and clicks stay restricted
to root.

## Removing

```sh
omarchy plugin remove com.aeonarc.delux-m900
sudo rm /etc/udev/rules.d/71-delux-m900-hidraw.rules
sudo udevadm control --reload
```

Optionally delete the saved profile:
`rm ~/.local/state/delux-m900/profile.json`.

## How it works

- `m900-hid`: Python helper. It finds the receiver's `hidraw` through sysfs
  and listens to input report 3: power every ~2 s, DPI stage and polling.
  `apply` sends feature reports, waits for the ACK of each one and only
  then saves the profile. It does not know the protocol; it only carries
  bytes.
- `Model.js`: builds reports 0x04 (DPI and sensor), 0x05 (light and
  timing), 0x06 (polling) and 0x08 (buttons), and decides what the bar and
  the panel show.
- `Service.qml`: processes and profile. `MousePanel.qml`: bar and panel,
  following the official Omarchy panels.
- The full protocol (DPI, polling, light, buttons), recovered from the
  Windows driver, is in [docs/re/findings.md](docs/re/findings.md).

## Development

```sh
git config core.hooksPath .githooks   # once per clone: enables the pre-commit hook
tests/check.sh                        # unittest, qmltestrunner, plugin validate
```

- Edit the plugin in `~/.config/omarchy/plugins/com.aeonarc.delux-m900`
  as a real folder: through a symlink, Quickshell rejects the QML with
  "File name case mismatch".
- Hot reload does not replace the panel already loaded or the
  `IpcHandler`. After changing QML, run `omarchy restart shell`. QML errors
  only show up in `journalctl --user | grep MousePanel.qml`.
- The `modelData` of a `Repeater` over arrays arrives as a Qt list, which
  fails `Array.isArray`; treat it as array-like (`length` and indexes).
- `tools/`: `listen.py` (receiver input reports), `sendfeat.py` (sends a
  raw feature report), `powerlog.py` (logs every change of the power
  report for the given number of seconds) and `rate.py` (polling rate on evdev,
  as root: `sudo python3 -I tools/rate.py /dev/input/eventN`).

### Checklist with the mouse (wake it before each change)

1. The bar shows the battery; on the cable, the tooltip says charging and
   when the level was measured. Turning the mouse off and on with its
   power switch updates the level and the time.
2. Each DPI stage changes the cursor speed; so does changing the value of
   the current stage. The mouse's DPI button moves the selection in the
   panel.
3. 500 Hz and 1000 Hz change the rate measured by `tools/rate.py`.
4. Each light mode changes the LED; the color applies to Static and
   Breathing; brightness, to Static and Static Mixed Color.
5. Buttons: the front side button set to Volume + raises the volume; the
   others stay the same.
6. Restore defaults goes back to Rainbow Wave, 800 DPI, 1000 Hz and the
   side buttons as forward and back.

## Releasing

1. Bump `"version"` in `manifest.json` and commit it as `Release <version>`.
2. Tag that commit with an annotated tag: `git tag -a v<version> -m v<version>`.
3. Push the commit and the tag, then wait for the `check` workflow to pass.
4. Publish a GitHub release for the tag with English notes, one line per
   change a user can see, linking the issue it closes (`(#1)`).

## License

MIT.
