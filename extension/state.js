// What the indicator shows, from the messages of reader.js.
// No Shell or GI imports, so tests.js runs it under plain gjs.

export const LOW_LEVEL = 15;

export function initialState() {
    return {error: null, state: null, level: null, since: null};
}

// `now` is the clock time ("14:02") to record when the level changes. The
// reader only reports changes, so `since` is when the
// current level was first seen, not the time of the latest report.
export function reduce(current, message, now) {
    if (!message || typeof message !== 'object')
        return current;
    if (message.ok === false)
        return {...current, error: String(message.error ?? 'unknown')};
    if (message.ok !== true)
        return current;
    if (message.event === 'power' && Number.isInteger(message.level)) {
        const same = current.level === message.level && current.state === message.state;
        return {error: null, state: message.state, level: message.level,
            since: same ? current.since : now};
    }
    return {...current, error: null};
}

function chargingIcon(state, level) {
    if (state === 'full')
        return 'battery-level-100-charged-symbolic';
    return `battery-level-${Math.min(100, Math.round(level / 10) * 10)}-charging-symbolic`;
}

// {visible, dim, low, chargingIcon (or null), label, status, detail (or null)}
export function view(s) {
    const known = s.level !== null;
    const base = {visible: true, dim: true, low: false, chargingIcon: null,
        label: known ? `${s.level}%` : '', detail: null};

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
        low: s.state === 'discharging' && s.level <= LOW_LEVEL,
        chargingIcon: onCable ? chargingIcon(s.state, s.level) : null,
        status: {charging: 'Charging', full: 'Fully charged'}[s.state] ?? 'On battery',
        detail: s.state === 'full' ? null : `${s.level}% since ${s.since}`,
    };
}
