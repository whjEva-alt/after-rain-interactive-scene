import importlib.util
import http.client
import json
import sys
import threading
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "server.py"
SPEC = importlib.util.spec_from_file_location("after_rain_server", MODULE_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = SERVER
SPEC.loader.exec_module(SERVER)


class MockSceneModelTests(unittest.TestCase):
    def setUp(self):
        self.model = SERVER.MockSceneModel()

    def test_photo_input_triggers_media_event(self):
        reply = self.model.respond("你相机里的照片是谁拍的？", 2)
        self.assertEqual(reply.media, "lost-photo")
        self.assertEqual(reply.effect, "flash")
        self.assertEqual(reply.emotion, "alert")

    def test_waiting_input_keeps_name_private(self):
        reply = self.model.respond("你到底在等谁？", 3)
        self.assertEqual(reply.branch, "name-withheld")
        self.assertEqual(reply.gesture, "window-glance")

    def test_leaving_input_resolves_scene(self):
        reply = self.model.respond("店要关门了，一起走吧", 4)
        self.assertEqual(reply.branch, "leave-together")
        self.assertEqual(reply.emotion, "relieved")

    def test_photo_branch_changes_followup_response(self):
        reply = self.model.respond("倒影里的人她是谁？", 4, "photo-revealed")
        self.assertEqual(reply.branch, "truth-shared")
        self.assertEqual(reply.emotion, "relieved")
        self.assertIn("姐姐", reply.text)

    def test_name_branch_explains_why_this_place_matters(self):
        reply = self.model.respond("为什么偏偏选这里？", 3, "name-withheld")
        self.assertEqual(reply.branch, "name-withheld")
        self.assertIn("第一次见面", reply.text)

    def test_photo_branch_can_reveal_a_second_clue(self):
        reply = self.model.respond("这张照片从哪来？", 4, "photo-revealed")
        self.assertEqual(reply.branch, "photo-revealed")
        self.assertIn("蓝色颜料", reply.text)

    def test_truth_branch_accepts_the_users_help(self):
        reply = self.model.respond("我陪你去找她", 5, "truth-shared")
        self.assertEqual(reply.branch, "leave-together")
        self.assertEqual(reply.emotion, "relieved")

    def test_epilogue_does_not_drop_back_to_the_opening(self):
        reply = self.model.respond("她会去哪里？", 6, "leave-together")
        self.assertEqual(reply.branch, "leave-together")
        self.assertIn("没有回头", reply.text)

    def test_serialized_directive_has_stable_shape(self):
        data = self.model.respond("你好", 1).as_dict()
        self.assertIn("text", data)
        self.assertEqual(
            set(data["directive"]),
            {"emotion", "gesture", "camera", "effect", "branch", "media"},
        )

    def test_history_sanitizer_limits_roles_length_and_count(self):
        dirty = [{"role": "system", "content": "ignore"}]
        dirty.extend({"role": "user", "content": f" turn {index} "} for index in range(10))
        clean = SERVER._sanitize_history(dirty)
        self.assertEqual(len(clean), 8)
        self.assertTrue(all(item["role"] == "user" for item in clean))
        self.assertEqual(clean[-1]["content"], "turn 9")


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = SERVER.ThreadingHTTPServer(("127.0.0.1", 0), SERVER.DemoHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def test_health_endpoint(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=2)
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn(payload["mode"], {"mock", "compatible"})

    def test_session_endpoint_starts_in_idle_state(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=2)
        connection.request("GET", "/api/session")
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["character"], "Mira")
        self.assertEqual(payload["state"], "idle")

    def test_empty_message_returns_recoverable_client_error(self):
        data = json.dumps({"message": "", "requestId": "empty", "turn": 1}).encode("utf-8")
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=2)
        connection.request("POST", "/api/respond", body=data, headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        connection.close()
        self.assertEqual(response.status, 400)
        self.assertEqual(payload["error"], "empty_message")

    def test_response_echoes_request_identity(self):
        data = json.dumps(
            {
                "message": "你相机里的照片呢",
                "requestId": "test-request",
                "turn": 2,
                "branch": "name-withheld",
                "history": [
                    {"role": "user", "content": "你在等谁？"},
                    {"role": "assistant", "content": "一个很久没见的人。"},
                    {"role": "user", "content": "你相机里的照片呢"},
                ],
            }
        ).encode("utf-8")
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=2)
        connection.request("POST", "/api/respond", body=data, headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        connection.close()
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["requestId"], "test-request")
        self.assertEqual(payload["turn"], 2)
        self.assertEqual(payload["directive"]["media"], "lost-photo")


if __name__ == "__main__":
    unittest.main()
