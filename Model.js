// Bar rules for the DELUX M900 Pro battery. m900-hid prints one JSON object
// per line; everything the bar shows is decided here so tests/tst_model.qml
// covers it.

var GLYPH_MOUSE = "󰍽"
var LOW_LEVEL = 15

var NOTICES = {
  starting: "reading the receiver",
  missing: "receiver disconnected",
  "access-denied": "no permission on the receiver (install the udev rule)",
  asleep: "the receiver stopped sending events",
  error: "invalid response from the helper"
}

var STATE_LABELS = {
  discharging: "on battery",
  charging: "charging",
  full: "fully charged"
}

// Folds one helper line into the widget state. The last known level survives
// errors, so the tooltip can still say what the battery had. `now` is ms
// since epoch: a power line that changes the level is a fresh measurement,
// so it is when the shown level was measured. A change of state alone is
// not: plugging the cable back in does not measure again, so a
// discharging→charging line at the same level keeps the previous
// `measuredAt` (docs/re/findings.md).
function applyLine(previous, line, now) {
  var prev = previous || { connection: "starting", state: "", level: -1, measuredAt: null }
  var message = null
  try { message = JSON.parse(String(line || "")) } catch (error) { message = null }
  if (!message || typeof message !== "object") return Object.assign({}, prev, { connection: "error" })
  // DPI and polling events also prove the mouse is answering.
  if (message.ok === true && message.event !== undefined && message.event !== "power") {
    return prev.level >= 0 ? Object.assign({}, prev, { connection: "ready" }) : prev
  }
  if (message.ok !== true) {
    var code = NOTICES[message.error] ? String(message.error) : "error"
    return Object.assign({}, prev, { connection: code })
  }
  var level = Number(message.level)
  if (!STATE_LABELS[message.state] || !(level >= 0 && level <= 100)) {
    return Object.assign({}, prev, { connection: "error" })
  }
  var state = String(message.state)
  var rounded = Math.round(level)
  var measuredAt = (prev.level === rounded && prev.measuredAt != null) ? prev.measuredAt : now
  return { connection: "ready", state: state, level: rounded, measuredAt: measuredAt }
}

function barView(model, showPercentage) {
  var m = model || { connection: "starting", state: "", level: -1, measuredAt: null }
  var ready = m.connection === "ready"
  return {
    glyph: GLYPH_MOUSE,
    label: ready && showPercentage ? m.level + "%" : "",
    active: ready && m.state === "discharging" && m.level <= LOW_LEVEL,
    dimmed: !ready
  }
}

// Local "HH:MM" (24-hour, zero-padded) for a ms-since-epoch time. Passed to
// `tooltip` so tests pin the clock instead of reading the machine's.
function hhmm(ms) {
  var d = new Date(ms)
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2)
}

function tooltip(model, formatTime) {
  var m = model || { connection: "starting", state: "", level: -1, measuredAt: null }
  var title = "DELUX M900 Pro"
  if (m.connection === "ready") {
    var text = title + " · " + m.level + "% · " + STATE_LABELS[m.state]
    // While charging the firmware repeats the last measurement; say when it
    // was taken and how to get a fresh one.
    if (m.state === "charging" && m.measuredAt != null) {
      var format = formatTime || hhmm
      text += "\nmeasured at " + format(m.measuredAt) + " — turn the mouse off and on to measure again"
    }
    return text
  }
  var notice = title + " · " + NOTICES[m.connection]
  if (m.level >= 0) notice += " (last: " + m.level + "%)"
  return notice
}

// ---------- Configuration (feature reports, docs/re/findings.md) ----------

var DPI_MIN = 50
var DPI_MAX = 26000
var POLLING_RATES = [125, 250, 500, 1000]
var SENSOR_MODES = ["HP", "LP", "Office", "Corded"]
var LIGHT_MODES = ["LED Off", "Static", "Breathing", "Neon", "Color Breathing",
  "Color Static", "Mixed Breathing", "Rainbow Wave", "Lightning",
  "Static Mixed Color", "Marquee", "Marquee 2"]
// Inferred from the mode names: DELUX.exe sends brightness only for modes 1
// and 9; every mode carries the colour and speed bytes.
var LIGHT_USES_COLOR = [1, 2]
var LIGHT_USES_BRIGHTNESS = [1, 9]
var LIGHT_USES_SPEED = [2, 3, 4, 6, 7, 8, 10, 11]
// Seen on 2026-10-22: on this mouse modes 5-11 light the LED in the current
// DPI stage colour, and the next DPI change flashes the new colour and turns
// the LED off until the mode is sent again. Static keeps its own colour.
var LIGHT_STAGE_COLOR_MODES = [5, 6, 7, 8, 9, 10, 11]

function lightNote(mode) {
  if (mode === 0) return "LED off. The stage color still flashes when the DPI changes."
  if (LIGHT_STAGE_COLOR_MODES.indexOf(mode) >= 0) {
    return "On this mouse, this mode uses the DPI stage color and turns the LED off on the next DPI change."
  }
  return ""
}

// "#rrggbb" from IPC, where commas would split a JSON array.
function parseColor(text) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(text || ""))
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}
var COLOR_PRESETS = [[255, 0, 0], [255, 64, 0], [255, 255, 0], [0, 255, 0],
  [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255]]

// DELUX.exe's "restore" routine (sub_4607c0).
var FACTORY = {
  dpi: [400, 800, 1200, 1600, 3200, 5000, 400, 400],
  stages: 6,
  stage: 1,
  colors: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 255],
    [255, 255, 0], [255, 255, 255], [255, 64, 0], [255, 255, 255]],
  polling: 3,
  pollingHs: 6,
  lift: 0,
  ripple: 1,
  angle: 0,
  motionSync: 1,
  sensor: 3,
  light: { mode: 7, brightness: 8, speed: 6, color: [0, 0, 255], off: 2 },
  sleep: 10,
  debounce: 3,
  buttons: ["left", "right", "middle", "dpiCycle", "hidden28", "forward", "back", "hidden3c",
    "off", "off", "off", "off", "off", "off", "off", "off", "scrollUp", "scrollDown"]
}

function clamp(value, low, high) {
  var n = Math.round(Number(value))
  if (isNaN(n)) n = low
  return Math.max(low, Math.min(high, n))
}

function copy(value) { return JSON.parse(JSON.stringify(value)) }

// A saved profile with every field checked; anything missing or out of range
// falls back to the factory value.
function normalizeProfile(raw) {
  var p = raw && typeof raw === "object" ? raw : {}
  var f = FACTORY
  var out = copy(f)
  if (Array.isArray(p.dpi) && p.dpi.length === 8) {
    out.dpi = p.dpi.map(function(d) { return Math.round(clamp(d, DPI_MIN, DPI_MAX) / 50) * 50 })
  }
  if (Array.isArray(p.colors) && p.colors.length === 8) {
    out.colors = p.colors.map(function(c, i) { return normalizeColor(c, f.colors[i]) })
  }
  out.stages = clamp(p.stages !== undefined ? p.stages : f.stages, 1, 8)
  out.stage = clamp(p.stage !== undefined ? p.stage : f.stage, 0, out.stages - 1)
  out.polling = clamp(p.polling !== undefined ? p.polling : f.polling, 0, 3)
  out.pollingHs = clamp(p.pollingHs !== undefined ? p.pollingHs : f.pollingHs, 0, 6)
  out.lift = clamp(p.lift !== undefined ? p.lift : f.lift, 0, 1)
  out.ripple = clamp(p.ripple !== undefined ? p.ripple : f.ripple, 0, 1)
  out.angle = clamp(p.angle !== undefined ? p.angle : f.angle, 0, 1)
  out.motionSync = clamp(p.motionSync !== undefined ? p.motionSync : f.motionSync, 0, 1)
  out.sensor = clamp(p.sensor !== undefined ? p.sensor : f.sensor, 0, 3)
  var l = p.light && typeof p.light === "object" ? p.light : {}
  out.light = {
    mode: clamp(l.mode !== undefined ? l.mode : f.light.mode, 0, 11),
    brightness: clamp(l.brightness !== undefined ? l.brightness : f.light.brightness, 1, 8),
    speed: clamp(l.speed !== undefined ? l.speed : f.light.speed, 4, 8),
    color: normalizeColor(l.color, f.light.color),
    off: clamp(l.off !== undefined ? l.off : f.light.off, 1, 60)
  }
  out.sleep = clamp(p.sleep !== undefined ? p.sleep : f.sleep, 1, 60)
  out.debounce = clamp(p.debounce !== undefined ? p.debounce : f.debounce, 1, 50)
  if (p.buttons && Number(p.buttons.length) === 18) {
    var buttons = []
    for (var i = 0; i < 18; i++) buttons.push(normalizeButton(p.buttons[i], f.buttons[i]))
    out.buttons = buttons
  }
  return out
}

// A Repeater hands its array rows over as Qt lists, which are array-like but
// fail Array.isArray.
function normalizeColor(c, fallback) {
  if (!c || typeof c !== "object" || Number(c.length) !== 3) return fallback.slice()
  return [clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255)]
}

// The checksum is the 16-bit sum of bytes 3..last, stored big-endian after it.
function withChecksum(bytes, last) {
  var sum = 0
  for (var i = 3; i <= last; i++) sum += bytes[i]
  bytes[last + 1] = (sum >> 8) & 0xff
  bytes[last + 2] = sum & 0xff
  return bytes
}

function toHex(bytes) {
  var hex = ""
  for (var i = 0; i < bytes.length; i++) hex += hexByte(bytes[i])
  return hex
}

function hexByte(value) {
  var text = (value & 0xff).toString(16)
  return text.length === 1 ? "0" + text : text
}

function filled(length) {
  var bytes = []
  for (var i = 0; i < length; i++) bytes.push(0)
  return bytes
}

// Report 0x04: DPI stages, stage colours and sensor options (sub_45f070).
function report4(p) {
  var b = filled(56)
  b[0] = 0x04; b[1] = 0x38; b[2] = 0x01
  b[3] = (p.lift << 4) | p.ripple
  b[4] = (p.angle << 4) | p.motionSync
  b[5] = (1 << p.stages) - 1
  b[6] = p.sensor
  for (var i = 0; i < 8; i++) {
    var v = p.dpi[i] / 50 - 1
    b[8 + i] = v & 0xff
    b[16 + i] = (v >> 8) & 0xff
    b[25 + 3 * i] = p.colors[i][0]
    b[26 + 3 * i] = p.colors[i][1]
    b[27 + 3 * i] = p.colors[i][2]
  }
  b[24] = p.stage + 1
  b[49] = 0x03
  return toHex(withChecksum(b, 49))
}

// Report 0x05: light, sleep timer and debounce (sub_45ecc0).
function report5(p) {
  var b = filled(15)
  var l = p.light
  b[0] = 0x05; b[1] = 0x0f; b[2] = 0x01
  b[3] = (l.mode << 4) & 0xff
  b[4] = (p.sleep & 0xf0) | (9 - l.speed)
  b[5] = ((p.sleep << 4) & 0xff) | (LIGHT_USES_BRIGHTNESS.indexOf(l.mode) >= 0 ? l.brightness : 8)
  b[6] = l.color[0]; b[7] = l.color[1]; b[8] = l.color[2]
  b[9] = l.off
  b[10] = p.debounce
  return toHex(withChecksum(b, 10))
}

// Report 0x06: polling rate, normal and high-speed index in one byte plus its
// complement.
function report6(p) {
  var x = ((p.pollingHs + 1) << 4) | (p.polling + 1)
  return toHex([0x06, 0x09, 0x01, x, (~x) & 0xff, 0, 0, 0, 0])
}

// Header DELUX.exe sends before rewriting a whole profile.
var REPORT_RESET = "0c0a01fe01fe00000000"

// Which report carries each profile field.
var GROUPS = {
  dpi: "dpi", stages: "dpi", stage: "dpi", colors: "dpi", lift: "dpi", ripple: "dpi",
  angle: "dpi", motionSync: "dpi", sensor: "dpi",
  light: "light", sleep: "light", debounce: "light",
  polling: "polling", pollingHs: "polling",
  buttons: "buttons"
}

function packetsFor(field, profile) {
  var group = GROUPS[field]
  if (group === "dpi") return [report4(profile)]
  if (group === "light") return [report5(profile)]
  if (group === "polling") return [report6(profile)]
  if (group === "buttons") return [report8(profile.buttons)]
  return []
}

function factoryPackets() {
  var p = normalizeProfile(FACTORY)
  return [REPORT_RESET, report4(p), report5(p), report6(p), report8(p.buttons)]
}

// A changed copy of the profile; `path` is "field" or "light.field".
function withValue(profile, path, value) {
  var next = copy(profile)
  var parts = path.split(".")
  if (parts.length === 2) next[parts[0]][parts[1]] = value
  else next[path] = value
  return normalizeProfile(next)
}

// The mouse's own DPI button and rate shortcut move these without the host;
// the receiver reports them so the saved profile can follow.
function applyEvent(profile, line) {
  var message = null
  try { message = JSON.parse(String(line || "")) } catch (error) { return null }
  if (!message || message.ok !== true) return null
  if (message.event === "dpi") return withValue(profile, "stage", Number(message.stage) - 1)
  if (message.event === "polling") return withValue(profile, "polling", Number(message.index))
  return null
}

function colorHex(c) {
  return "#" + hexByte(c[0]) + hexByte(c[1]) + hexByte(c[2])
}

// What the panel says when `m900-hid apply` fails.
var APPLY_ERRORS = {
  timeout: "The mouse did not answer. It may be asleep: move it and try again.",
  rejected: "The mouse rejected the settings.",
  missing: "Receiver disconnected.",
  "access-denied": "No permission on the receiver. Install the udev rule from the README.",
  unsupported: "Settings over this receiver (8K HS) are not supported yet; only the battery works.",
  invalid: "Invalid settings; nothing was sent."
}

function applyError(output) {
  var result = null
  try { result = JSON.parse(String(output || "")) } catch (error) { result = null }
  if (result && result.ok === true) return ""
  var code = result && result.error ? String(result.error) : ""
  return APPLY_ERRORS[code] || "The helper failed to send the settings."
}

function dpiLabel(dpi) {
  return dpi >= 1000 && dpi % 1000 === 0 ? (dpi / 1000) + "k" : String(dpi)
}

// ---------- Buttons (report 0x08, validated on the mouse on 2026-10-22) ----------

// Firmware bytes per function, from DELUX.exe's table at 0x519730 joined with
// its menu handler sub_45c740 (docs/re/findings.md).
var BUTTON_CODES = {
  off: [0x01, 0, 0], left: [0x02, 0, 0], right: [0x03, 0, 0], middle: [0x04, 0, 0],
  back: [0x05, 0, 0], forward: [0x06, 0, 0], doubleClick: [0x07, 0, 0], fire: [0x08, 0, 0],
  scrollUp: [0x09, 0, 0], scrollDown: [0x0a, 0, 0], tiltLeft: [0x0b, 0, 0], tiltRight: [0x0c, 0, 0],
  dpiCycle: [0x0d, 0, 0], dpiUp: [0x0e, 0, 0], dpiDown: [0x0f, 0, 0],
  mediaPlayer: [0x15, 0, 0], prevTrack: [0x16, 0, 0], nextTrack: [0x17, 0, 0],
  playPause: [0x18, 0, 0], mediaStop: [0x19, 0, 0], mute: [0x1a, 0, 0],
  volumeUp: [0x1b, 0, 0], volumeDown: [0x1c, 0, 0],
  // Factory functions of hidden slots 5 and 8; their meaning is unknown.
  hidden28: [0x28, 0, 0], hidden3c: [0x3c, 0, 0]
}
var SHORTCUT_CODE = 0x11

// Slots in report order (FACTORY.buttons). Slot 4 is the DPI button behind the
// wheel, 6 and 7 the side buttons (front, rear); 5, 8 and up are hidden.
var FACTORY_BUTTONS = FACTORY.buttons

// The physical buttons, as slot index and label, in the order of the drawing
// in DELUX.exe (validated on 2026-10-22).
var PHYSICAL_BUTTONS = [
  { slot: 0, label: "Left" }, { slot: 1, label: "Right" }, { slot: 2, label: "Wheel" },
  { slot: 3, label: "DPI button" }, { slot: 5, label: "Front side" }, { slot: 6, label: "Back side" }
]

// Ctrl shortcuts from DELUX.exe's menu that mean the same on Linux.
var SHORTCUTS = {
  copy: [1, 0x06], paste: [1, 0x19], cut: [1, 0x1b], undo: [1, 0x1d], redo: [1, 0x1c],
  selectAll: [1, 0x04], save: [1, 0x16], find: [1, 0x09]
}

// Panel menu: value is a BUTTON_CODES name or "shortcut:<name>".
var BUTTON_OPTIONS = [
  { value: "left", label: "Left click" }, { value: "right", label: "Right click" },
  { value: "middle", label: "Middle click" }, { value: "back", label: "Back" },
  { value: "forward", label: "Forward" }, { value: "doubleClick", label: "Double click" },
  { value: "fire", label: "Fire (repeated clicks)" },
  { value: "dpiCycle", label: "DPI: next stage" }, { value: "dpiUp", label: "DPI +" },
  { value: "dpiDown", label: "DPI −" },
  { value: "scrollUp", label: "Scroll up" }, { value: "scrollDown", label: "Scroll down" },
  { value: "tiltLeft", label: "Scroll left" }, { value: "tiltRight", label: "Scroll right" },
  { value: "playPause", label: "Play/pause" }, { value: "nextTrack", label: "Next track" },
  { value: "prevTrack", label: "Previous track" }, { value: "mediaStop", label: "Stop media" },
  { value: "volumeUp", label: "Volume +" }, { value: "volumeDown", label: "Volume −" },
  { value: "mute", label: "Mute" },
  { value: "shortcut:copy", label: "Copy (Ctrl+C)" }, { value: "shortcut:paste", label: "Paste (Ctrl+V)" },
  { value: "shortcut:cut", label: "Cut (Ctrl+X)" }, { value: "shortcut:undo", label: "Undo (Ctrl+Z)" },
  { value: "shortcut:redo", label: "Redo (Ctrl+Y)" }, { value: "shortcut:selectAll", label: "Select all (Ctrl+A)" },
  { value: "shortcut:save", label: "Save (Ctrl+S)" }, { value: "shortcut:find", label: "Find (Ctrl+F)" },
  { value: "off", label: "Off" }
]

function buttonOption(slot) {
  if (slot && typeof slot === "object" && slot.shortcut) {
    for (var name in SHORTCUTS) {
      if (SHORTCUTS[name][0] === slot.shortcut[0] && SHORTCUTS[name][1] === slot.shortcut[1]) return "shortcut:" + name
    }
    return ""
  }
  return String(slot)
}

function buttonFromOption(value) {
  var text = String(value)
  if (text.indexOf("shortcut:") === 0) {
    var keys = SHORTCUTS[text.substr(9)]
    return keys ? { shortcut: keys.slice() } : null
  }
  return BUTTON_CODES[text] ? text : null
}

function normalizeButton(slot, fallback) {
  if (slot && typeof slot === "object" && slot.shortcut && Number(slot.shortcut.length) === 2) {
    return { shortcut: [clamp(slot.shortcut[0], 0, 255), clamp(slot.shortcut[1], 0, 255)] }
  }
  return BUTTON_CODES[slot] ? String(slot) : fallback
}

// A copy of the profile with one slot changed, or null when the change would
// leave no left click.
function withButton(profile, slot, option) {
  var button = buttonFromOption(option)
  if (button === null) return null
  var buttons = profile.buttons.slice()
  buttons[slot] = button
  if (buttons.indexOf("left") < 0) return null
  return withValue(profile, "buttons", buttons)
}

// One slot: a BUTTON_CODES name, or { shortcut: [modifier, usage] } with the
// HID modifier bits (1 Ctrl, 2 Shift, 4 Alt, 8 Win) and keyboard usage id.
function buttonBytes(slot) {
  if (slot && typeof slot === "object" && Array.isArray(slot.shortcut)) {
    return [SHORTCUT_CODE, slot.shortcut[0] & 0xff, slot.shortcut[1] & 0xff]
  }
  return BUTTON_CODES[slot] ? BUTTON_CODES[slot].slice() : null
}

// DELUX.exe refuses a layout without a left click; so does this.
function report8(buttons) {
  if (!Array.isArray(buttons) || buttons.length !== 18 || buttons.indexOf("left") < 0) return ""
  var b = filled(59)
  b[0] = 0x08; b[1] = 0x3b; b[2] = 0x01
  for (var i = 0; i < 18; i++) {
    var bytes = buttonBytes(buttons[i])
    if (bytes === null) return ""
    b[3 + 3 * i] = bytes[0]; b[4 + 3 * i] = bytes[1]; b[5 + 3 * i] = bytes[2]
  }
  return toHex(withChecksum(b, 56))
}

// Packets for a change that replaces one still waiting: every report either
// change touched, rebuilt from the newest profile, which already holds both.
function mergePackets(waiting, incoming, profile) {
  var ids = []
  var all = (waiting || []).concat(incoming || [])
  for (var i = 0; i < all.length; i++) {
    var id = all[i].substr(0, 2)
    if (ids.indexOf(id) < 0) ids.push(id)
  }
  var builders = {
    "0c": function() { return REPORT_RESET },
    "04": function() { return report4(profile) },
    "05": function() { return report5(profile) },
    "06": function() { return report6(profile) },
    "08": function() { return report8(profile.buttons) }
  }
  var order = ["0c", "04", "05", "06", "08"]
  return order.filter(function(id) { return ids.indexOf(id) >= 0 }).map(function(id) { return builders[id]() })
}
