import importlib.machinery
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("m900_hid", str(ROOT / "m900-hid"))
spec = importlib.util.spec_from_loader("m900_hid", loader)
m900_hid = importlib.util.module_from_spec(spec)
loader.exec_module(m900_hid)

# Receiver interfaces as seen on 2026-10-22: hidraw1 is the mouse itself,
# hidraw2 the vendor interface with input report 3.
MOUSE_DESCRIPTOR = bytes.fromhex("05010902a1010901a100850105091901")
VENDOR_DESCRIPTOR = bytes.fromhex(
    "05010980a10185010501198129831500250195037501810695017505810 1c0"
    "050c0901a1018502150026800319002a8003751095018100c0"
    "050a0900a101850319a029a0150025007508950481 02c0".replace(" ", ""))
HS_VENDOR_DESCRIPTOR = bytes.fromhex(
    "05010980a101850105011981298315002501950375018106950175058101c0"
    "050c0901a1018502150026800319002a8003751095018100c0"
    "050a0900a10185031900290015002500750895048101c0"
    "0600ff0901a10185047508953f150026ff00090881028504093c7508953f150026ff009102c0")


def make_node(sysfs, name, hid_id, descriptor):
    device = sysfs / name / "device"
    device.mkdir(parents=True)
    (device / "uevent").write_text(f"DRIVER=hid-generic\nHID_ID={hid_id}\n")
    (device / "report_descriptor").write_bytes(descriptor)


class FindDeviceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sysfs = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_picks_the_vendor_interface_of_the_receiver(self):
        make_node(self.sysfs, "hidraw1", m900_hid.HID_ID, MOUSE_DESCRIPTOR)
        make_node(self.sysfs, "hidraw2", m900_hid.HID_ID, VENDOR_DESCRIPTOR)
        self.assertEqual(m900_hid.find_device(self.sysfs), "/dev/hidraw2")

    # 8K HS receiver (1d57:fa65), interface 2, read from sysfs on 2026-11-24.
    def test_watch_also_finds_the_hs_receiver_but_apply_does_not(self):
        make_node(self.sysfs, "hidraw9", m900_hid.HS_HID_ID, HS_VENDOR_DESCRIPTOR)
        self.assertEqual(m900_hid.find_device(self.sysfs, m900_hid.WATCH_IDS), "/dev/hidraw9")
        self.assertIsNone(m900_hid.find_device(self.sysfs))

    def test_ignores_other_devices_with_the_same_collection(self):
        make_node(self.sysfs, "hidraw0", "0003:0000046D:0000C52B", VENDOR_DESCRIPTOR)
        self.assertIsNone(m900_hid.find_device(self.sysfs))


class DecodeTest(unittest.TestCase):
    # Real reports from 2026-10-22 (docs/re/findings.md).
    def test_on_battery(self):
        self.assertEqual(m900_hid.decode(bytes.fromhex("033d40014d")),
                         {"event": "power", "state": "discharging", "level": 77})

    # 2026-11-24, M900 Pro on the fa65 receiver: byte 1 is 0x30 there, 0x3d on fa60.
    def test_m900_pro_on_the_hs_receiver(self):
        self.assertEqual(m900_hid.decode(bytes.fromhex("0330400122")),
                         {"event": "power", "state": "discharging", "level": 34})

    def test_charging_keeps_the_level(self):
        self.assertEqual(m900_hid.decode(bytes.fromhex("033d400346")),
                         {"event": "power", "state": "charging", "level": 70})

    def test_full_reads_as_100(self):
        self.assertEqual(m900_hid.decode(bytes.fromhex("033d400200")),
                         {"event": "power", "state": "full", "level": 100})

    def test_other_events_and_bad_levels_are_skipped(self):
        self.assertIsNone(m900_hid.decode(bytes.fromhex("033d500004")))  # ACK
        self.assertIsNone(m900_hid.decode(bytes.fromhex("033d400100")))
        self.assertIsNone(m900_hid.decode(bytes.fromhex("033d4001")))

    # 2026-10-22: the DPI button cycled 03 3d 10 04 00, 03 3d 10 05 00...
    def test_dpi_button_reports_the_stage(self):
        self.assertEqual(m900_hid.decode(bytes.fromhex("033d100400")),
                         {"event": "dpi", "stage": 4})
        self.assertIsNone(m900_hid.decode(bytes.fromhex("033d100900")))

    def test_rate_shortcut_reports_the_index(self):
        self.assertEqual(m900_hid.decode(bytes.fromhex("033d204400")),
                         {"event": "polling", "index": 3})


class CommandTest(unittest.TestCase):
    def test_ack_names_the_report_and_status(self):
        self.assertEqual(m900_hid.ack_for(bytes.fromhex("033d500006")), (0x06, 0))
        self.assertIsNone(m900_hid.ack_for(bytes.fromhex("033d40014d")))

    def test_only_known_reports_with_a_matching_length_are_sent(self):
        self.assertEqual(m900_hid.parse_packet("06090144bb00000000")[0], 0x06)
        for bad in ("06090144bb", "08030100", "zz", ""):
            with self.assertRaises(ValueError, msg=bad):
                m900_hid.parse_packet(bad)

    def test_bad_arguments_never_touch_the_device(self):
        self.assertEqual(m900_hid.apply([]), {"ok": False, "error": "invalid"})
        self.assertEqual(m900_hid.apply(["{}"]), {"ok": False, "error": "invalid"})
        self.assertEqual(m900_hid.apply(["[]", "06090144bb00000000"]), {"ok": False, "error": "invalid"})
        self.assertEqual(m900_hid.apply(["{}", "0803010000"]), {"ok": False, "error": "invalid"})

    def test_profile_is_written_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "delux-m900" / "profile.json"
            m900_hid.save_profile({"polling": 3}, path)
            self.assertEqual(path.read_text(), '{\n  "polling": 3\n}\n')
            self.assertFalse(path.with_suffix(".tmp").exists())

    def test_ioctl_number_matches_the_one_used_on_hardware(self):
        self.assertEqual(m900_hid.hidiocsfeature(9), 0xC0094806)


if __name__ == "__main__":
    unittest.main()
