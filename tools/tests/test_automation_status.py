import importlib.util
from pathlib import Path
import unittest
from datetime import datetime, timezone, timedelta
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("monitor", Path(__file__).parents[1] / "automation-status-server.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

class StatusTest(unittest.TestCase):
    def test_states_and_age(self):
        now = datetime.now(timezone.utc)
        task = {"state": "Ready", "lastRun": now.isoformat(), "result": 0}
        self.assertEqual(monitor.classify(task, 1), "최근 실행 성공")
        self.assertEqual(monitor.classify(dict(task, result=1), 1), "실패")
        self.assertEqual(monitor.classify(dict(task, state="Running"), 1), "실행 중")
        self.assertEqual(monitor.classify(dict(task, state="Disabled"), 1), "사용 안 함")
        self.assertEqual(monitor.classify(dict(task, lastRun=(now-timedelta(hours=2)).isoformat()), 1), "오래됨")
        self.assertEqual(monitor.classify({}, 1), "확인 불가")

    def test_no_foreign_host_or_origin(self):
        handler = object.__new__(monitor.Handler)
        handler.headers = {"Host": "127.0.0.1:8768", "Origin": "https://yuni9959.github.io"}
        self.assertTrue(handler.allowed())
        handler.headers["Origin"] = "https://attacker.example"
        self.assertFalse(handler.allowed())
        handler.headers = {"Host": "attacker.example:8768"}
        self.assertFalse(handler.allowed())

if __name__ == "__main__":
    unittest.main()
