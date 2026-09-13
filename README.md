# 雨停之前 / After Rain

一个移动端优先的实时互动场景 MVP。用户在即将打烊的咖啡馆与旅行摄影师 Mira 进行文字或语音交流；角色回复会同步驱动表情、动作、镜头、天气与照片事件。主界面刻意不使用聊天消息列表，而用角色、环境和字幕承载互动。

## 一条命令启动

```bash
python3 server.py
```

然后访问 `http://127.0.0.1:4344`。项目仅依赖 Python 3.9+ 和现代浏览器，无需安装第三方包，也无需私人 API 密钥。

## 核心体验

- 文字多轮互动：三个显式剧情入口，也接受自由文本。
- 语音输入与回复：使用浏览器 `SpeechRecognition` 和 `speechSynthesis`；不可用时保留完整文字闭环。
- 四态角色状态机：`idle`、`listening`、`thinking`、`speaking`。
- 三种表情：克制、警觉、释然；另有靠近倾听、望向窗外、握紧相机、放松肩膀等动作。
- 场景驱动：对话可触发推镜、窗景偏移、雨势变化、暖光变化，以及照片闪光事件。
- 语音打断：取消当前语音、请求、字幕队列、媒体事件和延迟任务；旧请求即使迟到也无法覆盖新状态。
- 降级恢复：API 不可用时自动切换浏览器内 Mock；可在运行记录中模拟断线和重试。
- 无密钥演示：静态部署仍可运行完整 Mock 剧情；本地服务端提供同构结构化响应。

## 系统结构

```text
文字 / SpeechRecognition
          |
          v
    Interaction Controller
          |
          +-- AbortController + epoch token
          |
          v
 POST /api/respond ----> CompatibleModel
          |                 |-- MockSceneModel (默认)
          |                 +-- OpenAI-compatible endpoint (可选)
          v
 { text, directive }
          |
          +-- speechSynthesis
          +-- subtitle lifecycle
          +-- character state / gesture
          +-- camera / weather / media event
```

前端主要模块位于 `app.js`：

- `submitMessage`：建立轮次、请求和迟到响应防护。
- `cancelCurrent`：统一取消控制器，所有副作用共用 `epoch`。
- `applyDirective`：把结构化指令映射到表情、动作、镜头和媒体事件。
- `speak`：语音与字幕生命周期。
- `startListening`：麦克风输入与说话中打断。
- `runInterruptDemo`：无需麦克风权限的可重复打断演示。

服务端 `server.py` 使用标准库 `ThreadingHTTPServer`，提供 `/api/session`、`/api/respond` 和 `/api/health`。默认模型是可预测的本地场景导演；配置下面三个变量后，可切换到 OpenAI-compatible Chat Completions 端点：

```bash
MODEL_API_URL=https://example.com/v1/chat/completions \
MODEL_API_KEY=... \
MODEL_NAME=... \
python3 server.py
```

服务端会约束模型指令枚举，并在超时、格式错误或上游不可用时回退到 Mock。密钥只从环境变量读取，不进入仓库或前端。

## 指令协议

```json
{
  "text": "这张不是我拍的……",
  "directive": {
    "emotion": "alert",
    "gesture": "camera-clasp",
    "camera": "photo-push",
    "effect": "flash",
    "branch": "photo-revealed",
    "media": "lost-photo"
  }
}
```

协议把语言内容与演出调度分离。新增角色时只需替换角色配置、素材和指令映射，不需要重写会话控制器。

## 打断与并发

每个互动轮次读取当前 `epoch` 并携带唯一 `requestId`。用户在角色说话或思考时发起新输入，`cancelCurrent` 会：

1. 增加 `epoch`，使所有旧回调失效。
2. `AbortController.abort()` 取消网络请求。
3. `speechSynthesis.cancel()` 立即停止角色声音。
4. 清空字幕、动作与媒体计时器。
5. 隐藏尚未结束的照片事件并进入 `listening`。

响应返回时还会同时校验 `epoch` 和 `requestId`。因此无法取消的迟到网络包也不会重新播放或覆盖当前场景。

## 技术选择与取舍

- 选择浏览器语音能力：零密钥、启动快，适合 72 小时实验；不同浏览器的识别支持与中文声线存在差异。
- 选择显式点击录音：比自动 VAD 更稳定，也减少咖啡馆雨声被误判为打断；接口层已为后续接入 VAD 保留统一取消逻辑。
- 选择分层 2D 角色板：三种表情切换稳定、资源轻、易配置；未实现精细口型同步。
- 选择结构化指令：演出可以验证和回放，避免直接执行模型生成代码。
- 公共静态演示使用浏览器内 Mock；本地一条命令运行服务端闭环。这样评审无需密钥即可体验，接入真实模型时也不改变前端协议。

## 失败与恢复

- 服务端或模型失败：顶部连接状态和错误条出现，用户可重试。
- 静态环境没有 `/api`：自动启用本地 Mock，并在运行记录中标明 `STATIC MOCK`。
- 麦克风不可用或拒绝权限：显示短反馈，文字输入保持可用。
- 语音合成失败：降级为字幕时序，不阻断剧情。
- 媒体事件被打断：立即退出，旧计时器不能再次打开。

## 测试

```bash
python3 -m unittest discover -s tests -v
```

覆盖照片事件、身份保留分支、离场分支和结构化协议。另完成桌面 `1280x720` 与移动 `390x844` 浏览器验收，包括打断、断线、重试、零横向溢出和控制台错误检查。

## 已知问题

- 浏览器 `SpeechRecognition` 并非统一标准，Safari/Firefox 可能只显示文字路径。
- `speechSynthesis` 的中文音色由操作系统决定，未实现音色一致性和音频首包流式播放。
- 角色表演使用状态驱动的 2D 角色板和 CSS 动作，没有 Live2D 口型骨骼。
- 静态公开演示不保存跨设备会话；刷新后场景重置。

## 投入时间

当前版本约 2.5 小时，包含需求拆解、原创视觉素材生成、前后端实现、响应式验证、打断与失败流程测试、文档整理。实现过程使用 AI 编程与图像生成工具，详情见 `AI_USAGE.md`。

## 如果继续开发两周

第一周接入流式 STT/LLM/TTS、服务端取消信号、回声消除、音频首包指标和会话回放；第二周把角色资源、动作优先级和剧情节点配置化，加入 Rive/Live2D 口型、自动 VAD、附和识别、端到端测试与延迟观测页。

## 素材来源

- Mira 三态角色板与雨夜咖啡馆背景：使用 OpenAI 内置图像生成工具生成，角色为原创虚构成年人。
- 图标：Lucide，本地打包。
- 其余视觉和动画：项目内 HTML/CSS/JavaScript 自制。
