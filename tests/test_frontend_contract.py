import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.css = (ROOT / "styles.css").read_text(encoding="utf-8")
        cls.js = (ROOT / "app.js").read_text(encoding="utf-8")

    def test_page_exposes_text_voice_subtitles_and_interrupt(self):
        for required_id in ("messageInput", "micButton", "subtitleText", "interruptButton"):
            self.assertIn(f'id="{required_id}"', self.html)
        self.assertIn("打断角色并开始语音输入", self.html)

    def test_four_character_states_are_visible_contracts(self):
        for state in ("idle", "listening", "thinking", "speaking"):
            self.assertIn(f"{state}:", self.js)
        self.assertIn('[data-state="listening"]', self.css)
        self.assertIn('[data-state="speaking"]', self.css)

    def test_three_emotions_and_non_speaking_gestures_are_rendered(self):
        for emotion in ("guarded", "alert", "relieved"):
            self.assertIn(f"{emotion}:", self.js)
        for gesture in ("window-glance", "listen-lean", "camera-clasp", "shoulders-release"):
            self.assertIn(f'[data-gesture="{gesture}"]', self.css)

    def test_cancellation_invalidates_all_pending_outputs(self):
        for mechanism in (
            "runtime.epoch += 1",
            "runtime.activeController?.abort()",
            "runtime.activeTimers.clear()",
            "window.speechSynthesis?.cancel()",
            "photoEvent.classList.remove('open')",
        ):
            self.assertIn(mechanism, self.js)
        self.assertIn("payload.requestId !== requestId", self.js)

    def test_dialogue_can_drive_camera_effect_and_media(self):
        for field in ("emotion", "gesture", "camera", "effect", "branch", "media"):
            self.assertIn(field, self.js)
        self.assertIn("showPhotoEvent", self.js)
        self.assertIn('[data-camera="photo-push"]', self.css)

    def test_user_input_and_choices_follow_the_story(self):
        for branch in ("name-withheld", "photo-revealed", "truth-shared", "leave-together"):
            self.assertIn(f"'{branch}': [", self.js)
        self.assertIn("speakerLabel.textContent = '你'", self.js)
        self.assertIn("syncSendButton", self.js)
        self.assertIn("她看向窗外，像是在挑选一句不会后悔的话。", self.js)

    def test_primary_surface_is_fast_and_keyboard_safe(self):
        self.assertIn('fetchpriority="high"', self.html)
        self.assertIn("rain-cafe-v1.jpg", self.html)
        self.assertIn("mira-state-sheet-v1.webp", self.css)
        self.assertIn('id="diagnostics" aria-hidden="true" inert', self.html)
        self.assertIn("diagnostics.removeAttribute('inert')", self.js)
        self.assertIn("diagnostics.setAttribute('inert', '')", self.js)
        self.assertIn("staticMode", self.js)
        self.assertIn("window.location.hostname", self.js)


if __name__ == "__main__":
    unittest.main()
