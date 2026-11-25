// What the indicator shows, from the messages of reader.js.
// No Shell or GI imports, so tests.js runs it under plain gjs.

// UPower's default PercentageLow and PercentageCritical, the levels at which
// GNOME warns about the battery of a wireless mouse.
export const LOW_LEVEL = 20;
export const CRITICAL_LEVEL = 5;

const SEVERITY = {low: 1, critical: 2};

export function initialState() {
    return {error: null, state: null, level: null, since: null, dpiStage: null, warning: null};
}

function warningFor(state, level) {
    if (state !== 'discharging')
        return null;
    if (level <= CRITICAL_LEVEL)
        return 'critical';
    return level <= LOW_LEVEL ? 'low' : null;
}

const worse = (a, b) => (SEVERITY[a] ?? 0) > (SEVERITY[b] ?? 0);

// `now` is the clock time ("14:02") to record when the level changes. The
// reader only reports changes, so `since` is when the current level was
// first seen, not the time of the latest report. `warning` is the worst
// level reached since the mouse was last on the cable, so a level that
// wavers around a threshold is warned about once.
export function reduce(current, message, now) {
    if (!message || typeof message !== 'object')
        return current;
    if (message.ok === false)
        return {...current, error: String(message.error ?? 'unknown')};
    if (message.ok !== true)
        return current;
    if (message.event === 'power' && Number.isInteger(message.level)) {
        const same = current.level === message.level && current.state === message.state;
        const reached = warningFor(message.state, message.level);
        let warning = null;
        if (message.state === 'discharging')
            warning = worse(reached, current.warning) ? reached : current.warning;
        return {...current, error: null, state: message.state, level: message.level,
            since: same ? current.since : now, warning};
    }
    if (message.event === 'dpi' && Number.isInteger(message.stage))
        return {...current, error: null, dpiStage: message.stage};
    return {...current, error: null};
}

// The notification to send when the warning got worse, or null. Same words
// as GNOME's own warning for a wireless mouse (gnome-settings-daemon).
export function notice(previous, next) {
    if (!worse(next.warning, previous.warning))
        return null;
    const critical = next.warning === 'critical';
    return {
        title: 'Mouse battery low',
        body: critical
            ? `Wireless mouse is very low on power (${next.level}%). This device will soon stop functioning if not charged.`
            : `Wireless mouse is low on power (${next.level}%)`,
        critical,
    };
}

function chargingIcon(state, level) {
    if (state === 'full')
        return 'battery-level-100-charged-symbolic';
    return `battery-level-${Math.min(100, Math.round(level / 10) * 10)}-charging-symbolic`;
}

// {visible, dim, low, chargingIcon (or null), label, status, detail (or
// null), dpi (or null)}
export function view(s, {showPercentage = true} = {}) {
    const known = s.level !== null;
    const base = {visible: true, dim: true, low: false, chargingIcon: null,
        label: known && showPercentage ? `${s.level}%` : '', detail: null,
        dpi: s.dpiStage !== null ? `DPI stage ${s.dpiStage}` : null};

    switch (s.error) {
    case null:
        break;
    case 'missing':
        return {...base, visible: false, status: 'Receiver not connected'};
    case 'access-denied':
        return {...base, label: '', status: 'No permission to read the receiver',
            detail: 'Install the udev rule from the project page'};
    case 'asleep':
        return {...base, status: 'Mouse not responding',
            detail: known ? `Last known: ${s.level}% (since ${s.since})` : 'Move the mouse or switch it on'};
    default:
        return {...base, status: `Error: ${s.error}`};
    }

    if (!known)
        return {...base, status: 'Waiting for the mouse…'};

    const onCable = s.state === 'charging' || s.state === 'full';
    return {
        ...base,
        dim: false,
        low: warningFor(s.state, s.level) !== null,
        chargingIcon: onCable ? chargingIcon(s.state, s.level) : null,
        status: {charging: 'Charging', full: 'Fully charged'}[s.state] ?? 'On battery',
        detail: s.state === 'full' ? null : `${s.level}% since ${s.since}`,
    };
}
