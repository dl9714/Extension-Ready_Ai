// sites registry (builtin/custom)
try {
  // background(service_worker)는 extension root 기준 경로가 안전함
  importScripts('src/sites.js');
} catch (_) {
  // ignore
}
// tabStates 구조(확장됨):
// {
//   [tabId]: {
//     status: 'WHITE' | 'ORANGE' | 'GREEN',
//     platform: string,
//     siteName?: string,
//     windowId?: number,
//     lastUpdateAt?: number,
//     orangeSinceAt?: number,
//     lastNudgeAt?: number,
//   }
// }
let tabStates = {};
// 프레임별 상태(iframe 대응)
// - all_frames=true + (특정 사이트는 UI가 cross-origin iframe에 있을 수 있음)
// - 따라서 탭 단위 상태는 "프레임들 중 하나라도 생성중이면 ORANGE" 로 계산한다.
// - 프레임 하나가 계속 false를 보내서 ORANGE->GREEN을 조기 트리거하는 문제를 막는다.
let frameStates = {}; // { tabId: { frameId: { isGenerating, platform, siteName, ts } } }
// ===== Settings (storage.local) =====
const STORAGE_KEYS = {
  DND_MODE: 'dndMode',
  BADGE_ENABLED: 'badgeEnabled',
  INDIVIDUAL_COMPLETION_NOTIFICATION_ENABLED: 'individualCompletionNotificationEnabled',
  INDIVIDUAL_COMPLETION_SOUND: 'individualCompletionSound',
  BATCH_COMPLETION_NOTIFICATION_ENABLED: 'batchCompletionNotificationEnabled',
  BATCH_COMPLETION_SOUND: 'batchCompletionSound',
  BATCH_COMPLETION_THRESHOLD: 'batchCompletionThreshold',
  INDIVIDUAL_COMPLETION_VOLUME: 'individualCompletionVolume',
  BATCH_COMPLETION_VOLUME: 'batchCompletionVolume',
  INDIVIDUAL_COMPLETION_CUSTOM_SOUND_DATA_URL: 'individualCompletionCustomSoundDataUrl',
  BATCH_COMPLETION_CUSTOM_SOUND_DATA_URL: 'batchCompletionCustomSoundDataUrl',
  INDIVIDUAL_COMPLETION_CUSTOM_SOUND_NAME: 'individualCompletionCustomSoundName',
  BATCH_COMPLETION_CUSTOM_SOUND_NAME: 'batchCompletionCustomSoundName',
  // Gemini는 "백그라운드에서는 완료 UI가 늦게 갱신" 되는 케이스가 있어서,
  // 유휴(Idle) 상태에서만 "탭을 잠깐 활성화"해서 완료를 확인하는 옵션을 추가한다.
  GEMINI_PROBE_ENABLED: 'geminiProbeEnabled',
  GEMINI_PROBE_PERIOD_MIN: 'geminiProbePeriodMin',
  GEMINI_PROBE_ONLY_IDLE: 'geminiProbeOnlyIdle',
  GEMINI_PROBE_IDLE_SEC: 'geminiProbeIdleSec',
  GEMINI_PROBE_MIN_ORANGE_SEC: 'geminiProbeMinOrangeSec',
};
const GEMINI_PROBE_ALARM = 'ready_ai_gemini_probe';
const GEMINI_PROBE_MIN_PERIOD_MIN = 1; // chrome.alarms 최소 1분
const GEMINI_PROBE_NUDGE_COOLDOWN_MS = 30_000; // 너무 자주 탭 전환하면 거슬림
const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html';
const SOUND_PRESETS = Object.freeze({
  off: 'off',
  soft: 'soft',
  double: 'double',
  triple: 'triple',
  long: 'long',
  custom: 'custom',
});
let settings = {
  dndMode: false,
  badgeEnabled: true,
  individualCompletionNotificationEnabled: true,
  individualCompletionSound: SOUND_PRESETS.soft,
  batchCompletionNotificationEnabled: true,
  batchCompletionSound: SOUND_PRESETS.triple,
  batchCompletionThreshold: 4,
  individualCompletionVolume: 0.75,
  batchCompletionVolume: 0.9,
  individualCompletionCustomSoundDataUrl: '',
  batchCompletionCustomSoundDataUrl: '',
  individualCompletionCustomSoundName: '',
  batchCompletionCustomSoundName: '',
  geminiProbeEnabled: true,
  geminiProbePeriodMin: 1,
  geminiProbeOnlyIdle: true,
  geminiProbeIdleSec: 60,
  geminiProbeMinOrangeSec: 12,
};
const notificationTargets = {};
let batchWave = {
  active: false,
  startedAt: 0,
  peakOrangeCount: 0,
};
let creatingOffscreenDocument = null;
let _siteConfigCache = { enabledSites: null, customSites: [] };
function getSiteConfig(cb) {
  const sitesApi = globalThis?.ReadyAi?.sites;
  const enabledKey = sitesApi?.STORAGE_KEYS?.ENABLED_SITES || 'enabledSites';
  const customKey = sitesApi?.STORAGE_KEYS?.CUSTOM_SITES || 'customSites';
  chrome.storage.local.get([enabledKey, customKey], (res) => {
    const enabledSites = sitesApi?.ensureEnabledSitesObject
      ? sitesApi.ensureEnabledSitesObject(res?.[enabledKey])
      : (res?.[enabledKey] || {});
    const customSites = sitesApi?.normalizeCustomSites
      ? sitesApi.normalizeCustomSites(res?.[customKey])
      : (res?.[customKey] || []);
    _siteConfigCache = { enabledSites, customSites };
    cb?.(_siteConfigCache);
  });
}
// 초기 설정 로드
function safeActionCall(callResult) {
  // Chrome MV3 환경에 따라 promise/void 둘 다 올 수 있어서 안전하게 처리
  try {
    Promise.resolve(callResult).catch(() => {});
  } catch (_) {}
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function clampInt(v, fallback, min, max) {
  const n = parseInt(v, 10);
  const out = Number.isFinite(n) ? n : fallback;
  if (typeof min === 'number' && out < min) return min;
  if (typeof max === 'number' && out > max) return max;
  return out;
}
function clampNumber(v, fallback, min, max) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  const out = Number.isFinite(n) ? n : fallback;
  if (typeof min === 'number' && out < min) return min;
  if (typeof max === 'number' && out > max) return max;
  return out;
}
function pTabsQuery(query) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(query, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch (_) {
      resolve([]);
    }
  });
}
function pTabsUpdate(tabId, updateProps) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.update(tabId, updateProps, (tab) => resolve(tab || null));
    } catch (_) {
      resolve(null);
    }
  });
}
function pTabsSendMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        // 수신자가 없으면 runtime.lastError가 설정된다.
        if (chrome.runtime.lastError) return resolve(false);
        resolve(true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}
function pScriptingExec(tabId, files, allFrames = true) {
  return new Promise((resolve) => {
    try {
      if (!chrome.scripting?.executeScript) return resolve(false);
      chrome.scripting.executeScript(
        {
          target: { tabId, allFrames: !!allFrames },
          files: Array.isArray(files) ? files : [files],
        },
        () => {
          if (chrome.runtime.lastError) return resolve(false);
          resolve(true);
        }
      );
    } catch (_) {
      resolve(false);
    }
  });
}
function pRuntimeSendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) return resolve(false);
        resolve(true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}
async function ensureOffscreenDocument() {
  try {
    if (!chrome.offscreen?.createDocument) return false;
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    if ('getContexts' in chrome.runtime) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl],
      });
      if (contexts.length > 0) return true;
    } else if (globalThis.clients?.matchAll) {
      const matchedClients = await clients.matchAll();
      if (matchedClients.some((client) => client.url === offscreenUrl || client.url.includes(OFFSCREEN_DOCUMENT_PATH))) {
        return true;
      }
    }
    if (creatingOffscreenDocument) {
      await creatingOffscreenDocument;
      return true;
    }
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play individual and batch completion alert sounds.',
    });
    await creatingOffscreenDocument;
    return true;
  } catch (_) {
    return false;
  } finally {
    creatingOffscreenDocument = null;
  }
}
function normalizeSoundKey(soundKey, fallback = SOUND_PRESETS.soft) {
  const key = String(soundKey || '').trim();
  return Object.prototype.hasOwnProperty.call(SOUND_PRESETS, key) ? key : fallback;
}
function normalizeVolume(value, fallback = 0.8) {
  return clampNumber(value, fallback, 0, 1);
}
async function playAlertSound(soundKey, options = {}) {
  const normalizedSoundKey = normalizeSoundKey(soundKey, SOUND_PRESETS.soft);
  if (!normalizedSoundKey || normalizedSoundKey === SOUND_PRESETS.off) return false;
  const ready = await ensureOffscreenDocument();
  if (!ready) return false;
  return pRuntimeSendMessage({
    target: 'offscreen',
    action: 'play_alert_sound',
    soundKey: normalizedSoundKey,
    volume: normalizeVolume(options.volume, 0.8),
    customSoundDataUrl: String(options.customSoundDataUrl || ''),
  });
}
function getSoundOptionsByKind(kind) {
  if (kind === 'batch') {
    return {
      soundKey: normalizeSoundKey(settings.batchCompletionSound, SOUND_PRESETS.triple),
      volume: normalizeVolume(settings.batchCompletionVolume, 0.9),
      customSoundDataUrl: settings.batchCompletionCustomSoundDataUrl || '',
      customSoundName: settings.batchCompletionCustomSoundName || '',
    };
  }
  return {
    soundKey: normalizeSoundKey(settings.individualCompletionSound, SOUND_PRESETS.soft),
    volume: normalizeVolume(settings.individualCompletionVolume, 0.75),
    customSoundDataUrl: settings.individualCompletionCustomSoundDataUrl || '',
    customSoundName: settings.individualCompletionCustomSoundName || '',
  };
}
async function ensureContentScripts(tab) {
  // 세션 복원/탭 discard 타이밍에 따라 content script가 아직 주입되지 않은 탭이 생긴다.
  // 이 경우 title 뱃지(이모지)와 status_update가 올라오지 않아서 “뱃지 사라짐”처럼 보인다.
  const tabId = tab?.id;
  if (typeof tabId !== 'number') return false;
  const url = tab?.url || '';
  if (!url) return false;
  const site = resolveSiteForUrl(url);
  if (!site) return false; // 등록/활성된 사이트만
  // 1) ping으로 content 존재 확인
  const alive = await pTabsSendMessage(tabId, { action: 'ping' });
  if (alive) return true;
  // 2) 없으면 강제 주입(필요 권한: "scripting")
  const injected = await pScriptingExec(tabId, ['src/sites.js', 'src/content.js'], true);
  if (!injected) return false;
  // 3) 주입 직후 즉시 체크 요청
  await pTabsSendMessage(tabId, { action: 'force_check', reason: 'inject' });
  return true;
}
function pIdleQueryState(idleSec) {
  return new Promise((resolve) => {
    try {
      chrome.idle.queryState(idleSec, (state) => resolve(state || 'active'));
    } catch (_) {
      resolve('active');
    }
  });
}
function clearBadgesForAllTabs() {
  // 배지 OFF 시, "이전에 이미 찍혀 있던" 배지도 남지 않도록 전체 탭 기준으로 지움
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (!t || typeof t.id !== 'number') continue;
      safeActionCall(chrome.action.setBadgeText({ text: '', tabId: t.id }));
    }
  });
}
function refreshTrackedTabs() {
  // 현재 상태를 알고 있는 탭(= tabStates)에 대해서만 아이콘/배지를 다시 반영
  for (const id of Object.keys(tabStates)) {
    const tabId = parseInt(id, 10);
    if (!Number.isFinite(tabId)) continue;
    updateIcon(tabId);
  }
}
function ensureGeminiProbeAlarm() {
  // 설정값이 바뀌었을 때, alarms를 즉시 반영
  const enabled = !!settings.geminiProbeEnabled;
  if (!enabled) {
    try { chrome.alarms.clear(GEMINI_PROBE_ALARM); } catch (_) {}
    return;
  }
  const periodMin = clampNumber(settings.geminiProbePeriodMin, 1, GEMINI_PROBE_MIN_PERIOD_MIN, 60);
  try {
    chrome.alarms.create(GEMINI_PROBE_ALARM, { periodInMinutes: periodMin });
  } catch (_) {}
}
// 초기 설정 로드
chrome.storage.local.get([
  STORAGE_KEYS.DND_MODE,
  STORAGE_KEYS.BADGE_ENABLED,
  STORAGE_KEYS.INDIVIDUAL_COMPLETION_NOTIFICATION_ENABLED,
  STORAGE_KEYS.BATCH_COMPLETION_NOTIFICATION_ENABLED,
  STORAGE_KEYS.BATCH_COMPLETION_SOUND,
  STORAGE_KEYS.BATCH_COMPLETION_THRESHOLD,
  STORAGE_KEYS.INDIVIDUAL_COMPLETION_VOLUME,
  STORAGE_KEYS.BATCH_COMPLETION_VOLUME,
  STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_DATA_URL,
  STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_DATA_URL,
  STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_NAME,
  STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_NAME,
  STORAGE_KEYS.GEMINI_PROBE_ENABLED,
  STORAGE_KEYS.GEMINI_PROBE_PERIOD_MIN,
  STORAGE_KEYS.GEMINI_PROBE_ONLY_IDLE,
  STORAGE_KEYS.GEMINI_PROBE_IDLE_SEC,
  STORAGE_KEYS.GEMINI_PROBE_MIN_ORANGE_SEC,
], (res) => {
  if (typeof res[STORAGE_KEYS.DND_MODE] === 'boolean') settings.dndMode = res[STORAGE_KEYS.DND_MODE];
  if (typeof res[STORAGE_KEYS.BADGE_ENABLED] === 'boolean') settings.badgeEnabled = res[STORAGE_KEYS.BADGE_ENABLED];
  if (typeof res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_NOTIFICATION_ENABLED] === 'boolean') settings.individualCompletionNotificationEnabled = res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_NOTIFICATION_ENABLED];
  if (typeof res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_SOUND] === 'string') settings.individualCompletionSound = normalizeSoundKey(res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_SOUND], SOUND_PRESETS.soft);
  if (typeof res[STORAGE_KEYS.BATCH_COMPLETION_NOTIFICATION_ENABLED] === 'boolean') settings.batchCompletionNotificationEnabled = res[STORAGE_KEYS.BATCH_COMPLETION_NOTIFICATION_ENABLED];
  if (typeof res[STORAGE_KEYS.BATCH_COMPLETION_SOUND] === 'string') settings.batchCompletionSound = normalizeSoundKey(res[STORAGE_KEYS.BATCH_COMPLETION_SOUND], SOUND_PRESETS.triple);
  if (res[STORAGE_KEYS.BATCH_COMPLETION_THRESHOLD] != null) settings.batchCompletionThreshold = clampInt(res[STORAGE_KEYS.BATCH_COMPLETION_THRESHOLD], 4, 2, 99);
  if (res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_VOLUME] != null) settings.individualCompletionVolume = normalizeVolume(res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_VOLUME], 0.75);
  if (res[STORAGE_KEYS.BATCH_COMPLETION_VOLUME] != null) settings.batchCompletionVolume = normalizeVolume(res[STORAGE_KEYS.BATCH_COMPLETION_VOLUME], 0.9);
  if (typeof res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_DATA_URL] === 'string') settings.individualCompletionCustomSoundDataUrl = res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_DATA_URL] || '';
  if (typeof res[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_DATA_URL] === 'string') settings.batchCompletionCustomSoundDataUrl = res[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_DATA_URL] || '';
  if (typeof res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_NAME] === 'string') settings.individualCompletionCustomSoundName = res[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_NAME] || '';
  if (typeof res[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_NAME] === 'string') settings.batchCompletionCustomSoundName = res[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_NAME] || '';
  if (typeof res[STORAGE_KEYS.GEMINI_PROBE_ENABLED] === 'boolean') settings.geminiProbeEnabled = res[STORAGE_KEYS.GEMINI_PROBE_ENABLED];
  if (typeof res[STORAGE_KEYS.GEMINI_PROBE_ONLY_IDLE] === 'boolean') settings.geminiProbeOnlyIdle = res[STORAGE_KEYS.GEMINI_PROBE_ONLY_IDLE];
  if (res[STORAGE_KEYS.GEMINI_PROBE_PERIOD_MIN] != null) settings.geminiProbePeriodMin = clampNumber(res[STORAGE_KEYS.GEMINI_PROBE_PERIOD_MIN], 1, 1, 60);
  if (res[STORAGE_KEYS.GEMINI_PROBE_IDLE_SEC] != null) settings.geminiProbeIdleSec = clampInt(res[STORAGE_KEYS.GEMINI_PROBE_IDLE_SEC], 60, 15, 3600);
  if (res[STORAGE_KEYS.GEMINI_PROBE_MIN_ORANGE_SEC] != null) settings.geminiProbeMinOrangeSec = clampInt(res[STORAGE_KEYS.GEMINI_PROBE_MIN_ORANGE_SEC], 12, 3, 600);
  if (settings.badgeEnabled === false) clearBadgesForAllTabs();
  ensureGeminiProbeAlarm();
});
// 설정 변경 감지 (Popup에서 변경 시)
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEYS.DND_MODE]) settings.dndMode = changes[STORAGE_KEYS.DND_MODE].newValue;
  if (changes.enabledSites || changes.customSites) {
    // 모니터링 대상에서 빠진 탭은 상태를 지워서 "등록된 사이트만" 관리되도록.
    getSiteConfig(() => purgeDisabledTabs());
  }
  if (changes[STORAGE_KEYS.BADGE_ENABLED]) {
    settings.badgeEnabled = changes[STORAGE_KEYS.BADGE_ENABLED].newValue;
    if (settings.badgeEnabled === false) {
      clearBadgesForAllTabs();
    } else {
      refreshTrackedTabs();
    }
  }
  if (changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_NOTIFICATION_ENABLED]) settings.individualCompletionNotificationEnabled = !!changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_NOTIFICATION_ENABLED].newValue;
  if (changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_SOUND]) settings.individualCompletionSound = normalizeSoundKey(changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_SOUND].newValue, SOUND_PRESETS.soft);
  if (changes[STORAGE_KEYS.BATCH_COMPLETION_NOTIFICATION_ENABLED]) settings.batchCompletionNotificationEnabled = !!changes[STORAGE_KEYS.BATCH_COMPLETION_NOTIFICATION_ENABLED].newValue;
  if (changes[STORAGE_KEYS.BATCH_COMPLETION_SOUND]) settings.batchCompletionSound = normalizeSoundKey(changes[STORAGE_KEYS.BATCH_COMPLETION_SOUND].newValue, SOUND_PRESETS.triple);
  if (changes[STORAGE_KEYS.BATCH_COMPLETION_THRESHOLD]) settings.batchCompletionThreshold = clampInt(changes[STORAGE_KEYS.BATCH_COMPLETION_THRESHOLD].newValue, 4, 2, 99);
  if (changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_VOLUME]) settings.individualCompletionVolume = normalizeVolume(changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_VOLUME].newValue, 0.75);
  if (changes[STORAGE_KEYS.BATCH_COMPLETION_VOLUME]) settings.batchCompletionVolume = normalizeVolume(changes[STORAGE_KEYS.BATCH_COMPLETION_VOLUME].newValue, 0.9);
  if (changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_DATA_URL]) settings.individualCompletionCustomSoundDataUrl = String(changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_DATA_URL].newValue || '');
  if (changes[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_DATA_URL]) settings.batchCompletionCustomSoundDataUrl = String(changes[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_DATA_URL].newValue || '');
  if (changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_NAME]) settings.individualCompletionCustomSoundName = String(changes[STORAGE_KEYS.INDIVIDUAL_COMPLETION_CUSTOM_SOUND_NAME].newValue || '');
  if (changes[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_NAME]) settings.batchCompletionCustomSoundName = String(changes[STORAGE_KEYS.BATCH_COMPLETION_CUSTOM_SOUND_NAME].newValue || '');
  // Gemini probe settings
  if (changes[STORAGE_KEYS.GEMINI_PROBE_ENABLED]) settings.geminiProbeEnabled = !!changes[STORAGE_KEYS.GEMINI_PROBE_ENABLED].newValue;
  if (changes[STORAGE_KEYS.GEMINI_PROBE_ONLY_IDLE]) settings.geminiProbeOnlyIdle = !!changes[STORAGE_KEYS.GEMINI_PROBE_ONLY_IDLE].newValue;
  if (changes[STORAGE_KEYS.GEMINI_PROBE_PERIOD_MIN]) settings.geminiProbePeriodMin = clampNumber(changes[STORAGE_KEYS.GEMINI_PROBE_PERIOD_MIN].newValue, 1, 1, 60);
  if (changes[STORAGE_KEYS.GEMINI_PROBE_IDLE_SEC]) settings.geminiProbeIdleSec = clampInt(changes[STORAGE_KEYS.GEMINI_PROBE_IDLE_SEC].newValue, 60, 15, 3600);
  if (changes[STORAGE_KEYS.GEMINI_PROBE_MIN_ORANGE_SEC]) settings.geminiProbeMinOrangeSec = clampInt(changes[STORAGE_KEYS.GEMINI_PROBE_MIN_ORANGE_SEC].newValue, 12, 3, 600);
  // 관련 설정이 바뀌었으면 알람 갱신
  if (
    changes[STORAGE_KEYS.GEMINI_PROBE_ENABLED] ||
    changes[STORAGE_KEYS.GEMINI_PROBE_PERIOD_MIN]
  ) {
    ensureGeminiProbeAlarm();
  }
});
function resolveSiteForUrl(url) {
  const sitesApi = globalThis?.ReadyAi?.sites;
  if (!sitesApi?.resolveSiteFromConfig) return null;
  try {
    return sitesApi.resolveSiteFromConfig(url, _siteConfigCache.enabledSites, _siteConfigCache.customSites);
  } catch (_) {
    return null;
  }
}
function isGeminiSite(site) {
  if (!site) return false;
  // builtin: key === 'gemini'
  if (site.key === 'gemini') return true;
  // custom: detection === 'gemini'
  if (site.detection === 'gemini') return true;
  return false;
}
async function tickGeminiProbe() {
  // 1) 설정 OFF면 아무 것도 안 함
  if (!settings.geminiProbeEnabled) return;
  // 2) 현재 탭들 중 "Gemini로 감지되는" 탭만 골라서,
  //    content script에 "force_check"를 보내서 우선 갱신을 시도.
  const tabs = await pTabsQuery({});
  const now = Date.now();
  /** @type {{tab:any, site:any, orangeAgeSec:number}[]} */
  const candidates = [];
  for (const t of tabs) {
    if (!t || typeof t.id !== 'number') continue;
    const url = t.url || '';
    if (!url) continue;
    if (!isMonitoredUrl(url)) continue;
    const site = resolveSiteForUrl(url);
    if (!isGeminiSite(site)) continue;
    // 백그라운드에서 실행되는 content script에 "상태 한번 더 체크" 요청
    await pTabsSendMessage(t.id, { action: 'force_check', reason: 'gemini_probe_tick' });
    // 탭을 "잠깐 활성화"시키는 nudge 후보(= ORANGE가 오래 유지되는 Gemini 탭)
    const st = tabStates[t.id];
    if (!st || st.status !== 'ORANGE') continue;
    const orangeSinceAt = st.orangeSinceAt || st.lastUpdateAt || now;
    const orangeAgeSec = (now - orangeSinceAt) / 1000;
    const lastNudgeAt = st.lastNudgeAt || 0;
    const cooledDown = (now - lastNudgeAt) >= GEMINI_PROBE_NUDGE_COOLDOWN_MS;
    const oldEnough = orangeAgeSec >= (settings.geminiProbeMinOrangeSec || 12);
    const notAlreadyActive = !t.active;
    if (cooledDown && oldEnough && notAlreadyActive) {
      candidates.push({ tab: t, site, orangeAgeSec });
    }
  }
  // 3) "유휴일 때만" 옵션이면, active 상태에서는 절대 탭 전환 안 함
  let allowNudge = true;
  if (settings.geminiProbeOnlyIdle) {
    const idleSec = clampInt(settings.geminiProbeIdleSec, 60, 15, 3600);
    const state = await pIdleQueryState(idleSec);
    allowNudge = (state === 'idle' || state === 'locked');
  }
  if (!allowNudge) return;
  // 4) 후보 중 "가장 오래 ORANGE"인 탭 1개만 nudge
  if (!candidates.length) return;
  candidates.sort((a, b) => b.orangeAgeSec - a.orangeAgeSec);
  const pick = candidates[0];
  if (!pick?.tab?.id) return;
  await nudgeTabForGeminiCompletion(pick.tab.id, pick.tab.windowId);
}
async function nudgeTabForGeminiCompletion(targetTabId, windowId) {
  // 안전장치: 현재 tabStates가 ORANGE가 아니면 굳이 안 건드린다.
  const st = tabStates[targetTabId];
  if (!st || st.status !== 'ORANGE') {
    await pTabsSendMessage(targetTabId, { action: 'force_check', reason: 'gemini_probe_nudge_skipped' });
    return;
  }
  // 같은 윈도우에서 원래 활성 탭을 저장했다가 복구
  const activeTabs = await pTabsQuery({ windowId, active: true });
  const restoreTabId = (activeTabs && activeTabs[0] && typeof activeTabs[0].id === 'number') ? activeTabs[0].id : null;
  // 1) Gemini 탭을 활성화
  await pTabsUpdate(targetTabId, { active: true });
  await sleep(320);
  // 2) 활성화된 김에 강제 체크 한 번 더
  await pTabsSendMessage(targetTabId, { action: 'force_check', reason: 'gemini_probe_nudge' });
  await sleep(320);
  // 3) 원래 탭으로 복구
  if (restoreTabId != null && restoreTabId !== targetTabId) {
    await pTabsUpdate(restoreTabId, { active: true });
  }
  // 4) nudge 시간 기록(쿨다운)
  if (tabStates[targetTabId]) {
    tabStates[targetTabId].lastNudgeAt = Date.now();
  }
}
try {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== GEMINI_PROBE_ALARM) return;
    safeActionCall(tickGeminiProbe());
  });
} catch (_) {}
function getOrangeTabCount() {
  return Object.values(tabStates).filter((state) => state?.status === 'ORANGE').length;
}
function startBatchWave(initialOrangeCount) {
  batchWave.active = initialOrangeCount > 0;
  batchWave.startedAt = batchWave.active ? Date.now() : 0;
  batchWave.peakOrangeCount = batchWave.active ? initialOrangeCount : 0;
}
function resetBatchWave() {
  batchWave.active = false;
  batchWave.startedAt = 0;
  batchWave.peakOrangeCount = 0;
}
function rebaseBatchWave() {
  const orangeCount = getOrangeTabCount();
  resetBatchWave();
  if (orangeCount > 0) startBatchWave(orangeCount);
}
function handleOrangeWaveChange(prevOrangeCount, nextOrangeCount, options = {}) {
  if (options.cancelWave) {
    rebaseBatchWave();
    return;
  }
  if (prevOrangeCount <= 0 && nextOrangeCount > 0) {
    startBatchWave(nextOrangeCount);
    return;
  }
  if (nextOrangeCount > 0) {
    if (!batchWave.active) {
      startBatchWave(nextOrangeCount);
    } else if (nextOrangeCount > batchWave.peakOrangeCount) {
      batchWave.peakOrangeCount = nextOrangeCount;
    }
  }
  if (prevOrangeCount > 0 && nextOrangeCount <= 0) {
    const peakOrangeCount = batchWave.peakOrangeCount || prevOrangeCount;
    const shouldBatchAlert = peakOrangeCount >= clampInt(settings.batchCompletionThreshold, 4, 2, 99);
    resetBatchWave();
    if (shouldBatchAlert) {
      safeActionCall(emitBatchCompletionAlert({ peakOrangeCount }));
    }
  }
}
function buildSingleNotificationTitle(platform, siteName) {
  if (siteName) return `${siteName} 답변 완료`;
  if (platform === 'chatgpt') return 'ChatGPT 답변 완료';
  if (platform === 'gemini') return 'Gemini 답변 완료';
  if (platform === 'aistudio') return 'AI Studio 답변 완료';
  if (platform === 'claude') return 'Claude 답변 완료';
  return 'AI 답변 완료';
}
function createBasicNotification(notificationId, title, message) {
  try {
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'assets/bell_notice.png',
      title,
      message,
      priority: 2,
    });
  } catch (_) {}
}
async function emitSingleCompletionAlert({ tabId, platform, siteName }) {
  if (settings.dndMode) return;
  const title = buildSingleNotificationTitle(platform, siteName);
  if (settings.individualCompletionNotificationEnabled) {
    const notificationId = `ready_ai_single_${tabId}_${Date.now()}`;
    notificationTargets[notificationId] = { type: 'single', tabId };
    createBasicNotification(notificationId, title, '작업이 완료되었습니다. 확인하려면 클릭하세요.');
  }
  const soundOptions = getSoundOptionsByKind('single');
  if (soundOptions.soundKey !== SOUND_PRESETS.off) {
    await playAlertSound(soundOptions.soundKey, soundOptions);
  }
}
async function emitBatchCompletionAlert({ peakOrangeCount }) {
  if (settings.dndMode) return;
  if (settings.batchCompletionNotificationEnabled) {
    const notificationId = `ready_ai_batch_${Date.now()}`;
    notificationTargets[notificationId] = { type: 'batch' };
    createBasicNotification(
      notificationId,
      `대기 ${peakOrangeCount}개 전체 완료`,
      `동시에 대기 중이던 ${peakOrangeCount}개 작업 묶음이 모두 완료되었습니다.`
    );
  }
  const soundOptions = getSoundOptionsByKind('batch');
  if (soundOptions.soundKey !== SOUND_PRESETS.off) {
    await playAlertSound(soundOptions.soundKey, soundOptions);
  }
}
function updateIcon(tabId) {
  const state = tabStates[tabId]?.status || 'WHITE';
  // 아이콘은 기존 리소스를 재사용(뱃지 색으로 구분이 핵심)
  let iconPath = 'assets/bell_profile.png';
  // 배지는 "색"이 중요. 텍스트는 숨기기 위해 '1'을 쓰고 글자색을 배경과 동일하게 맞춘다.
  // (공백만 넣으면 뱃지가 안 뜨는 브라우저/환경이 있어 안전장치)
  let badgeText = '1';
  let badgeBg = '#FFFFFF';
  let badgeFg = '#FFFFFF';
  switch (state) {
    case 'ORANGE':
      iconPath = 'assets/bell_pending.png';
      badgeBg = '#FFA500';
      badgeFg = '#FFFFFF';
      break;
    case 'GREEN':
      iconPath = 'assets/bell_unread.png';
      badgeBg = '#7CFC00'; // 연두
      badgeFg = '#000000';
      break;
    case 'WHITE':
    default:
      iconPath = 'assets/bell_profile.png';
      badgeBg = '#FFFFFF';
      badgeFg = '#000000';
      break;
  }
  // 아이콘 및 배지 적용
  safeActionCall(chrome.action.setIcon({ path: iconPath, tabId: tabId }));
  // 배지 표시 OFF면 "완전 제거" (텍스트를 비우면 배지가 사라짐)
  if (!settings.badgeEnabled) {
    safeActionCall(chrome.action.setBadgeText({ text: '', tabId: tabId }));
    return;
  }
  safeActionCall(chrome.action.setBadgeText({ text: badgeText, tabId: tabId }));
  safeActionCall(chrome.action.setBadgeBackgroundColor({ color: badgeBg, tabId: tabId }));
  // MV3: 배지 텍스트 색상 지정 가능(지원 안 하면 무시)
  if (chrome.action.setBadgeTextColor) {
    try {
      safeActionCall(chrome.action.setBadgeTextColor({ color: badgeFg, tabId: tabId }));
    } catch (_) {}
  }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'test_alert_sound') {
    const kind = message.kind === 'batch' ? 'batch' : 'single';
    const fallback = getSoundOptionsByKind(kind);
    const soundKey = normalizeSoundKey(message.soundKey, fallback.soundKey);
    const volume = normalizeVolume(message.volume, fallback.volume);
    const customSoundDataUrl = String(message.customSoundDataUrl || fallback.customSoundDataUrl || '');
    playAlertSound(soundKey, { volume, customSoundDataUrl })
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
  // content script(iframe)에서 top tab URL이 필요할 때 사용
  if (message.action === 'get_tab_url') {
    sendResponse({ url: sender.tab?.url || '' });
    return;
  }
  function upsertFrameState(isGenerating, platform, siteName) {
    const now = Date.now();
    if (!frameStates[tabId]) frameStates[tabId] = {};
    frameStates[tabId][frameId] = {
      isGenerating: !!isGenerating,
      platform: platform || '',
      siteName: siteName || '',
      ts: now,
    };
  }
  function getAggregatedState() {
    const frames = frameStates[tabId] || {};
    const entries = Object.values(frames);
    // any generating?
    const anyGen = entries.some((e) => e?.isGenerating);
    // platform/siteName: generating 프레임 우선, 아니면 가장 최근
    let pick = null;
    if (anyGen) {
      pick = entries.find((e) => e?.isGenerating) || null;
    }
    if (!pick) {
      let best = null;
      for (const e of entries) {
        if (!e) continue;
        if (!best || (e.ts || 0) > (best.ts || 0)) best = e;
      }
      pick = best;
    }
    return {
      anyGen,
      platform: pick?.platform || '',
      siteName: pick?.siteName || '',
    };
  }
  if (message.action === 'status_update') {
    const platform = message.platform;
    const siteName = message.siteName;
    const prevState = tabStates[tabId] ? { ...tabStates[tabId] } : null;
    const prevStatus = prevState?.status;
    const prevOrangeCount = getOrangeTabCount();
    const now = Date.now();
    upsertFrameState(message.isGenerating, platform, siteName);
    const agg = getAggregatedState();
    const nextPlatform = agg.platform || platform || prevState?.platform || '';
    const nextSiteName = agg.siteName || siteName || prevState?.siteName || '';
    // 1) "프레임 중 하나라도" 생성중이면 ORANGE
    if (agg.anyGen) {
      tabStates[tabId] = {
        ...prevState,
        status: 'ORANGE',
        platform: nextPlatform,
        siteName: nextSiteName,
        windowId: sender.tab?.windowId,
        lastUpdateAt: now,
        orangeSinceAt: prevStatus === 'ORANGE' ? (prevState?.orangeSinceAt || now) : now,
      };
      handleOrangeWaveChange(prevOrangeCount, getOrangeTabCount());
      updateIcon(tabId);
      return;
    }
    // 2) 어떤 프레임도 생성중이 아니면:
    //    - ORANGE -> GREEN (완료)
    //    - (첫 보고) -> WHITE (아무 질문 없음)
    //    - GREEN/WHITE 유지
    if (!prevStatus) {
      tabStates[tabId] = {
        status: 'WHITE',
        platform: nextPlatform,
        siteName: nextSiteName,
        windowId: sender.tab?.windowId,
        lastUpdateAt: now,
      };
      updateIcon(tabId);
      return;
    }
    if (prevStatus === 'ORANGE') {
      tabStates[tabId] = {
        ...prevState,
        status: 'GREEN',
        platform: nextPlatform,
        siteName: nextSiteName,
        windowId: sender.tab?.windowId,
        lastUpdateAt: now,
      };
      handleOrangeWaveChange(prevOrangeCount, getOrangeTabCount());
      updateIcon(tabId);
      // 탭이 현재 비활성이면(다른 탭 보고 있으면) 알림/알림음을 보낼 수 있음
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const isActiveTab = tabs.length > 0 && tabs[0].id === tabId;
        if (!isActiveTab) safeActionCall(emitSingleCompletionAlert({ tabId, platform: nextPlatform, siteName: nextSiteName }));
      });
      return;
    }
    if (prevStatus === 'GREEN' || prevStatus === 'WHITE') {
      tabStates[tabId] = {
        ...prevState,
        status: prevStatus,
        platform: nextPlatform,
        siteName: nextSiteName,
        windowId: sender.tab?.windowId,
        lastUpdateAt: now,
      };
      updateIcon(tabId);
      return;
    }
  }
  // content 쪽 사용자 상호작용(클릭/스크롤)로 🟢 -> ⚪
  if (message.action === 'user_activity') {
    const prev = tabStates[tabId]?.status;
    if (prev === 'GREEN') {
      tabStates[tabId].status = 'WHITE';
      tabStates[tabId].lastUpdateAt = Date.now();
      updateIcon(tabId);
    }
  }
});
// 알림 클릭 시 해당 탭으로 이동
chrome.notifications.onClicked.addListener((notificationId) => {
  let tabId = null;
  const target = notificationTargets[notificationId];
  if (target?.type === 'single' && typeof target.tabId === 'number') {
    tabId = target.tabId;
  } else {
    const match = String(notificationId || '').match(/^ready_ai_single_(\d+)_/);
    if (match) tabId = parseInt(match[1], 10);
  }
  if (!Number.isFinite(tabId)) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.tabs.update(tabId, { active: true });
    if (typeof tab.windowId === 'number') {
      chrome.windows.update(tab.windowId, { focused: true });
    }
  });
  // 요구사항: 탭을 여는 것만으로는 🟢를 없애지 않는다.
  // (클릭/스크롤로만 ⚪로 전환)
});
chrome.notifications.onClosed.addListener((notificationId) => {
  delete notificationTargets[notificationId];
});
// 탭 닫힘 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  const wasOrange = tabStates[tabId]?.status === 'ORANGE';
  const prevOrangeCount = wasOrange ? getOrangeTabCount() : 0;
  delete tabStates[tabId];
  delete frameStates[tabId];
  if (wasOrange) handleOrangeWaveChange(prevOrangeCount, getOrangeTabCount(), { cancelWave: true });
});
function isMonitoredUrl(url) {
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return false;
  const sitesApi = globalThis?.ReadyAi?.sites;
  if (!sitesApi?.resolveSiteFromConfig) return true; // fallback
  try {
    const site = sitesApi.resolveSiteFromConfig(url, _siteConfigCache.enabledSites, _siteConfigCache.customSites);
    return !!site;
  } catch (_) {
    return true;
  }
}
function purgeDisabledTabs() {
  chrome.tabs.query({}, (tabs) => {
    let removedOrange = false;
    let prevOrangeCount = getOrangeTabCount();
    for (const t of tabs) {
      if (!t?.id) continue;
      if (!tabStates[t.id]) continue;
      const url = t.url || '';
      if (!url) continue;
      if (isMonitoredUrl(url)) continue;
      // 더 이상 등록된 사이트가 아니면 상태 정리 + 아이콘 흰색으로
      if (tabStates[t.id]?.status === 'ORANGE') removedOrange = true;
      delete tabStates[t.id];
      delete frameStates[t.id];
      updateIcon(t.id);
    }
    if (removedOrange) handleOrangeWaveChange(prevOrangeCount, getOrangeTabCount(), { cancelWave: true });
  });
}
async function kickAllTabs(reason) {
  getSiteConfig(async () => {
    const tabs = await pTabsQuery({});
    for (const t of tabs) {
      if (!t || typeof t.id !== 'number') continue;
      const url = t.url || '';
      const site = resolveSiteForUrl(url);
      if (!site) continue; // 등록/활성된 사이트만
      // 상태가 비어 있으면 최소 WHITE라도 찍어서 "완전 공백"을 방지
      if (!tabStates[t.id]) {
        tabStates[t.id] = {
          status: 'WHITE',
          platform: site.key,
          siteName: site.name,
          windowId: t.windowId,
          lastUpdateAt: Date.now(),
        };
        updateIcon(t.id);
      }
      // content가 없으면 주입해서 title 뱃지도 복구
      safeActionCall(ensureContentScripts(t));
      safeActionCall(pTabsSendMessage(t.id, { action: 'force_check', reason: reason || 'kick' }));
    }
  });
}
try {
  chrome.runtime.onStartup.addListener(() => {
    safeActionCall(kickAllTabs('onStartup'));
  });
} catch (_) {}
try {
  chrome.runtime.onInstalled.addListener(() => {
    safeActionCall(kickAllTabs('onInstalled'));
  });
} catch (_) {}
safeActionCall(kickAllTabs('sw_init'));