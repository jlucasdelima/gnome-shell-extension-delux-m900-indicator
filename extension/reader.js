import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

// Reads the DELUX M900 Pro's 2.4G receiver: a port of `m900-hid watch` from
// https://github.com/AeonArcHQ/omarchy-delux-m900 (MIT, see LICENSE). The
// receiver pushes input report 3 on its vendor hidraw node about every two
// seconds: `03 <model> <event> <b3> <b4>`. Event 0x40 carries the power
// state in b3 (1 on battery, 2 fully charged, 3 charging) and the level in
// b4 (docs/re/findings.md).

// M900 Pro receiver (fa60) and 2.4G 8K HS receiver (fa65).
export const HID_IDS = ['0003:00001D57:0000FA60', '0003:00001D57:0000FA65'];
// Usage Page 0x0A, Usage 0, Collection (Application), Report ID 3.
const VENDOR_COLLECTION = '\x05\x0a\x09\x00\xa1\x01\x85\x03';
const REPORT_ID = 0x03;
const EVENT_DPI = 0x10;
const EVENT_POLLING = 0x20;
const EVENT_POWER = 0x40;
const POWER_STATES = {2: 'full', 3: 'charging'};

// Event from one input report, or null for reports the indicator ignores.
export function decode(report) {
    if (report.length < 5 || report[0] !== REPORT_ID)
        return null;
    const [, , event, b3, b4] = report;
    if (event === EVENT_POWER) {
        const state = POWER_STATES[b3] ?? 'discharging';
        if (state === 'full')
            return {event: 'power', state, level: 100};
        if (b4 < 1 || b4 > 100)
            return null;
        return {event: 'power', state, level: b4};
    }
    if (event === EVENT_DPI && b3 >= 1 && b3 <= 8)
        return {event: 'dpi', stage: b3};
    if (event === EVENT_POLLING && (b3 & 0x0f) >= 1 && (b3 & 0x0f) <= 4)
        return {event: 'polling', index: (b3 & 0x0f) - 1};
    return null;
}

function load(path) {
    try {
        return Gio.File.new_for_path(path).load_contents(null)[1];
    } catch {
        return null;
    }
}

// The receiver's vendor hidraw node, or null. Its other interfaces (mouse,
// keyboard) share the HID_ID, so the report descriptor picks the right one.
export function findDevice(root = '/sys/class/hidraw', devDir = '/dev') {
    const names = [];
    try {
        const children = Gio.File.new_for_path(root).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (const info of children)
            names.push(info.get_name());
        children.close(null);
    } catch {
        return null;
    }
    for (const name of names.filter(n => n.startsWith('hidraw')).sort()) {
        const uevent = load(`${root}/${name}/device/uevent`);
        if (uevent === null)
            continue;
        const text = new TextDecoder().decode(uevent);
        if (!HID_IDS.some(id => text.includes(`HID_ID=${id}`)))
            continue;
        const descriptor = load(`${root}/${name}/device/report_descriptor`);
        if (descriptor !== null && String.fromCharCode(...descriptor).includes(VENDOR_COLLECTION))
            return `${devDir}/${name}`;
    }
    return null;
}

// Hands onMessage each change: {ok: true, event: 'power', state, level}, {ok: true, event: 'dpi'
// or 'polling', ...} or {ok: false, error: 'missing', 'access-denied' or
// 'asleep'}.
export class Reader {
    constructor(onMessage, {root = '/sys/class/hidraw', devDir = '/dev',
        silenceMs = 6000, retryMs = 3000} = {}) {
        this._onMessage = onMessage;
        this._root = root;
        this._devDir = devDir;
        // DELUX.exe marks the mouse disconnected after 6 s without a report.
        this._silenceMs = silenceMs;
        this._retryMs = retryMs;
        this._cancellable = null;
        this._retryId = 0;
        this._silenceId = 0;
        this._last = null;
    }

    start() {
        this.stop();
        this._cancellable = new Gio.Cancellable();
        this._scan(this._cancellable);
    }

    // The pending read ends with CANCELLED on the next main loop iteration
    // and closes the node then.
    stop() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._clearTimer('_retryId');
        this._clearTimer('_silenceId');
        this._last = null;
    }

    _clearTimer(name) {
        if (this[name]) {
            GLib.source_remove(this[name]);
            this[name] = 0;
        }
    }

    _emit(message) {
        const key = JSON.stringify(message);
        if (key === this._last)
            return;
        this._last = key;
        this._onMessage(message);
    }

    _retryLater(cancellable) {
        if (cancellable.is_cancelled()) // onMessage called stop()
            return;
        this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._retryMs, () => {
            this._retryId = 0;
            this._scan(cancellable);
            return GLib.SOURCE_REMOVE;
        });
    }

    _armSilence() {
        this._clearTimer('_silenceId');
        this._silenceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._silenceMs, () => {
            this._silenceId = 0;
            this._emit({ok: false, error: 'asleep'});
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan(cancellable) {
        const device = findDevice(this._root, this._devDir);
        if (device === null) {
            this._emit({ok: false, error: 'missing'});
            this._retryLater(cancellable);
            return;
        }
        let file;
        try {
            file = Gio.File.new_for_path(device).read(null);
        } catch (e) {
            const denied = e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED);
            this._emit({ok: false, error: denied ? 'access-denied' : 'missing'});
            this._retryLater(cancellable);
            return;
        }
        // The file stream owns the descriptor; the Unix stream over the same
        // descriptor can be polled, so a cancelled read returns at once
        // instead of waiting in a thread for the next report.
        const stream = new GioUnix.InputStream({fd: file.get_fd(), close_fd: false});
        this._armSilence();
        this._read(file, stream, GLib.get_monotonic_time(), cancellable);
    }

    _read(file, stream, openedAt, cancellable) {
        stream.read_bytes_async(64, GLib.PRIORITY_DEFAULT, cancellable, (s, result) => {
            let bytes = null;
            try {
                bytes = s.read_bytes_finish(result);
            } catch {
                // cancelled by stop(), or the receiver was unplugged
            }
            if (bytes !== null && bytes.get_size() > 0 && !cancellable.is_cancelled()) {
                this._armSilence();
                const message = decode(bytes.toArray());
                if (message !== null)
                    this._emit({ok: true, ...message});
                this._read(file, stream, openedAt, cancellable);
                return;
            }
            try {
                file.close(null);
            } catch {}
            if (cancellable.is_cancelled())
                return;
            this._clearTimer('_silenceId');
            // Unplugging ends the read: look again at once so "missing" shows
            // right away, unless the node keeps failing as soon as it opens.
            if (GLib.get_monotonic_time() - openedAt >= this._retryMs * 1000)
                this._scan(cancellable);
            else
                this._retryLater(cancellable);
        });
    }
}
