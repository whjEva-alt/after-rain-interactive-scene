# 评审指南 / Reviewer Guide

这份文件把测试题硬性要求映射到可操作证据，减少评审寻找成本。建议先打开在线演示，再用右上角“运行记录”查看状态事件。

## 需求追踪

| 题目要求 | 实现与证据 |
| --- | --- |
| 场景和角色为主体，不用聊天列表 | `index.html` 的全屏 `scene`、`character-wrap`、`subtitle` 和底部 `interaction` |
| 移动优先，桌面可用 | `styles.css` 的 `760px`、低高度和安全区适配；已测 `390x844`、`1280x720` |
| 待机、倾听、思考、说话 | `stateCopy` + `setSceneState`；右上状态和轨道动画可见 |
| 文字输入 | 自由文本表单与三个场景化入口 |
| 麦克风输入 | `startListening` 使用 `SpeechRecognition`，支持中间结果与最终文本 |
| 语音回复和同步字幕 | `speechSynthesis` + `streamSubtitle`；共享同一 `epoch` 生命周期 |
| 连续多轮 | 前端 `transcript`、`branch`，最近 8 条历史传入后端；Mock 也按分支响应 |
| 首次使用与连续体验 | 用户输入即时回显；快捷选项随剧情节点更新；思考超过 1.2 秒时给出场景内反馈 |
| 说话时语音打断 | 说话态出现“打断并说话”；`startListening` 先执行 `cancelCurrent` 再进入倾听 |
| 语音、回复、字幕、动作、媒体全部取消 | `cancelCurrent` 取消 `AbortController`、TTS、字幕/动作计时器、照片与闪光 |
| 迟到响应不能复活 | `epoch + requestId` 双校验；模拟打断产生 `DISCARD` 日志与计数 |
| 结构化角色/场景指令 | `{emotion, gesture, camera, effect, branch, media}`，服务端枚举约束 |
| 至少 3 种情绪 | `guarded`、`alert`、`relieved` 三帧角色状态板 |
| 至少 2 种非说话动作 | `window-glance`、`listen-lean`、`camera-clasp`、`shoulders-release` |
| 环境或镜头变化 | `window-drift`、`photo-push`、`warm-close`，以及雨势/暖光变化 |
| 对话触发明显视觉事件 | 相机/照片语义返回 `media: lost-photo`，触发闪光与拍立得 |
| 一种多模态表现能力 | 状态驱动三帧角色板 + 呼吸/动作动画 + 分层合成；并组合图片媒体事件 |
| 前后端闭环 | 零依赖 `server.py` 提供 session/respond/health，兼容外部模型并自动回退 |
| 超时、断线、音频/媒体失败反馈 | 模型超时回退；断线条与重试；语音错误保留文字路径；媒体打断立即撤销 |
| 无私人密钥可体验 | GitHub Pages 使用浏览器内 `STATIC MOCK`；本地默认 Mock |
| 一条命令启动 | `python3 server.py` |
| 自动化测试 | `python3 -m unittest discover -s tests -v`，共 21 项 |

## 超出必做范围

- 渐进字幕与 TTS 共用取消生命周期，打断可见而不只是代码存在。
- 模拟真正的迟到响应并在运行面板累计丢弃次数。
- 最近对话历史和剧情分支传给可替换模型，Mock 也有分支连续性。
- 选择文案随剧情发展，用户原话即时回显，慢响应使用场景内等待文案而不是空白转圈。
- 视觉资源压缩约 75%，脚本延迟执行；技术模式从故事首屏移入诊断抽屉。
- 内建首包延迟、任务状态、结构化指令、取消和错误日志，不需要打开 DevTools。
- 公开演示、零依赖本地服务、完整源码仓库和 3–5 分钟连续演示录屏四种验收路径。

## 明确边界

- 公共演示不携带模型密钥，因此使用确定性 Mock；本地可通过三个环境变量切换兼容接口。
- 语音识别和音色依赖浏览器/操作系统；拒绝麦克风权限时仍保留完整文字体验。
- 当前角色为状态驱动的 2D 帧和 CSS 动画，不是 Live2D 骨骼与精细口型。
