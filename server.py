#!/usr/bin/env python3
"""Zero-dependency demo server for the After Rain interactive scene."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class SceneReply:
    text: str
    emotion: str
    gesture: str
    camera: str = "steady"
    effect: str = "none"
    branch: str = "stay"
    media: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "directive": {
                "emotion": self.emotion,
                "gesture": self.gesture,
                "camera": self.camera,
                "effect": self.effect,
                "branch": self.branch,
                "media": self.media,
            },
        }


class MockSceneModel:
    """Deterministic scene director used when no external model is configured."""

    def respond(self, message: str, turn: int) -> SceneReply:
        normalized = re.sub(r"\s+", "", message.lower())

        if any(word in normalized for word in ("照片", "相机", "拍到", "胶卷")):
            return SceneReply(
                text="这张不是我拍的。暴雨前，有人把它塞进我的相机包，只写了今晚十点。你看，窗边那个倒影，像不像这里？",
                emotion="alert",
                gesture="camera-clasp",
                camera="photo-push",
                effect="flash",
                branch="photo-revealed",
                media="lost-photo",
            )

        if any(word in normalized for word in ("等谁", "等人", "为什么等", "那个人")):
            return SceneReply(
                text="一个很久没见的人。至少，我原来以为会是她。现在我更想知道，为什么有人希望我在这里被看见。",
                emotion="guarded",
                gesture="window-glance",
                camera="window-drift",
                effect="rain-rise",
                branch="name-withheld",
            )

        if any(word in normalized for word in ("走吧", "离开", "送你", "一起走", "关门")):
            return SceneReply(
                text="好。等我把这杯喝完，我们从后门走。那里没有路灯，但雨已经小了。谢谢你没有逼我说出名字。",
                emotion="relieved",
                gesture="shoulders-release",
                camera="warm-close",
                effect="rain-ease",
                branch="leave-together",
            )

        if any(word in normalized for word in ("你好", "嗨", "hello", "在吗")) or turn <= 1:
            return SceneReply(
                text="还在。店员已经擦了三遍同一张桌子，大概是在提醒我。你也是来躲雨，还是在找人？",
                emotion="alert",
                gesture="listen-lean",
                camera="soft-close",
                effect="none",
                branch="first-contact",
            )

        return SceneReply(
            text="你问得很直接。让我想一下……我可以先告诉你一件小事：我没有约人，但我确实在等一个答案。",
            emotion="guarded" if turn % 2 else "alert",
            gesture="camera-clasp" if turn % 2 else "listen-lean",
            camera="steady",
            effect="none",
            branch="stay",
        )


class CompatibleModel:
    """Optional OpenAI-compatible chat endpoint with deterministic fallback."""

    def __init__(self) -> None:
        self.url = os.environ.get("MODEL_API_URL", "").strip()
        self.key = os.environ.get("MODEL_API_KEY", "").strip()
        self.name = os.environ.get("MODEL_NAME", "").strip()
        self.fallback = MockSceneModel()

    @property
    def enabled(self) -> bool:
        return bool(self.url and self.key and self.name)

    def respond(self, message: str, turn: int) -> SceneReply:
        if not self.enabled:
            return self.fallback.respond(message, turn)

        system = (
            "You are Mira, a guarded 26-year-old travel photographer waiting in a closing "
            "cafe after a storm. Reply in concise Chinese. Return only JSON with keys text, "
            "emotion (guarded|alert|relieved), gesture (camera-clasp|window-glance|listen-lean|"
            "shoulders-release), camera (steady|soft-close|window-drift|photo-push|warm-close), "
            "effect (none|flash|rain-rise|rain-ease), branch, media (null|lost-photo)."
        )
        payload = {
            "model": self.name,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": message},
            ],
            "temperature": 0.7,
            "response_format": {"type": "json_object"},
        }
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=18) as response:
                raw = json.loads(response.read().decode("utf-8"))
            content = raw["choices"][0]["message"]["content"]
            data = json.loads(content)
            return SceneReply(
                text=str(data["text"])[:320],
                emotion=_allowed(data.get("emotion"), {"guarded", "alert", "relieved"}, "alert"),
                gesture=_allowed(
                    data.get("gesture"),
                    {"camera-clasp", "window-glance", "listen-lean", "shoulders-release"},
                    "listen-lean",
                ),
                camera=_allowed(
                    data.get("camera"),
                    {"steady", "soft-close", "window-drift", "photo-push", "warm-close"},
                    "steady",
                ),
                effect=_allowed(data.get("effect"), {"none", "flash", "rain-rise", "rain-ease"}, "none"),
                branch=str(data.get("branch", "stay"))[:64],
                media="lost-photo" if data.get("media") == "lost-photo" else None,
            )
        except (KeyError, ValueError, TimeoutError, urllib.error.URLError):
            return self.fallback.respond(message, turn)


def _allowed(value: Any, choices: set[str], default: str) -> str:
    return value if isinstance(value, str) and value in choices else default


MODEL = CompatibleModel()


class DemoHandler(SimpleHTTPRequestHandler):
    server_version = "AfterRainDemo/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self._json(
                {
                    "ok": True,
                    "mode": "compatible" if MODEL.enabled else "mock",
                    "serverTime": int(time.time()),
                }
            )
            return
        if self.path == "/api/session":
            self._json(
                {
                    "sessionId": f"rain-{int(time.time())}",
                    "mode": "compatible" if MODEL.enabled else "mock",
                    "character": "Mira",
                    "state": "idle",
                }
            )
            return
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/respond":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            message = str(body.get("message", "")).strip()
            request_id = str(body.get("requestId", ""))[:80]
            turn = max(1, int(body.get("turn", 1)))
        except (ValueError, json.JSONDecodeError):
            self._json({"error": "invalid_request"}, status=HTTPStatus.BAD_REQUEST)
            return

        if not message:
            self._json({"error": "empty_message"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(message) > 500:
            self._json({"error": "message_too_long"}, status=HTTPStatus.BAD_REQUEST)
            return
        if "模拟断线" in message:
            self._json({"error": "provider_unavailable", "requestId": request_id}, status=HTTPStatus.SERVICE_UNAVAILABLE)
            return

        reply = MODEL.respond(message, turn).as_dict()
        reply.update({"requestId": request_id, "turn": turn, "provider": "compatible" if MODEL.enabled else "mock"})
        self._json(reply)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the After Rain take-home demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "4344")))
    args = parser.parse_args()
    mimetypes.add_type("application/javascript", ".js")
    server = ThreadingHTTPServer((args.host, args.port), DemoHandler)
    print(f"After Rain running at http://{args.host}:{args.port}")
    print(f"Scene provider: {'compatible model' if MODEL.enabled else 'mock'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
