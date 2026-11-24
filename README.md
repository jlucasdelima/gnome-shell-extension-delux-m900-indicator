# DELUX M900 Pro for GNOME Shell

GNOME Shell extension that shows the battery of the DELUX M900 Pro wireless
mouse in the top bar, read from its 2.4G receiver without the Windows
driver. It works with both receivers the mouse ships with: `1d57:fa60` and
the 2.4G 8K HS `1d57:fa65`.

- The top bar shows the mouse icon and the percentage, in yellow at 15% or
  less on battery, with a charging icon while on the cable.
- The menu gives the state (on battery, charging, fully charged) and since
  when the level has been the same. While charging, the mouse repeats its
  last measurement instead of measuring again, so the level does not climb
  on its own; switching the mouse off and on with its power switch measures
  it again.
- When the mouse sleeps, the indicator dims and keeps the last level. It
  hides while the receiver is unplugged.

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
- `extension/state.js` decides what the indicator shows from those events;
  `extension/extension.js` is the indicator.
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
