let audioContext = null;
let audioElement = null;
const MAX_CUSTOM_AUDIO_DURATION_SEC = 8;
const SOUND_PATTERNS = {
  off: [],
  soft: [
    { frequency: 880, duration: 0.10, offset: 0.00, gain: 0.080 },
  ],
  double: [
    { frequency: 880, duration: 0.09, offset: 0.00, gain: 0.085 },
    { frequency: 988, duration: 0.09, offset: 0.18, gain: 0.085 },
  ],
  triple: [
    { frequency: 880, duration: 0.08, offset: 0.00, gain: 0.090 },
    { frequency: 988, duration: 0.08, offset: 0.13, gain: 0.092 },
    { frequency: 1175, duration: 0.12, offset: 0.28, gain: 0.095 },
  ],
  long: [
    { frequency: 740, duration: 0.32, offset: 0.00, gain: 0.090 },
  ],
};
function clampNumber(v, fallback, min, max) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  const out = Number.isFinite(n) ? n : fallback;
  if (typeof min === 'number' && out < min) return min;
  if (typeof max === 'number' && out > max) return max;
  return out;
}
function ensureAudioContext() {
  if (!audioContext) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  return audioContext;
}
function scheduleTone(ctx, step, baseTime, masterVolume) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const startTime = baseTime + (step.offset || 0);
  const duration = step.duration || 0.08;
  const gain = clampNumber(step.gain || 0.08, 0.08, 0.0001, 1) * masterVolume;
  oscillator.type = 'sine';
  oscillator.frequency.value = step.frequency || 880;
  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.04);
}
async function playPattern(soundKey, volume) {
  const pattern = SOUND_PATTERNS[soundKey] || SOUND_PATTERNS.off;
  if (!pattern.length) return false;
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (_) {
      return false;
    }
  }
  const masterVolume = clampNumber(volume, 0.85, 0, 1);
  const baseTime = ctx.currentTime + 0.02;
  for (const step of pattern) {
    scheduleTone(ctx, step, baseTime, masterVolume);
  }
  return true;
}
function ensureAudioElement() {
  if (!audioElement) {
    audioElement = document.createElement('audio');
    audioElement.preload = 'auto';
    audioElement.style.display = 'none';
    document.body.appendChild(audioElement);
  }
  return audioElement;
}
function waitForAudioOnce(el, eventName, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      el.removeEventListener(eventName, onEvent);
      clearTimeout(timer);
      resolve(value);
    };
    const onEvent = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    el.addEventListener(eventName, onEvent, { once: true });
  });
}
async function playCustomAudio(dataUrl, volume) {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  const el = ensureAudioElement();
  try {
    el.pause();
  } catch (_) {}
  el.src = dataUrl;
  el.currentTime = 0;
  el.volume = clampNumber(volume, 0.9, 0, 1);
  try {
    await el.play();
  } catch (_) {
    return false;
  }
  const ended = await Promise.race([
    waitForAudioOnce(el, 'ended', MAX_CUSTOM_AUDIO_DURATION_SEC * 1000),
    waitForAudioOnce(el, 'error', 4000).then(() => false),
  ]);
  try {
    el.pause();
    el.currentTime = 0;
  } catch (_) {}
  return !!ended;
}
async function playSound(message) {
  const soundKey = String(message?.soundKey || 'off');
  const volume = clampNumber(message?.volume, 0.85, 0, 1);
  const customSoundDataUrl = String(message?.customSoundDataUrl || '');
  if (soundKey === 'off') return false;
  if (soundKey === 'custom') {
    return playCustomAudio(customSoundDataUrl, volume);
  }
  return playPattern(soundKey, volume);
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return;
  if (message?.action === 'play_alert_sound') {
    playSound(message)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});