# DELUX M900 Pro for GNOME Shell

GNOME Shell extension that shows the battery of the DELUX M900 Pro wireless
mouse in the top bar, read from its 2.4G receiver without the Windows
driver. It works with both receivers the mouse ships with: `1d57:fa60` and
the 2.4G 8K HS `1d57:fa65`.

- The top bar shows the mouse icon and the percentage, in yellow at 20% or
  less on battery. On the cable it shows a half-full charging battery
  icon instead of the percentage: while charging, the mouse keeps repeating the level it
  measured before the cable went in, so the real level is unknown until
  the cable comes out. DELUX's Windows software also only says "Charging".
- At 20%, and again at 5%, a notification warns that the battery is low,
  in the same words as GNOME's own warning for a wireless mouse. Plugging
  the cable in withdraws it.
- The menu gives the state (on battery, charging, fully charged), since
  when the level has been the same and the DPI stage. The mouse only
  reports the stage when it changes, so it shows up after the first press
  of the DPI button.
- When the mouse sleeps, the indicator dims and keeps the last level. It
  hides while the receiver is unplugged.
- Settings (in the menu, or in the Extensions app): show the percentage or
  only the icon, and turn the low battery notification on or off.

## Requirements

GNOME Shell 51 and a udev rule that gives your session access to interface
2 of the receiver, its vendor interface. Motion and clicks stay restricted
to root.

```sh
curl -fLO https://raw.githubusercontent.com/jlucasdelima/delux-m900-indicator/main/udev/71-delux-m900-hidraw.rules
sudo install -m 644 71-delux-m900-hidraw.rules /etc/udev/rules.d/
sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=hidraw
```

## Installation

From extensions.gnome.org, or from a clone with `./install.sh`. On
Wayland, log out and back in afterwards: GNOME Shell loads a newly
installed extension at login.

## Removing

```sh
gnome-extensions uninstall delux-m900-indicator@jlucasdelima.github.io
sudo rm /etc/udev/rules.d/71-delux-m900-hidraw.rules
sudo udevadm control --reload
```

## How it works

- `extension/reader.js` finds the receiver's vendor `hidraw` node through
  sysfs and reads input report 3, which the receiver pushes about every
  2 s: `03 <model> 40 <state> <level>` for power. There is no helper
  process.
- `extension/state.js` decides what the indicator shows and when to warn
  from those events; `extension/extension.js` is the indicator and the
  notifications; `extension/prefs.js` is the settings page, for the keys
  in `extension/schemas/`.
- The receiver protocol, recovered from the Windows driver, is in
  [docs/re/findings.md](docs/re/findings.md).

## Development

```sh
git config core.hooksPath .githooks   # once per clone: runs the tests before each commit
gjs -m tests.js                       # the tests; no GNOME Shell needed
./pack.sh                             # dist/<uuid>.shell-extension.zip for extensions.gnome.org
```

- Every change must pass the extensions.gnome.org
  [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
- `tools/`: the Python scripts used for the reverse engineering.
  `listen.py` prints the receiver's input reports, `sendfeat.py` sends a
  raw feature report, `powerlog.py` logs every change of the power report
  and `rate.py` measures the polling rate on evdev (as root:
  `sudo python3 -I tools/rate.py /dev/input/eventN`).

## Releasing

1. Run `gjs -m tests.js` and `./pack.sh`.
2. Upload `dist/delux-m900-indicator@jlucasdelima.github.io.shell-extension.zip`
   at <https://extensions.gnome.org/upload/>. extensions.gnome.org numbers
   the versions itself.
3. Once it is approved, tag the commit with that number
   (`git tag -a v<N> -m v<N>`) and push the tag.

## Credits

Forked from
[AeonArcHQ/omarchy-delux-m900](https://github.com/AeonArcHQ/omarchy-delux-m900),
the Omarchy bar plugin for this mouse (battery, DPI, polling rate, lighting
and buttons). The receiver protocol and the udev rule come from there.

## License

MIT.
