import QtQuick
import QtTest
import "../Model.js" as Model

TestCase {
  name: "DeluxM900Model"

  function line(object) { return JSON.stringify(object) }

  function test_a_power_line_makes_the_widget_ready() {
    var m = Model.applyLine(null, line({ ok: true, device: "/dev/hidraw2", state: "discharging", level: 74 }), 1000)
    compare(m, { connection: "ready", state: "discharging", level: 74, measuredAt: 1000 })
    compare(Model.barView(m, true), { glyph: "󰍽", label: "74%", active: false, dimmed: false })
    compare(Model.barView(m, false).label, "")
    compare(Model.tooltip(m), "DELUX M900 Pro · 74% · on battery")
  }

  function test_low_battery_is_highlighted_only_on_battery() {
    var low = Model.applyLine(null, line({ ok: true, state: "discharging", level: 15 }))
    compare(Model.barView(low, true).active, true)
    var charging = Model.applyLine(null, line({ ok: true, state: "charging", level: 10 }))
    compare(Model.barView(charging, true).active, false)
    var fine = Model.applyLine(null, line({ ok: true, state: "discharging", level: 16 }))
    compare(Model.barView(fine, true).active, false)
  }

  function test_errors_dim_the_icon_and_keep_the_last_level() {
    var ready = Model.applyLine(null, line({ ok: true, state: "full", level: 100 }))
    var asleep = Model.applyLine(ready, line({ ok: false, error: "asleep" }))
    compare(asleep.connection, "asleep")
    compare(Model.barView(asleep, true), { glyph: "󰍽", label: "", active: false, dimmed: true })
    compare(Model.tooltip(asleep), "DELUX M900 Pro · the receiver stopped sending events (last: 100%)")
  }

  function test_every_error_has_a_notice() {
    var codes = ["missing", "access-denied", "asleep", "nonsense"]
    for (var i = 0; i < codes.length; i++) {
      var m = Model.applyLine(null, line({ ok: false, error: codes[i] }))
      verify(Model.tooltip(m).indexOf("undefined") === -1, codes[i])
    }
    compare(Model.applyLine(null, "not json").connection, "error")
    compare(Model.applyLine(null, line({ ok: true, state: "discharging", level: 300 })).connection, "error")
    compare(Model.tooltip(null), "DELUX M900 Pro · reading the receiver")
  }

  // The same bytes tools/m900build.py sent on 2026-10-22, each ACKed by the
  // mouse (docs/re/findings.md, "Factory restore from Linux").
  function test_factory_reports_match_the_bytes_the_mouse_accepted() {
    compare(Model.factoryPackets(), [
      "0c0a01fe01fe00000000",
      "04380101013f0300070f171f3f6307070000000000000000" + "02ff000000ff000000ffff00ffffff00ffffffff4000ffffff030f7700000000",
      "050f017003a80000ff0203021f0000",
      "06090174" + "8b00000000",
      Model.report8(Model.FACTORY_BUTTONS)
    ])
  }

  function test_polling_report_is_the_one_validated_at_500_hz() {
    var p = Model.withValue(Model.normalizeProfile(null), "polling", 2)
    p = Model.withValue(p, "pollingHs", 2)
    compare(Model.report6(p), "06090133cc00000000")
  }

  // Static red with brightness 5 (the 22/10 test): brightness only travels
  // for the static modes.
  function test_light_report_carries_brightness_only_for_static_modes() {
    var p = Model.normalizeProfile({ light: { mode: 1, brightness: 5, speed: 6, color: [255, 0, 0], off: 10 }, sleep: 10, debounce: 4 })
    compare(Model.report5(p), "050f011003a5ff00000a0401c50000")
    var wave = Model.withValue(p, "light.mode", 7)
    compare(Model.report5(wave).substr(10, 2), "a8")
  }

  function test_profile_values_are_clamped_and_stage_follows_the_stage_count() {
    var p = Model.normalizeProfile({ dpi: [10, 26050, 1234, 1600, 3200, 5000, 400, 400], stages: 2, stage: 5 })
    compare(p.dpi.slice(0, 3), [50, 26000, 1250])
    compare(p.stage, 1)
    compare(Model.normalizeProfile({ light: { mode: 40, speed: 1 } }).light.mode, 11)
    compare(Model.normalizeProfile({ light: { speed: 1 } }).light.speed, 4)
  }

  function test_receiver_events_move_the_saved_stage_and_rate() {
    var p = Model.normalizeProfile(null)
    compare(Model.applyEvent(p, line({ ok: true, event: "dpi", stage: 4 })).stage, 3)
    compare(Model.applyEvent(p, line({ ok: true, event: "polling", index: 2 })).polling, 2)
    compare(Model.applyEvent(p, line({ ok: true, event: "power", state: "full", level: 100 })), null)
  }

  function test_dpi_events_do_not_disturb_the_battery_state() {
    var ready = Model.applyLine(null, line({ ok: true, event: "power", state: "charging", level: 50 }))
    compare(Model.applyLine(ready, line({ ok: true, event: "dpi", stage: 2 })), ready)
  }

  // While charging the firmware freezes the level byte and repeats it every
  // 2 s; only a level change is a fresh measurement.
  function test_measured_at_marks_when_the_level_was_measured() {
    var m = Model.applyLine(null, line({ ok: true, state: "charging", level: 58 }), 1000)
    compare(m.measuredAt, 1000)
    var repeated = Model.applyLine(m, line({ ok: true, state: "charging", level: 58 }), 2000)
    compare(repeated.measuredAt, 1000)
    var fresh = Model.applyLine(repeated, line({ ok: true, state: "charging", level: 89 }), 3000)
    compare(fresh.measuredAt, 3000)
    var asleep = Model.applyLine(fresh, line({ ok: false, error: "asleep" }), 4000)
    compare(asleep.measuredAt, 3000)
    var dpi = Model.applyLine(fresh, line({ ok: true, event: "dpi", stage: 2 }), 5000)
    compare(dpi.measuredAt, 3000)
  }

  // Plugging the cable back in does not measure again: a state change at the
  // same level keeps the previous measuredAt (docs/re/findings.md).
  function test_a_state_change_alone_is_not_a_fresh_measurement() {
    var m = Model.applyLine(null, line({ ok: true, state: "discharging", level: 58 }), 1000)
    compare(m.measuredAt, 1000)
    var plugged = Model.applyLine(m, line({ ok: true, state: "charging", level: 58 }), 2000)
    compare(plugged.measuredAt, 1000)
    var fresh = Model.applyLine(plugged, line({ ok: true, state: "charging", level: 89 }), 3000)
    compare(fresh.measuredAt, 3000)
  }

  // The default hhmm formatter prints local time; built from a local Date so
  // the expectation holds in any time zone.
  function test_the_default_formatter_shows_local_hhmm() {
    var at = new Date(2026, 10, 14, 9, 5).getTime()
    var m = Model.applyLine(null, line({ ok: true, state: "charging", level: 89 }), at)
    verify(Model.tooltip(m).indexOf("measured at 09:05") >= 0)
  }

  function test_charging_tooltip_says_when_the_level_was_measured() {
    var m = Model.applyLine(null, line({ ok: true, state: "charging", level: 89 }), 1000)
    var at = function(ms) { return ms === 1000 ? "19:12" : "??:??" }
    compare(Model.tooltip(m, at), "DELUX M900 Pro · 89% · charging\nmeasured at 19:12 — turn the mouse off and on to measure again")
    var discharging = Model.applyLine(null, line({ ok: true, state: "discharging", level: 74 }), 1000)
    compare(Model.tooltip(discharging, at), "DELUX M900 Pro · 74% · on battery")
  }

  function test_apply_errors_tell_what_to_do() {
    compare(Model.applyError('{"ok": true}'), "")
    verify(Model.applyError('{"ok": false, "error": "timeout"}').indexOf("move it") >= 0)
    verify(Model.applyError('{"ok": false, "error": "unsupported"}').indexOf("8K HS") >= 0)
    verify(Model.applyError("").length > 0)
    verify(Model.applyError('{"ok": false, "error": "weird"}').length > 0)
  }

  function test_factory_button_report() {
    var hex = Model.report8(Model.FACTORY_BUTTONS)
    compare(hex.length, 59 * 2)
    compare(hex.substr(0, 6), "083b01")
    // Slot order and factory functions: docs/re/findings.md, "Slots and physical buttons".
    compare(hex.substr(6, 108), "020000" + "030000" + "040000" + "0d0000" + "280000" + "060000" + "050000" + "3c0000"
      + "010000010000010000010000010000010000010000010000" + "090000" + "0a0000")
    var sum = 0
    for (var i = 3; i <= 56; i++) sum += parseInt(hex.substr(i * 2, 2), 16)
    compare(parseInt(hex.substr(114, 4), 16), sum)
  }

  function test_shortcut_slot_and_left_click_guard() {
    var layout = Model.FACTORY_BUTTONS.slice()
    layout[5] = { shortcut: [1, 0x06] }  // Ctrl+C on the front side button
    compare(Model.report8(layout).substr(6 + 5 * 6, 6), "110106")
    var noLeft = Model.FACTORY_BUTTONS.slice()
    noLeft[0] = "right"
    compare(Model.report8(noLeft), "")
    compare(Model.report8(["left"]), "")
  }

  function test_colour_from_an_array_like_row_is_kept() {
    var p = Model.withValue(Model.normalizeProfile(null), "light.color", { 0: 255, 1: 0, 2: 0, length: 3 })
    compare(p.light.color, [255, 0, 0])
  }

  // Validated on 2026-10-22: this layout made the front side button raise the
  // volume and left every other button as it was.
  function test_side_button_to_volume_up_matches_the_bytes_the_mouse_took() {
    var p = Model.withButton(Model.normalizeProfile(null), 5, "volumeUp")
    compare(Model.packetsFor("buttons", p), ["083b010200000300000400000d00002800001b00000500003c0000"
      + "010000010000010000010000010000010000010000010000" + "0900000a000000b5"])
  }

  function test_button_options_round_trip_and_keep_a_left_click() {
    var p = Model.withButton(Model.normalizeProfile(null), 6, "shortcut:copy")
    compare(p.buttons[6], { shortcut: [1, 6] })
    compare(Model.buttonOption(p.buttons[6]), "shortcut:copy")
    compare(Model.withButton(p, 0, "right"), null)
    compare(Model.withButton(p, 0, "nonsense"), null)
    var moved = Model.withButton(Model.withButton(p, 5, "left"), 0, "right")
    compare(moved.buttons[0], "right")
  }

  function test_saved_buttons_survive_normalising() {
    var p = Model.withButton(Model.normalizeProfile(null), 5, "volumeUp")
    compare(Model.normalizeProfile(JSON.parse(JSON.stringify(p))).buttons, p.buttons)
    compare(Model.normalizeProfile({ buttons: ["left"] }).buttons, Model.FACTORY_BUTTONS)
  }

  function test_ipc_colour_and_light_notes() {
    compare(Model.parseColor("#ff4000"), [255, 64, 0])
    compare(Model.parseColor("ff0000"), [255, 0, 0])
    compare(Model.parseColor("[255,0,0]"), null)
    compare(Model.lightNote(1), "")
    verify(Model.lightNote(7).indexOf("stage") >= 0)
    verify(Model.lightNote(0).length > 0)
  }

  // 2026-10-22: sleep, then light-off, then polling in quick succession sent
  // only the polling report; the light-off change never reached the mouse.
  function test_a_change_folded_into_a_waiting_one_keeps_both_reports() {
    var p = Model.normalizeProfile(null)
    var a = Model.withValue(p, "light.off", 2)
    var b = Model.withValue(a, "polling", 2)
    var merged = Model.mergePackets(Model.packetsFor("light", a), Model.packetsFor("polling", b), b)
    compare(merged, [Model.report5(b), Model.report6(b)])
    compare(Model.mergePackets(Model.factoryPackets(), Model.packetsFor("polling", b), b).length, 5)
  }
}
