const experience = document.querySelector('#experience');
const subtitleText = document.querySelector('#subtitleText');
const speakerLabel = document.querySelector('#speakerLabel');
const stateLabel = document.querySelector('#stateLabel');
const emotionLabel = document.querySelector('#emotionLabel');
const messageInput = document.querySelector('#messageInput');
const sendButton = document.querySelector('#sendButton');
const composer = document.querySelector('#composer');
const micButton = document.querySelector('#micButton');
const interruptButton = document.querySelector('#interruptButton');
const choices = document.querySelector('#choices');
const photoEvent = document.querySelector('#photoEvent');
const flash = document.querySelector('#flash');
const diagnostics = document.querySelector('#diagnostics');
const eventLog = document.querySelector('#eventLog');
const errorBanner = document.querySelector('#errorBanner');
const connection = document.querySelector('#connection');
const toast = document.querySelector('#toast');
const statusAnnouncer = document.querySelector('#statusAnnouncer');
const logButton = document.querySelector('#logButton');
const closeLogButton = document.querySelector('#closeLogButton');

const stateCopy = {
  idle: 'Mira 正在等你',
  listening: 'Mira 在听',
  thinking: 'Mira 正在斟酌',
  speaking: 'Mira 正在说话',
};

const emotionCopy = {
  guarded: '克制',
  alert: '警觉',
  relieved: '释然',
};

const choiceSets = {
  opening: [
    ['你在等谁？', '你在等谁？'],
    ['问那台相机', '你相机里的照片是谁拍的？'],
    ['陪她离开', '店要关门了，一起走吧。'],
  ],
  'first-contact': [
    ['你在等谁？', '你在等谁？'],
    ['问那台相机', '你相机里的照片是谁拍的？'],
    ['我陪你等', '没关系，我可以陪你等到十点。'],
  ],
  'name-withheld': [
    ['为什么选这里？', '为什么偏偏选这家咖啡馆？'],
    ['问那台相机', '我能看看你相机里的照片吗？'],
    ['我陪你等', '没关系，我可以陪你等到十点。'],
  ],
  'photo-revealed': [
    ['倒影里是谁？', '倒影里的人她是谁？'],
    ['照片从哪来？', '这张照片是谁放进你包里的？'],
    ['去窗边看看', '我们去窗边确认一下倒影吧。'],
  ],
  'truth-shared': [
    ['她也在找你', '也许她一直在找你。'],
    ['我陪你去找', '我陪你去照片里的地方找她。'],
    ['先离开这里', '店要关门了，我们先一起离开。'],
  ],
  'leave-together': [
    ['再问那张照片', '离开前，再告诉我一点照片的事。'],
    ['我陪你去找', '我陪你去照片里的地方找她。'],
    ['重新经历', '我们从刚才第一次见面说起。'],
  ],
};

const runtime = {
  epoch: 0,
  turn: 0,
  activeController: null,
  activeTimers: new Set(),
  recognition: null,
  soundEnabled: true,
  speaking: false,
  listening: false,
  provider: 'mock',
  sessionId: 'rain-local',
  lastMessage: '你好，你也在等人吗？',
  transcript: [],
  toastTimer: null,
  discarded: 0,
  demoRun: 0,
  staticMode: !['localhost', '127.0.0.1'].includes(window.location.hostname)
    || new URLSearchParams(window.location.search).has('static'),
};

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
  }
}

function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function logEvent(type, detail) {
  if (type === 'DISCARD') {
    runtime.discarded += 1;
    document.querySelector('#discardMetric').textContent = String(runtime.discarded);
  }
  const row = document.createElement('div');
  row.className = 'log-row';
  const time = document.createElement('time');
  time.textContent = nowLabel();
  const text = document.createElement('span');
  text.textContent = `${type} · ${detail}`;
  row.append(time, text);
  eventLog.prepend(row);
  while (eventLog.childElementCount > 18) eventLog.lastElementChild.remove();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(runtime.toastTimer);
  runtime.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1800);
}

function schedule(callback, delay, epoch = runtime.epoch) {
  const timer = window.setTimeout(() => {
    runtime.activeTimers.delete(timer);
    if (epoch === runtime.epoch) callback();
  }, delay);
  runtime.activeTimers.add(timer);
  return timer;
}

function setSceneState(nextState, emotion = experience.dataset.emotion || 'guarded') {
  experience.dataset.state = nextState;
  experience.dataset.emotion = emotion;
  stateLabel.textContent = stateCopy[nextState];
  emotionLabel.textContent = emotionCopy[emotion] || emotion;
  interruptButton.hidden = nextState !== 'speaking';
  document.querySelector('#taskMetric').textContent = nextState.toUpperCase();
}

function setChoicesDisabled(disabled) {
  choices.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
}

function updateChoices(branch) {
  const nextChoices = choiceSets[branch] || choiceSets['first-contact'];
  choices.querySelectorAll('button').forEach((button, index) => {
    const [label, message] = nextChoices[index];
    button.textContent = label;
    button.dataset.message = message;
  });
}

function syncSendButton() {
  sendButton.disabled = !messageInput.value.trim();
}

function cancelCurrent(reason, options = {}) {
  runtime.epoch += 1;
  runtime.activeController?.abort();
  runtime.activeController = null;
  runtime.activeTimers.forEach((timer) => window.clearTimeout(timer));
  runtime.activeTimers.clear();
  window.speechSynthesis?.cancel();
  runtime.speaking = false;
  photoEvent.classList.remove('open');
  photoEvent.setAttribute('aria-hidden', 'true');
  flash.classList.remove('fire');
  interruptButton.hidden = true;
  if (!options.keepListening && runtime.recognition && runtime.listening) {
    try { runtime.recognition.abort(); } catch (_) { /* Browser already stopped it. */ }
    runtime.listening = false;
  }
  logEvent('CANCEL', `${reason}; epoch=${runtime.epoch}`);
}

function localReply(message, requestId, branch = 'opening') {
  const compact = message.toLowerCase().replace(/\s+/g, '');
  let reply;
  if (branch === 'leave-together') {
    reply = {
      text: '门铃在身后响了一声。我们没有回头。沿着照片上的街口走，雨水正把旧脚印一点点照亮。',
      directive: { emotion: 'relieved', gesture: 'shoulders-release', camera: 'warm-close', effect: 'rain-ease', branch: 'leave-together', media: null },
    };
  } else if (branch === 'truth-shared' && /(陪你|一起|去找|离开)/.test(compact)) {
    reply = {
      text: '好。我们从后门走，先去照片里的街口。谢谢你没有把这当成一个故事，而是当成一个人还在等另一个人。',
      directive: { emotion: 'relieved', gesture: 'shoulders-release', camera: 'warm-close', effect: 'rain-ease', branch: 'leave-together', media: null },
    };
  } else if (branch === 'name-withheld' && /(为什么|这里|咖啡馆)/.test(compact)) {
    reply = {
      text: '因为三年前我们第一次见面就在这扇窗边。她说，如果有一天走散了，就回到最初有人记得我们的地方。',
      directive: { emotion: 'guarded', gesture: 'window-glance', camera: 'window-drift', effect: 'rain-rise', branch: 'name-withheld', media: null },
    };
  } else if (branch === 'photo-revealed' && /(她是谁|倒影|为什么|真相)/.test(compact)) {
    reply = {
      text: '倒影里的人是我姐姐。三年前她失踪前，最后一张照片也是在这扇窗边。今晚有人把新的照片送回来，我才知道她可能一直在找我。',
      directive: { emotion: 'relieved', gesture: 'shoulders-release', camera: 'warm-close', effect: 'rain-ease', branch: 'truth-shared', media: null },
    };
  } else if (branch === 'photo-revealed' && /(谁放|从哪|哪里来)/.test(compact)) {
    reply = {
      text: '店员说，照片是一个穿灰色雨衣的人留下的。她没进门，只隔着玻璃看了我很久。照片背面还有一道今天才沾上的蓝色颜料。',
      directive: { emotion: 'alert', gesture: 'camera-clasp', camera: 'soft-close', effect: 'rain-rise', branch: 'photo-revealed', media: null },
    };
  } else if (/(照片|相机|拍到|胶卷)/.test(compact)) {
    reply = {
      text: '这张不是我拍的。暴雨前，有人把它塞进我的相机包，只写了今晚十点。你看，窗边那个倒影，像不像这里？',
      directive: { emotion: 'alert', gesture: 'camera-clasp', camera: 'photo-push', effect: 'flash', branch: 'photo-revealed', media: 'lost-photo' },
    };
  } else if (/(等谁|等人|为什么等|那个人)/.test(compact)) {
    reply = {
      text: '一个很久没见的人。至少，我原来以为会是她。现在我更想知道，为什么有人希望我在这里被看见。',
      directive: { emotion: 'guarded', gesture: 'window-glance', camera: 'window-drift', effect: 'rain-rise', branch: 'name-withheld', media: null },
    };
  } else if (/(走吧|离开|送你|一起走|关门)/.test(compact)) {
    reply = {
      text: '好。等我把这杯喝完，我们从后门走。那里没有路灯，但雨已经小了。谢谢你没有逼我说出名字。',
      directive: { emotion: 'relieved', gesture: 'shoulders-release', camera: 'warm-close', effect: 'rain-ease', branch: 'leave-together', media: null },
    };
  } else {
    reply = {
      text: '还在。店员已经擦了三遍同一张桌子，大概是在提醒我。你也是来躲雨，还是在找人？',
      directive: { emotion: 'alert', gesture: 'listen-lean', camera: 'soft-close', effect: 'none', branch: 'first-contact', media: null },
    };
  }
  return { ...reply, requestId, turn: runtime.turn, provider: 'static-mock' };
}

async function requestReply(message, requestId, epoch) {
  runtime.activeController = new AbortController();
  const response = await fetch('/api/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: runtime.activeController.signal,
    body: JSON.stringify({
      message,
      requestId,
      turn: runtime.turn,
      sessionId: runtime.sessionId,
      branch: experience.dataset.branch || 'opening',
      history: runtime.transcript.slice(-8).map((item) => ({
        role: item.role,
        content: item.text,
      })),
    }),
  });
  if (!response.ok) throw new Error(`provider_${response.status}`);
  const payload = await response.json();
  if (epoch !== runtime.epoch || payload.requestId !== requestId) {
    throw new DOMException('Stale response', 'AbortError');
  }
  return payload;
}

function updateProgress(branch) {
  const beats = {
    opening: ['打烊前的最后十分钟', 1],
    'first-contact': ['打烊前的最后十分钟', 1],
    'name-withheld': ['她仍不肯说出名字', 1],
    'photo-revealed': ['照片里是同一扇窗', 2],
    'truth-shared': ['她终于说出照片的来历', 3],
    'leave-together': ['雨变小了', 3],
    stay: ['话题停在雨声里', 1],
  };
  const [copy, step] = beats[branch] || beats.stay;
  document.querySelector('#sceneBeat').textContent = copy;
  document.querySelectorAll('.progress-line i').forEach((item, index) => {
    item.classList.toggle('active', index < step);
  });
  updateChoices(branch);
}

function showPhotoEvent(epoch) {
  flash.classList.remove('fire');
  void flash.offsetWidth;
  flash.classList.add('fire');
  schedule(() => {
    photoEvent.classList.add('open');
    photoEvent.setAttribute('aria-hidden', 'false');
  }, 220, epoch);
  schedule(() => {
    photoEvent.classList.remove('open');
    photoEvent.setAttribute('aria-hidden', 'true');
  }, 2300, epoch);
}

function applyDirective(directive, epoch) {
  const safe = directive || {};
  experience.dataset.emotion = safe.emotion || 'alert';
  experience.dataset.gesture = safe.gesture || 'listen-lean';
  experience.dataset.camera = safe.camera || 'steady';
  experience.dataset.effect = safe.effect || 'none';
  experience.dataset.branch = safe.branch || 'stay';
  emotionLabel.textContent = emotionCopy[experience.dataset.emotion] || '警觉';
  updateProgress(experience.dataset.branch);
  logEvent('DIRECTIVE', JSON.stringify(safe));
  if (safe.effect === 'flash' || safe.media === 'lost-photo') showPhotoEvent(epoch);
}

function streamSubtitle(text, epoch) {
  const characters = Array.from(text);
  const chunkSize = characters.length > 90 ? 3 : 2;
  let cursor = 0;
  subtitleText.textContent = '';

  const reveal = () => {
    if (epoch !== runtime.epoch) return;
    cursor = Math.min(characters.length, cursor + chunkSize);
    subtitleText.textContent = characters.slice(0, cursor).join('');
    if (cursor < characters.length) schedule(reveal, 78, epoch);
  };
  reveal();
}

function speak(text, emotion, epoch) {
  runtime.speaking = true;
  speakerLabel.textContent = 'MIRA';
  statusAnnouncer.textContent = `Mira 说：${text}`;
  setSceneState('speaking', emotion);
  streamSubtitle(text, epoch);
  setChoicesDisabled(false);
  logEvent('SPEAK', `chars=${text.length}; epoch=${epoch}`);

  const finish = () => {
    if (epoch !== runtime.epoch) return;
    runtime.speaking = false;
    subtitleText.textContent = text;
    setSceneState('idle', emotion);
    logEvent('COMPLETE', `turn=${runtime.turn}`);
  };

  if (!runtime.soundEnabled || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    schedule(finish, Math.max(1800, Math.min(6200, text.length * 115)), epoch);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.93;
  utterance.pitch = 1.03;
  utterance.volume = 0.9;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find((voice) => /^zh/i.test(voice.lang));
  if (chineseVoice) utterance.voice = chineseVoice;
  utterance.onend = finish;
  utterance.onerror = (event) => {
    if (event.error !== 'canceled' && event.error !== 'interrupted') {
      logEvent('AUDIO_FALLBACK', event.error || 'unknown');
      schedule(finish, 900, epoch);
    }
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

async function submitMessage(rawMessage, source = 'text') {
  const message = rawMessage.trim();
  if (!message) return;

  if (runtime.speaking || experience.dataset.state === 'thinking') {
    cancelCurrent(`new-${source}`);
  }
  const epoch = runtime.epoch;
  const requestId = window.crypto?.randomUUID?.() || `r-${Date.now()}-${runtime.turn + 1}`;
  const startedAt = performance.now();
  const pacing = new Promise((resolve) => window.setTimeout(resolve, 360));
  runtime.turn += 1;
  runtime.lastMessage = message;
  runtime.transcript.push({ role: 'user', text: message });
  document.querySelector('#turnMetric').textContent = String(runtime.turn);
  document.querySelector('#latencyMetric').textContent = '--';
  errorBanner.hidden = true;
  connection.classList.remove('offline');
  connection.querySelector('span').textContent = '现场在线';
  messageInput.value = '';
  syncSendButton();
  speakerLabel.textContent = '你';
  subtitleText.textContent = `“${message}”`;
  statusAnnouncer.textContent = `你说：${message}`;
  setSceneState('thinking', experience.dataset.emotion || 'guarded');
  setChoicesDisabled(true);
  logEvent('INPUT', `${source}; request=${requestId.slice(0, 8)}; “${message.slice(0, 30)}”`);
  schedule(() => {
    if (experience.dataset.state !== 'thinking') return;
    speakerLabel.textContent = 'MIRA';
    subtitleText.textContent = '她看向窗外，像是在挑选一句不会后悔的话。';
  }, 1200, epoch);
  schedule(() => {
    if (experience.dataset.state !== 'thinking') return;
    subtitleText.textContent = '雨点敲着玻璃。她还在认真想。';
  }, 3200, epoch);

  try {
    let payload;
    if (runtime.staticMode) {
      payload = localReply(message, requestId, experience.dataset.branch || 'opening');
      runtime.provider = 'static-mock';
      document.querySelector('#modeTag').textContent = 'STATIC MOCK';
    } else {
      try {
        payload = await requestReply(message, requestId, epoch);
        runtime.provider = payload.provider || 'mock';
        document.querySelector('#modeTag').textContent = runtime.provider.toUpperCase();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (/provider_503/.test(error.message)) throw error;
        payload = localReply(message, requestId, experience.dataset.branch || 'opening');
        runtime.provider = 'static-mock';
        document.querySelector('#modeTag').textContent = 'STATIC MOCK';
        logEvent('FALLBACK', 'API unavailable; local scene model active');
      }
    }
    await pacing;
    if (epoch !== runtime.epoch) return;
    const latency = Math.round(performance.now() - startedAt);
    document.querySelector('#latencyMetric').textContent = `${latency}ms`;
    runtime.transcript.push({ role: 'assistant', text: payload.text, directive: payload.directive });
    applyDirective(payload.directive, epoch);
    speak(payload.text, payload.directive?.emotion || 'alert', epoch);
  } catch (error) {
    if (error.name === 'AbortError') {
      logEvent('DISCARD', `stale response; request=${requestId.slice(0, 8)}`);
      return;
    }
    handleFailure(error.message || 'provider_unavailable');
  } finally {
    if (epoch === runtime.epoch) runtime.activeController = null;
  }
}

function handleFailure(reason) {
  setSceneState('idle', experience.dataset.emotion || 'guarded');
  setChoicesDisabled(false);
  speakerLabel.textContent = 'MIRA';
  subtitleText.textContent = '雨声还在。刚才的话没有消失。';
  statusAnnouncer.textContent = '连接暂时中断。刚才的话已经保留，可以重试。';
  errorBanner.hidden = false;
  connection.classList.add('offline');
  connection.querySelector('span').textContent = '等待重连';
  logEvent('ERROR', reason);
  document.querySelector('#retryButton').focus({ preventScroll: true });
}

function stopListening() {
  if (!runtime.recognition || !runtime.listening) return;
  try { runtime.recognition.stop(); } catch (_) { /* Already stopping. */ }
}

function startListening() {
  if (runtime.speaking || experience.dataset.state === 'thinking') {
    cancelCurrent('voice-interrupt', { keepListening: true });
    subtitleText.textContent = '（你打断了她）';
    showToast('上一轮语音、字幕与场景事件已取消');
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setSceneState('idle', experience.dataset.emotion || 'guarded');
    showToast('当前浏览器未开放语音识别，已保留文字输入');
    logEvent('VOICE_FALLBACK', 'SpeechRecognition unavailable');
    return;
  }

  if (runtime.listening) {
    stopListening();
    return;
  }

  const recognition = new Recognition();
  runtime.recognition = recognition;
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  runtime.listening = true;
  micButton.classList.add('recording');
  micButton.setAttribute('aria-label', '停止语音输入');
  setSceneState('listening', experience.dataset.emotion || 'alert');
  speakerLabel.textContent = '正在聆听';
  subtitleText.textContent = '说吧，我在这里。';
  statusAnnouncer.textContent = '正在聆听。';
  logEvent('LISTEN', 'microphone opened');

  recognition.onresult = (event) => {
    const parts = Array.from(event.results).map((result) => result[0].transcript);
    const transcript = parts.join('').trim();
    speakerLabel.textContent = transcript ? '你' : '正在聆听';
    subtitleText.textContent = transcript ? `“${transcript}”` : '说吧，我在这里。';
    const last = event.results[event.results.length - 1];
    if (last.isFinal && transcript) {
      runtime.listening = false;
      micButton.classList.remove('recording');
      micButton.setAttribute('aria-label', '开始语音输入');
      submitMessage(transcript, 'voice');
    }
  };
  recognition.onerror = (event) => {
    runtime.listening = false;
    micButton.classList.remove('recording');
    micButton.setAttribute('aria-label', '开始语音输入');
    setSceneState('idle', experience.dataset.emotion || 'guarded');
    speakerLabel.textContent = 'MIRA';
    if (event.error !== 'aborted') {
      subtitleText.textContent = '没关系，想好再告诉我。';
      showToast('没有听清，请再说一次');
    }
    logEvent('VOICE_ERROR', event.error || 'unknown');
  };
  recognition.onend = () => {
    if (!runtime.listening) return;
    runtime.listening = false;
    micButton.classList.remove('recording');
    micButton.setAttribute('aria-label', '开始语音输入');
    setSceneState('idle', experience.dataset.emotion || 'guarded');
    speakerLabel.textContent = 'MIRA';
    subtitleText.textContent = '没关系，想好再告诉我。';
  };
  try {
    recognition.start();
  } catch (error) {
    runtime.listening = false;
    micButton.classList.remove('recording');
    micButton.setAttribute('aria-label', '开始语音输入');
    setSceneState('idle', experience.dataset.emotion || 'guarded');
    speakerLabel.textContent = 'MIRA';
    subtitleText.textContent = '麦克风暂时没有回应，你仍然可以打字告诉我。';
    showToast('麦克风暂时不可用，文字输入仍可继续');
    logEvent('VOICE_ERROR', error.message || 'recognition_start_failed');
  }
}

function runInterruptDemo() {
  cancelCurrent('demo-start');
  const demoRun = ++runtime.demoRun;
  const epoch = runtime.epoch;
  const staleRequestId = `late-${Date.now().toString(36)}`;
  experience.dataset.emotion = 'guarded';
  experience.dataset.gesture = 'window-glance';
  speak('我原来以为她会在十点前出现，因为三年前的那封信里，她说如果有一天想把真相告诉我，就会选一个下雨的晚上，在我们第一次见面的地方……', 'guarded', epoch);
  window.setTimeout(() => {
    if (demoRun !== runtime.demoRun) return;
    if (epoch !== runtime.epoch) {
      logEvent('DISCARD', `late response blocked; request=${staleRequestId}; stale=${epoch}; current=${runtime.epoch}`);
    }
  }, 2600);
  schedule(() => {
    cancelCurrent('simulated-user-speech');
    setSceneState('listening', 'alert');
    speakerLabel.textContent = '你';
    subtitleText.textContent = '“等等，你相机里的照片呢？”';
    logEvent('INTERRUPT', 'speech, subtitles and pending events canceled');
    schedule(() => submitMessage('等等，你相机里的照片呢？', 'voice'), 520, runtime.epoch);
  }, 1250, epoch);
}

function resetScene() {
  cancelCurrent('session-reset');
  runtime.demoRun += 1;
  runtime.turn = 0;
  runtime.transcript = [];
  runtime.discarded = 0;
  experience.dataset.emotion = 'guarded';
  experience.dataset.gesture = '';
  experience.dataset.camera = 'steady';
  experience.dataset.effect = 'none';
  experience.dataset.branch = 'opening';
  speakerLabel.textContent = 'MIRA';
  subtitleText.textContent = '外面的雨小了些。你也是来躲雨，还是在找人？';
  statusAnnouncer.textContent = '场景已重新开始。';
  document.querySelector('#turnMetric').textContent = '0';
  document.querySelector('#latencyMetric').textContent = '--';
  document.querySelector('#discardMetric').textContent = '0';
  updateProgress('opening');
  setSceneState('idle', 'guarded');
  setChoicesDisabled(false);
  errorBanner.hidden = true;
  connection.classList.remove('offline');
  connection.querySelector('span').textContent = '现场在线';
  logEvent('SESSION', 'scene reset');
}

async function beginSession() {
  if (runtime.staticMode) {
    runtime.provider = 'static-mock';
    document.querySelector('#modeTag').textContent = 'STATIC MOCK';
    logEvent('SESSION', 'static mock session');
    return;
  }
  try {
    const response = await fetch('/api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('session_unavailable');
    const session = await response.json();
    runtime.sessionId = session.sessionId;
    runtime.provider = session.mode;
    document.querySelector('#modeTag').textContent = session.mode.toUpperCase();
    logEvent('SESSION', `${session.sessionId}; provider=${session.mode}`);
  } catch (_) {
    document.querySelector('#modeTag').textContent = 'STATIC MOCK';
    logEvent('SESSION', 'static mock session');
  }
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitMessage(messageInput.value, 'text');
});
messageInput.addEventListener('input', syncSendButton);

choices.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-message]');
  if (button) submitMessage(button.dataset.message, 'choice');
});

micButton.addEventListener('click', startListening);
interruptButton.addEventListener('click', startListening);
document.querySelector('#replayButton').addEventListener('click', resetScene);

document.querySelector('#soundButton').addEventListener('click', (event) => {
  runtime.soundEnabled = !runtime.soundEnabled;
  if (!runtime.soundEnabled && runtime.speaking) {
    cancelCurrent('sound-disabled');
    setSceneState('idle', experience.dataset.emotion || 'guarded');
  } else if (!runtime.soundEnabled) {
    window.speechSynthesis?.cancel();
  }
  event.currentTarget.innerHTML = runtime.soundEnabled
    ? '<i data-lucide="volume-2"></i>'
    : '<i data-lucide="volume-x"></i>';
  event.currentTarget.setAttribute('aria-label', runtime.soundEnabled ? '关闭声音' : '开启声音');
  showToast(runtime.soundEnabled ? '声音已开启' : '声音已关闭');
  refreshIcons();
});

function openDiagnostics() {
  diagnostics.removeAttribute('inert');
  diagnostics.scrollTop = 0;
  diagnostics.classList.add('open');
  diagnostics.setAttribute('aria-hidden', 'false');
  closeLogButton.focus({ preventScroll: true });
}

function closeDiagnostics(restoreFocus = true) {
  diagnostics.classList.remove('open');
  if (restoreFocus) {
    logButton.focus({ preventScroll: true });
  } else if (diagnostics.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  diagnostics.setAttribute('aria-hidden', 'true');
  diagnostics.setAttribute('inert', '');
}

logButton.addEventListener('click', openDiagnostics);
closeLogButton.addEventListener('click', () => closeDiagnostics());
document.querySelector('#demoInterruptButton').addEventListener('click', () => {
  closeDiagnostics(false);
  runInterruptDemo();
});
document.querySelector('#failureButton').addEventListener('click', () => {
  closeDiagnostics(false);
  cancelCurrent('simulated-provider-failure');
  handleFailure('simulated_provider_unavailable');
});
document.querySelector('#retryButton').addEventListener('click', () => {
  errorBanner.hidden = true;
  submitMessage(runtime.lastMessage || '你好', 'retry');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (diagnostics.classList.contains('open')) closeDiagnostics();
    if (runtime.speaking || runtime.listening || experience.dataset.state === 'thinking') {
      cancelCurrent('escape');
      setSceneState('idle', experience.dataset.emotion || 'guarded');
    }
  }
});

window.addEventListener('beforeunload', () => cancelCurrent('page-unload'));
window.speechSynthesis?.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());

refreshIcons();
setSceneState('idle', 'guarded');
syncSendButton();
beginSession();
