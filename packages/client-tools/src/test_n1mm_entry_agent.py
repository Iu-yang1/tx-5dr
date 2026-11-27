import importlib.util
import pathlib
import unittest
from types import SimpleNamespace

SPEC = importlib.util.spec_from_file_location(
    "n1mm_entry_agent", pathlib.Path(__file__).with_name("n1mm-entry-agent.py")
)
AGENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGENT)


class Edit:
    def __init__(self, value=""):
        self.value = value
        self.writes = 0

    def get_value(self):
        return self.value

    def set_edit_text(self, value):
        self.writes += 1
        self.value = value


class Button:
    def __init__(self):
        self.element_info = SimpleNamespace(control_type="Button")
        self.invocations = 0

    def invoke(self):
        self.invocations += 1


class EntryAgentTests(unittest.TestCase):
    def setUp(self):
        self.executor = AGENT.EntryExecutor()
        self.call = Edit()
        self.zone = Edit()
        self.button = Button()
        self.pending = {
            "revision": 3, "fields": {"call": "JA1ABC", "zone": "25"}, "expiresAt": 2000
        }

    def apply(self, action=None, now=1000):
        pending = dict(self.pending)
        if action:
            pending["action"] = action
        return self.executor.apply(pending, self.call, self.zone, {"LOG": self.button}, now)

    def test_edit_and_readback(self):
        self.assertEqual(self.apply(), {"appliedRevision": 3})
        self.assertEqual(AGENT.read_fields(self.call, self.zone), self.pending["fields"])
        self.apply()
        self.assertEqual(self.call.writes, 1)

    def test_native_esm_action_invokes_once(self):
        pending = dict(self.pending, action='ENTER')
        buttons = {'ENTER': self.button}
        self.assertEqual(self.executor.apply(pending, self.call, self.zone, buttons, 1000), {'appliedRevision': 3})
        self.assertIn('error', self.executor.apply(pending, self.call, self.zone, buttons, 1000))
        self.assertEqual(self.button.invocations, 1)

    def test_native_log_action_is_at_most_once(self):
        self.assertEqual(self.apply("LOG"), {"appliedRevision": 3})
        self.assertIn("error", self.apply("LOG"))
        self.assertEqual(self.button.invocations, 1)

    def test_expiry_and_readback_failure_never_invoke(self):
        self.assertIn("error", self.apply("LOG", now=3000))
        self.call.set_edit_text = lambda value: None
        self.assertIn("error", self.apply("LOG"))
        self.assertEqual(self.button.invocations, 0)


if __name__ == "__main__":
    unittest.main()
