// gjs -m tests.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {initialState, notice, reduce, view} from './extension/state.js';
import {HID_IDS, Reader, decode, findDevice} from './extension/reader.js';

let failures = 0;
const canon = v => v && typeof v === 'object' && !Array.isArray(v)
    ? JSON.stringify(v, Object.keys(v).sort()) : JSON.stringify(v);
function check(name, actual, expected) {
    if (canon(actual) === canon(expected)) {
        print(`ok   ${name}`);
        return;
    }
    failures++;
    print(`FAIL ${name}\n  got      ${canon(actual)}\n  expected ${canon(expected)}`);
}

const power = (state, level) => ({ok: true, device: '/dev/hidraw9', event: 'power', state, level});
const fail = error => ({ok: false, error});
const run = (...steps) => steps.reduce((s, [m, now]) => reduce(s, m, now), initialState());
const pick = (v, ...keys) => Object.fromEntries(keys.map(k => [k, v[k]]));

// --- state.js -------------------------------------------------------------

// The report read on 2026-11-24 with the fa65 receiver: 03 30 40 01 22.
check('on battery', view(run([power('discharging', 34), '14:02'])), {
    visible: true, dim: false, low: false, chargingIcon: null,
    label: '34%', status: 'On battery', detail: '34% since 14:02', dpi: null,
});
check('waiting before the first report', pick(view(initialState()), 'visible', 'dim', 'label', 'status'),
    {visible: true, dim: true, label: '', status: 'Waiting for the mouse…'});
check('same level keeps its time',
    view(run([power('discharging', 34), '14:02'], [fail('asleep'), '14:10'], [power('discharging', 34), '14:30'])).detail,
    '34% since 14:02');
check('new level takes the new time',
    view(run([power('discharging', 34), '14:02'], [power('discharging', 33), '14:40'])).detail,
    '33% since 14:40');
check('20% is low', view(run([power('discharging', 20), '9:00'])).low, true);
check('21% is not low', view(run([power('discharging', 21), '9:00'])).low, false);
// The mouse repeats its last measurement while charging: no number then.
check('charging shows no level', pick(view(run([power('discharging', 34), '9:00'], [power('charging', 34), '9:10'])),
    'low', 'chargingIcon', 'status', 'label', 'detail'),
{low: false, chargingIcon: 'battery-level-50-charging-symbolic', status: 'Charging', label: '', detail: null});
check('asleep while charging shows no level either',
    pick(view(run([power('charging', 34), '9:10'], [fail('asleep'), '9:20'])), 'label', 'detail'),
    {label: '', detail: 'Last known: charging (since 9:10)'});
check('unplugged: the level comes back',
    view(run([power('charging', 34), '9:10'], [power('discharging', 61), '10:30'])).label, '61%');
check('charging while low is not a warning', view(run([power('charging', 5), '9:00'])).low, false);
check('fully charged', pick(view(run([power('full', 100), '9:00'])), 'chargingIcon', 'status', 'label', 'detail'),
    {chargingIcon: 'battery-level-100-charged-symbolic', status: 'Fully charged', label: '100%', detail: null});
check('asleep keeps the last level, dimmed',
    pick(view(run([power('discharging', 34), '14:02'], [fail('asleep'), '14:10'])), 'dim', 'label', 'status', 'detail'),
    {dim: true, label: '34%', status: 'Mouse not responding', detail: 'Last known: 34% (since 14:02)'});
check('asleep before any reading', view(run([fail('asleep'), '9:00'])).detail, 'Move the mouse or switch it on');
check('missing receiver hides the indicator', view(run([power('discharging', 34), '9:00'], [fail('missing'), '9:01'])).visible, false);
check('no permission', pick(view(run([fail('access-denied'), '9:00'])), 'visible', 'dim', 'label', 'status'),
    {visible: true, dim: true, label: '', status: 'No permission to read the receiver'});
check('recovers after the udev rule',
    view(run([fail('access-denied'), '9:00'], [power('discharging', 34), '9:01'])).dim, false);
check('a DPI event means the mouse is back',
    view(run([power('discharging', 34), '9:00'], [fail('asleep'), '9:05'], [{ok: true, event: 'dpi', stage: 2}, '9:06'])).status,
    'On battery');
check('unknown error', view(run([fail('weird'), '9:00'])).status, 'Error: weird');
check('percentage off leaves only the icon',
    pick(view(run([power('discharging', 34), '9:00']), {showPercentage: false}), 'label', 'detail'),
    {label: '', detail: '34% since 9:00'});
check('no DPI stage before the DPI button', view(run([power('discharging', 34), '9:00'])).dpi, null);
check('DPI stage after the DPI button, kept across power reports',
    view(run([{ok: true, event: 'dpi', stage: 3}, '9:00'], [power('discharging', 33), '9:05'])).dpi, 'DPI stage 3');

// Each step's notification: 'low', 'critical' or '-'.
function notices(...levels) {
    const out = [];
    levels.reduce((s, [state, level]) => {
        const next = reduce(s, power(state, level), '9:00');
        const n = notice(s, next);
        out.push(n === null ? '-' : n.critical ? 'critical' : 'low');
        return next;
    }, initialState());
    return out;
}
const d = level => ['discharging', level];
check('low battery is notified once, even if the level wavers',
    notices(d(22), d(21), d(20), d(21), d(20), d(19)), ['-', '-', 'low', '-', '-', '-']);
check('critical comes after low, once',
    notices(d(20), d(6), d(5), d(6), d(4)), ['low', '-', 'critical', '-', '-']);
check('already low at the first report', notices(d(12)), ['low']);
check('already critical at the first report: one notification', notices(d(3)), ['critical']);
check('the cable resets the warning',
    notices(d(20), ['charging', 20], d(20), ['full', 100], d(18)), ['low', '-', 'low', '-', 'low']);
check('charged while unseen: warned again at the next low',
    notices(d(20), d(5), d(95), d(40), d(20), d(5)), ['low', 'critical', '-', '-', 'low', 'critical']);
check('wavering below the reset level does not warn again',
    notices(d(20), d(26), d(30), d(20)), ['low', '-', '-', '-']);
{
    // Notifications off at 15%, back on at 12%: the low warning still comes.
    const off = reduce(initialState(), power('discharging', 15), '9:00', {notify: false});
    const on = reduce(off, power('discharging', 12), '9:30');
    check('notification turned back on still warns', [off.warning, notice(off, on)?.critical], [null, false]);
}
check('GNOME words for low', notice(initialState(), run([power('discharging', 20), '9:00'])),
    {title: 'Mouse battery low', body: 'Wireless mouse is low on power (20%)', critical: false});
check('GNOME words for critical', notice(initialState(), run([power('discharging', 5), '9:00'])).body,
    'Wireless mouse is very low on power (5%). This device will soon stop functioning if not charged.');

const before = run([power('discharging', 34), '9:00']);
check('junk messages change nothing', [reduce(before, null, 'x'), reduce(before, {ok: 'yes'}, 'x'), reduce(before, 5, 'x')],
    [before, before, before]);

// --- reader.js: decode and findDevice ----------------------------------------

const hex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));
// Real reports from the M900 Pro: 2026-10-22 on the fa60 receiver (byte 1 is
// 0x3d), 2026-11-24 on the fa65 receiver (0x30).
check('decode on battery', decode(hex('033d40014d')), {event: 'power', state: 'discharging', level: 77});
check('decode the HS receiver', decode(hex('0330400122')), {event: 'power', state: 'discharging', level: 34});
check('decode charging keeps the level', decode(hex('033d400346')), {event: 'power', state: 'charging', level: 70});
check('decode full reads as 100', decode(hex('033d400200')), {event: 'power', state: 'full', level: 100});
check('decode skips ACKs, bad levels and short reports',
    [decode(hex('033d500004')), decode(hex('033d400100')), decode(hex('033d4001'))], [null, null, null]);
check('decode DPI stage', [decode(hex('033d100400')), decode(hex('033d100900'))], [{event: 'dpi', stage: 4}, null]);
check('decode polling index', decode(hex('033d204400')), {event: 'polling', index: 3});

const shell = command => {
    const [, , err, status] = GLib.spawn_sync(null, ['sh', '-c', command], null,
        GLib.SpawnFlags.SEARCH_PATH, null);
    if (status !== 0)
        throw new Error(`${command}: ${new TextDecoder().decode(err)}`);
};
const quote = path => `'${path.replaceAll("'", "'\\''")}'`;
const tmp = GLib.Dir.make_tmp('delux-m900-XXXXXX');
let tmpCount = 0;
// A fake /sys/class/hidraw and /dev.
function fakeSystem() {
    const dir = `${tmp}/${tmpCount++}`;
    shell(`mkdir -p ${quote(dir)}/sys ${quote(dir)}/dev`);
    return {sys: `${dir}/sys`, dev: `${dir}/dev`};
}
function makeNode(sys, name, hidId, descriptorHex) {
    const device = `${sys}/${name}/device`;
    shell(`mkdir -p ${quote(device)}`);
    GLib.file_set_contents(`${device}/uevent`, `DRIVER=hid-generic\nHID_ID=${hidId}\n`);
    GLib.file_set_contents(`${device}/report_descriptor`, hex(descriptorHex));
}
// Receiver interfaces read from sysfs: the mouse itself, and the vendor
// interface of each receiver with input report 3.
const MOUSE = '05010902a1010901a100850105091901';
const VENDOR = '05010980a101850105011981298315002501950375018106950175058101c0' +
    '050c0901a1018502150026800319002a8003751095018100c0050a0900a101850319a029a0150025007508950481 02c0'.replace(' ', '');
const HS_VENDOR = '05010980a101850105011981298315002501950375018106950175058101c0' +
    '050c0901a1018502150026800319002a8003751095018100c0050a0900a10185031900290015002500750895048101c0' +
    '0600ff0901a10185047508953f150026ff00090881028504093c7508953f150026ff009102c0';
const [M900, HS] = HID_IDS;

// --- reader.js: Reader ---------------------------------------------------------

const REPORT_34 = String.raw`\003\060\100\001\042`; // 03 30 40 01 22, for printf
const after = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    fn();
    return GLib.SOURCE_REMOVE;
});
// A FIFO stands in for the hidraw node; `script` runs as the writer with the
// FIFO in $1 and the fake sysfs node in $2.
function plugIn(f, script) {
    makeNode(f.sys, 'hidraw9', HS, HS_VENDOR);
    shell(`mkfifo ${quote(f.dev)}/hidraw9`);
    Gio.Subprocess.new(['sh', '-c', script, 'sh', `${f.dev}/hidraw9`, `${f.sys}/hidraw9`],
        Gio.SubprocessFlags.NONE);
}

// Collects `wanted` messages, stops the reader, then waits to make sure
// nothing else arrives once stopped.
function read(name, f, wanted, expected, setup = () => {}) {
    return new Promise(resolve => {
        const got = [];
        let guard = 0;
        const finish = () => {
            check(name, got, expected);
            resolve();
        };
        const r = new Reader(m => {
            got.push(m.ok ? `${m.event}:${m.level}` : m.error);
            if (got.length !== wanted)
                return;
            r.stop();
            GLib.source_remove(guard);
            after(800, finish);
        }, {root: f.sys, devDir: f.dev, silenceMs: 300, retryMs: 100});
        guard = after(5000, () => {
            r.stop();
            got.push('(timed out)');
            finish();
        });
        setup();
        r.start();
    });
}

const loop = new GLib.MainLoop(null, false);
(async () => {
    {
        const f = fakeSystem();
        makeNode(f.sys, 'hidraw1', M900, MOUSE);
        makeNode(f.sys, 'hidraw2', M900, VENDOR);
        check('finds the vendor interface of the receiver', await findDevice(f.sys, f.dev), `${f.dev}/hidraw2`);
    }
    {
        const f = fakeSystem();
        makeNode(f.sys, 'hidraw9', HS, HS_VENDOR);
        check('finds the HS receiver', await findDevice(f.sys, f.dev), `${f.dev}/hidraw9`);
    }
    {
        const f = fakeSystem();
        makeNode(f.sys, 'hidraw0', '0003:0000046D:0000C52B', VENDOR);
        check('ignores other devices with the same collection', await findDevice(f.sys, f.dev), null);
        check('no hidraw directory', await findDevice(`${f.sys}/nonexistent`, f.dev), null);
    }
    {
        const f = fakeSystem();
        // Writes one report, then the receiver goes away.
        await read('plugged in, read, unplugged', f, 3, ['missing', 'power:34', 'missing'],
            () => after(250, () => plugIn(f, `exec 3>"$1"; printf '${REPORT_34}' >&3; rm -r "$1" "$2"`)));
    }
    {
        const f = fakeSystem();
        // Holds the node open and silent, then writes a report after stop().
        plugIn(f, `exec 3>"$1"; sleep 0.6; printf '${REPORT_34}' >&3; sleep 0.5`);
        await read('a silent mouse is asleep, and stop() ends the read', f, 1, ['asleep']);
    }
    {
        const f = fakeSystem();
        // The node opens but every read ends at once (EOF), again and again.
        plugIn(f, 'for i in $(seq 200); do exec 3>"$1"; exec 3>&-; done & p=$!; sleep 3; kill $p');
        await read('a node that opens but never reads ends up asleep', f, 1, ['asleep']);
    }
    // Root opens it anyway (CI runs as root).
    if (new Gio.Credentials().get_unix_user() !== 0) {
        const f = fakeSystem();
        makeNode(f.sys, 'hidraw9', HS, HS_VENDOR);
        shell(`touch ${quote(f.dev)}/hidraw9 && chmod 000 ${quote(f.dev)}/hidraw9`);
        await read('no permission on the node', f, 1, ['access-denied']);
    }
    shell(`rm -rf ${quote(tmp)}`);
    loop.quit();
})().catch(e => {
    failures++;
    print(`FAIL ${e}`);
    loop.quit();
});
loop.run();

print(failures ? `${failures} failed` : 'all passed');
System.exit(failures ? 1 : 0);
