const experience = document.querySelector('#experience');
const subtitleText = document.querySelector('#subtitleText');
const stateLabel = document.querySelector('#stateLabel');
const emotionLabel = document.querySelector('#emotionLabel');
const messageInput = document.querySelector('#messageInput');
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

function localReply(message, requestId) {
  const compact = message.toLowerCase().replace(/\s+/g, '');
  let reply;
  if (/(照片|相机|拍到|胶卷)/.test(compact)) {
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
    'first-contact': ['打烊前的最后十分钟', 1],
    'name-withheld': ['她仍不肯说出名字', 1],
    'photo-revealed': ['照片里是同一扇窗', 2],
    'leave-together': ['雨变小了', 3],
    stay: ['话题停在雨声里', 1],
  };
  const [copy, step] = beats[branch] || beats.stay;
  document.querySelector('#sceneBeat').textContent = copy;
  document.querySelectorAll('.progress-line i').forEach((item, index) => {
    item.classList.toggle('active', index < step);
  });
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

function speak(text, emotion, epoch) {
  runtime.speaking = true;
  setSceneState('speaking', emotion);
  subtitleText.textContent = text;
  setChoicesDisabled(false);
  logEvent('SPEAK', `chars=${text.length}; epoch=${epoch}`);

  const finish = () => {
    if (epoch !== runtime.epoch) return;
    runtime.speaking = false;
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
  runtime.turn += 1;
  runtime.lastMessage = message;
  runtime.transcript.push({ role: 'user', text: message });
  document.querySelector('#turnMetric').textContent = String(runtime.turn);
  document.querySelector('#latencyMetric').textContent = '--';
  errorBanner.hidden = true;
  connection.classList.remove('offline');
  connection.querySelector('span').textContent = '现场在线';
  messageInput.value = '';
  subtitleText.textContent = source === 'voice' ? `“${message}”` : '……';
  setSceneState('thinking', experience.dataset.emotion || 'guarded');
  setChoicesDisabled(true);
  logEvent('INPUT', `${source}; request=${requestId.slice(0, 8)}; “${message.slice(0, 30)}”`);

  try {
    let payload;
    try {
      payload = await requestReply(message, requestId, epoch);
      runtime.provider = payload.provider || 'mock';
      document.querySelector('#modeTag').textContent = runtime.provider.toUpperCase();
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (/provider_503/.test(error.message)) throw error;
      payload = localReply(message, requestId);
      runtime.provider = 'static-mock';
      document.querySelector('#modeTag').textContent = 'STATIC MOCK';
      logEvent('FALLBACK', 'API unavailable; local scene model active');
    }
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
  subtitleText.textContent = '雨声还在。刚才的话没有消失。';
  errorBanner.hidden = false;
  connection.classList.add('offline');
  connection.querySelector('span').textContent = '等待重连';
  logEvent('ERROR', reason);
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
  subtitleText.textContent = '我在听。';
  logEvent('LISTEN', 'microphone opened');

  recognition.onresult = (event) => {
    const parts = Array.from(event.results).map((result) => result[0].transcript);
    const transcript = parts.join('').trim();
    subtitleText.textContent = transcript ? `“${transcript}”` : '我在听。';
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
    if (event.error !== 'aborted') showToast('没有听清，请再说一次');
    logEvent('VOICE_ERROR', event.error || 'unknown');
  };
  recognition.onend = () => {
    if (!runtime.listening) return;
    runtime.listening = false;
    micButton.classList.remove('recording');
    micButton.setAttribute('aria-label', '开始语音输入');
    setSceneState('idle', experience.dataset.emotion || 'guarded');
  };
  recognition.start();
}

function runInterruptDemo() {
  cancelCurrent('demo-start');
  const epoch = runtime.epoch;
  experience.dataset.emotion = 'guarded';
  experience.dataset.gesture = 'window-glance';
  speak('我原来以为她会在十点前出现，因为三年前的那封信里，她说如果有一天想把真相告诉我，就会选一个下雨的晚上，在我们第一次见面的地方……', 'guarded', epoch);
  schedule(() => {
    cancelCurrent('simulated-user-speech');
    setSceneState('listening', 'alert');
    subtitleText.textContent = '“等等，你相机里的照片呢？”';
    logEvent('INTERRUPT', 'speech, subtitles and pending events canceled');
    schedule(() => submitMessage('等等，你相机里的照片呢？', 'voice'), 520, runtime.epoch);
  }, 1250, epoch);
}

function resetScene() {
  cancelCurrent('session-reset');
  runtime.turn = 0;
  runtime.transcript = [];
  experience.dataset.emotion = 'guarded';
  experience.dataset.gesture = '';
  experience.dataset.camera = 'steady';
  experience.dataset.effect = 'none';
  experience.dataset.branch = 'opening';
  subtitleText.textContent = '外面的雨小了些。你也是来躲雨，还是在找人？';
  document.querySelector('#turnMetric').textContent = '0';
  document.querySelector('#latencyMetric').textContent = '--';
  updateProgress('first-contact');
  setSceneState('idle', 'guarded');
  setChoicesDisabled(false);
  errorBanner.hidden = true;
  connection.classList.remove('offline');
  connection.querySelector('span').textContent = '现场在线';
  logEvent('SESSION', 'scene reset');
}

async function beginSession() {
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

choices.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-message]');
  if (button) submitMessage(button.dataset.message, 'choice');
});

micButton.addEventListener('click', startListening);
interruptButton.addEventListener('click', startListening);
document.querySelector('#replayButton').addEventListener('click', resetScene);

document.querySelector('#soundButton').addEventListener('click', (event) => {
  runtime.soundEnabled = !runtime.soundEnabled;
  if (!runtime.soundEnabled) window.speechSynthesis?.cancel();
  event.currentTarget.innerHTML = runtime.soundEnabled
    ? '<i data-lucide="volume-2"></i>'
    : '<i data-lucide="volume-x"></i>';
  event.currentTarget.setAttribute('aria-label', runtime.soundEnabled ? '关闭声音' : '开启声音');
  showToast(runtime.soundEnabled ? '声音已开启' : '声音已关闭');
  refreshIcons();
});

document.querySelector('#logButton').addEventListener('click', () => {
  diagnostics.classList.add('open');
  diagnostics.setAttribute('aria-hidden', 'false');
});
document.querySelector('#closeLogButton').addEventListener('click', () => {
  diagnostics.classList.remove('open');
  diagnostics.setAttribute('aria-hidden', 'true');
});
document.querySelector('#demoInterruptButton').addEventListener('click', () => {
  diagnostics.classList.remove('open');
  diagnostics.setAttribute('aria-hidden', 'true');
  runInterruptDemo();
});
document.querySelector('#failureButton').addEventListener('click', () => {
  diagnostics.classList.remove('open');
  diagnostics.setAttribute('aria-hidden', 'true');
  cancelCurrent('simulated-provider-failure');
  handleFailure('simulated_provider_unavailable');
});
document.querySelector('#retryButton').addEventListener('click', () => {
  errorBanner.hidden = true;
  submitMessage(runtime.lastMessage || '你好', 'retry');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    diagnostics.classList.remove('open');
    diagnostics.setAttribute('aria-hidden', 'true');
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
beginSession();
