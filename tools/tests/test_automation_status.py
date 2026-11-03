import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import json
from datetime import datetime, timezone, timedelta
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("monitor", Path(__file__).parents[1] / "automation-status-server.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)

class StatusTest(unittest.TestCase):
    def test_running_admission_reports_current_school_without_process_arguments(self):
        tasks = [{"name": "YML Admission Monitor", "state": "Running",
                  "university": "ewha_seoul", "phase": "audit"}]
        def fixture(path):
            return {"universities": [{"university_id": "ewha_seoul", "official_name": "이화여자대학교"}]} if path.name == "universities.json" else {}
        with (
            patch.object(monitor.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(tasks).encode(),
            )),
            patch.object(monitor, "read_json", side_effect=fixture),
            patch.object(monitor, "read_tail", return_value=""),
        ):
            result = monitor.collect()
        job = next(j for j in result["jobs"] if j["name"] == "YML Admission Monitor")
        self.assertIn(["현재 세부 단계", "이화여자대학교 · 원본 무결성 검사"], job["details"])
        self.assertNotIn("CommandLine", json.dumps(result))

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
