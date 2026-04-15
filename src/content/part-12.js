function markAsAcknowledged(event) {
  if (isSteeringTarget(event?.target)) return;
  acknowledgeCompletion();
}
// =========================
// Monitor lifecycle (start/stop) - registered sites only
// =========================
var _observer = null;
var _handlersBound = false;
function bindHandlersOnce() {
  if (_handlersBound) return;
  _handlersBound = true;
  // 이벤트 리스너 등록
  // - focus/keydown으로는 절대 지우지 않는다.
  // - "클릭" 또는 "스크롤(휠/스크롤 이벤트)"로만 🟢 -> ⚪
  document.addEventListener('click', markAsAcknowledged, true);
  document.addEventListener('scroll', markAsAcknowledged, true);
  document.addEventListener('wheel', markAsAcknowledged, { passive: true, capture: true });
  document.addEventListener('keydown', markTypingAcknowledged, true);
  document.addEventListener('input', markTypingAcknowledged, true);
  // 탭 활성/비활성 전환 시에도 상태 재평가(백그라운드 완료 감지 보강)
  document.addEventListener('visibilitychange', () => { ensurePolling(true); scheduleCheck(); });
}
// shadow DOM deep-scan / deep-observe는 Gemini 완료 감지 보강용이 핵심이라
// 기본은 Gemini에서만 켠다.
function shouldEnableDeepForSite(site) {
  const mode = site?.detection || site?.key || '';
  return mode === 'gemini' || site?.key === 'gemini';
}
function startMonitoring(site) {
  if (monitoring && activeSite?.key === site?.key) return;
  const nextSiteKey = String(site?.key || '');
  if (steeringSessionSiteKey && steeringSessionSiteKey !== nextSiteKey) {
    resetSteeringSessionState(nextSiteKey);
  } else if (!steeringSessionSiteKey) {
    steeringSessionSiteKey = nextSiteKey;
  }
  stopMonitoring();
  activeSite = site;
  monitoring = true;
  isGenerating = false;
  completionStatus = 'idle';
  hasSentInitialState = false;
  if (!hasCustomTabTitle()) nativePageTitle = getCleanDocumentTitleText() || activeSite?.name || 'AI';
  ensureTitleSyncObserver();
  clearSteeringAutoSendTimer();
  clearSteeringSendLock();
  steeringProcessing = false;
  clearSteeringAwaitingResponseStart();
  bindHandlersOnce();
  // 오픈 shadowRoot deep query/observe 활성화
  try { setDeepEnabled(shouldEnableDeepForSite(site)); } catch (_) {}
  // DOM 변화를 감지하여 체크 실행
  _observer = new MutationObserver(() => {
    scheduleCheck();
  });
  try {
    _observer.observe(document.body, {
      childList: true,
      subtree: true,
      // Gemini는 childList 변화 없이 style/class/aria-label만 바뀌는 경우가 있어
      // attributes 감시를 켜야 🟠 -> 🟢 전환을 놓치지 않는다.
      attributes: true,
      attributeFilter: ['aria-label', 'style', 'class', 'hidden', 'disabled']
    });
  } catch (_) {
    // 일부 문서(특수 프레임)에서는 observe 실패할 수 있음
  }
  ensurePolling();
  loadSteeringPrefs(() => {
    requestCustomTabTitleSync();
    updateSteeringUi();
    scheduleCheck();
  });
}
function stopMonitoring() {
  syncSteeringDraftFromInput();
  monitoring = false;
  activeSite = null;
  isGenerating = false;
  completionStatus = 'idle';
  hasSentInitialState = false;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  if (_observer) {
    try { _observer.disconnect(); } catch (_) {}
    _observer = null;
  }
  setDeepEnabled(false);
  _lastHeartbeatAt = 0;
  disconnectTitleSyncObserver();
  clearTitleBadge();
  clearSteeringAutoSendTimer();
  clearSteeringSendLock();
  steeringProcessing = false;
  clearSteeringAwaitingResponseStart();
  clearSteeringTurnCompletionWait();
  hideSteeringUi();
}
var _bootRetryCount = 0;
function refreshSiteFromStorage() {
  // sites.js가 아직 준비되지 않은 상태(세션 복원 타이밍 등)에서는
  // 뱃지가 초기화되지 않고 그대로 비는 현상이 생길 수 있어, 짧게 재시도한다.
  if (!window?.ReadyAi?.sites) {
    if (_bootRetryCount < 20) {
      _bootRetryCount += 1;
      setTimeout(refreshSiteFromStorage, 250);
    }
    return;
  }
  chrome.storage.local.get([
    window.ReadyAi.sites.STORAGE_KEYS.ENABLED_SITES,
    window.ReadyAi.sites.STORAGE_KEYS.CUSTOM_SITES,
  ], (res) => {
    const enabledSites = window.ReadyAi.sites.ensureEnabledSitesObject(res?.enabledSites);
    const customSites = window.ReadyAi.sites.normalizeCustomSites(res?.customSites);
    // 1) 현재 프레임 URL로 먼저 판단
    let site = null;
    try {
      site = window.ReadyAi.sites.resolveSiteFromConfig(window.location.href, enabledSites, customSites);
    } catch (_) {
      site = null;
    }
    if (site) {
      startMonitoring(site);
      return;
    }
    // 2) iframe인 경우: "탭 URL" 기준으로 다시 판단
    //    (AI Studio처럼 UI가 다른 origin iframe 안에 들어간 경우를 살린다)
    if (!IS_TOP_FRAME) {
      chrome.runtime.sendMessage({ action: 'get_tab_url' }, (resp) => {
        const tabUrl = resp?.url || '';
        let tabSite = null;
        try {
          if (tabUrl) tabSite = window.ReadyAi.sites.resolveSiteFromConfig(tabUrl, enabledSites, customSites);
        } catch (_) {
          tabSite = null;
        }
        if (tabSite) startMonitoring(tabSite);
        else stopMonitoring();
      });
      return;
    }
    stopMonitoring();
  });
}
// 설정 변경 시(팝업에서 사이트 on/off 또는 custom 추가/삭제) 즉시 반영
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabledSites || changes.customSites) loadSteeringPrefs(() => {
  refreshSiteFromStorage();
});
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.ENABLED)) {
      steeringEnabled = typeof changes[STEERING_STORAGE_KEYS.ENABLED]?.newValue === 'boolean' ? !!changes[STEERING_STORAGE_KEYS.ENABLED].newValue : true;
      updateSteeringUi();
    }
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.THEME)) {
      steeringTheme = normalizeSteeringTheme(changes[STEERING_STORAGE_KEYS.THEME]?.newValue);
      applySteeringTheme();
      updateSteeringUi();
    }
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.LAUNCHER_VISIBLE)) {
      steeringLauncherVisible = typeof changes[STEERING_STORAGE_KEYS.LAUNCHER_VISIBLE]?.newValue === 'boolean' ? !!changes[STEERING_STORAGE_KEYS.LAUNCHER_VISIBLE].newValue : true;
      updateSteeringUi();
    }
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.AUTO_FOCUS_INPUT)) {
      steeringAutoFocusInput = typeof changes[STEERING_STORAGE_KEYS.AUTO_FOCUS_INPUT]?.newValue === 'boolean' ? !!changes[STEERING_STORAGE_KEYS.AUTO_FOCUS_INPUT].newValue : true;
    }
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.CLOSE_AFTER_SEND)) {
      steeringCloseAfterSend = typeof changes[STEERING_STORAGE_KEYS.CLOSE_AFTER_SEND]?.newValue === 'boolean' ? !!changes[STEERING_STORAGE_KEYS.CLOSE_AFTER_SEND].newValue : false;
    }
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.QUEUE_COUNT_VISIBLE)) {
      steeringQueueCountVisible = typeof changes[STEERING_STORAGE_KEYS.QUEUE_COUNT_VISIBLE]?.newValue === 'boolean' ? !!changes[STEERING_STORAGE_KEYS.QUEUE_COUNT_VISIBLE].newValue : true;
      updateSteeringUi();
    }
    if (Object.prototype.hasOwnProperty.call(changes, STEERING_STORAGE_KEYS.TEMPLATES)) {
      steeringTemplates = normalizeSteeringTemplates(changes[STEERING_STORAGE_KEYS.TEMPLATES]?.newValue);
      steeringTemplateRenderSignature = '';
      updateSteeringUi();
    }
    if (Object.prototype.hasOwnProperty.call(changes, TITLE_BADGE_STORAGE_KEYS.ENABLED)) {
      titleBadgeEnabled = typeof changes[TITLE_BADGE_STORAGE_KEYS.ENABLED]?.newValue === 'boolean' ? !!changes[TITLE_BADGE_STORAGE_KEYS.ENABLED].newValue : true;
      updateTitleBadge();
    }
    if (Object.prototype.hasOwnProperty.call(changes, TITLE_BADGE_STORAGE_KEYS.COUNT_ENABLED)) {
      titleBadgeCountEnabled = typeof changes[TITLE_BADGE_STORAGE_KEYS.COUNT_ENABLED]?.newValue === 'boolean' ? !!changes[TITLE_BADGE_STORAGE_KEYS.COUNT_ENABLED].newValue : true;
      updateTitleBadge();
    }
    if (changes.customTabTitles) {
      requestCustomTabTitleSync();
    }
  });
} catch (_) {}
refreshSiteFromStorage();
console.log('[Ready_Ai] content script loaded');
// background(service_worker)에서 강제 체크 요청
try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.action === 'ping') {
      try { sendResponse?.({ ok: true }); } catch (_) {}
      return;
    }
    if (msg.action === 'force_check') {
      // 상태는 polling/observer로도 갱신되지만,
      // Gemini는 탭 활성화 직후에 DOM이 크게 변하는 경우가 있어
      // background에서 "지금 한 번만" 더 체크하라고 신호를 줄 수 있게 한다.
      scheduleCheck();
      try { sendResponse?.({ ok: true }); } catch (_) {}
      return;
    }
    if (msg.action === 'custom_tab_title_updated') {
      setCustomTabTitleValue(msg.title || '');
      try { sendResponse?.({ ok: true }); } catch (_) {}
      return;
    }
    if (msg.action === 'custom_tab_title_cleared') {
      setCustomTabTitleValue('');
      try { sendResponse?.({ ok: true }); } catch (_) {}
      return;
    }
    if (msg.action === 'enqueue_steering_prompt') {
      const text = String(msg.text || '').trim();
      if (!text) {
        try { sendResponse?.({ ok: false, message: '내용이 비어 있습니다.' }); } catch (_) {}
        return;
      }
      if (!steeringEnabled) {
        try { sendResponse?.({ ok: false, message: '스티어링이 꺼져 있습니다.' }); } catch (_) {}
        return;
      }
      const item = enqueueSteeringPrompt(text, { images: [] });
      if (!item) {
        try { sendResponse?.({ ok: false, message: '대기열 추가 실패' }); } catch (_) {}
        return;
      }
      ensureSteeringUi();
      setSteeringStatus(`${getSteeringQueueCountLabel()}`);
      updateSteeringUi();
      if (steeringPanelOpen && steeringAutoFocusInput) { try { steeringRefs?.input?.focus(); } catch (_) {} }
      scheduleSteeringQueueProcessing(150);
      try { sendResponse?.({ ok: true, count: steeringQueue.length }); } catch (_) {}
      return;
    }
    if (msg.action === 'clear_steering_queue') {
      clearSteeringQueue(false);
      try { sendResponse?.({ ok: true, count: steeringQueue.length }); } catch (_) {}
      return;
    }
    if (msg.action === 'process_steering_queue_now') {
      Promise.resolve(processSteeringQueue({ source: 'manual' }))
        .then((ok) => {
          try { sendResponse?.({ ok: !!ok, count: steeringQueue.length }); } catch (_) {}
        })
        .catch(() => {
          try { sendResponse?.({ ok: false, count: steeringQueue.length }); } catch (_) {}
        });
      return true;
    }
    if (msg.action === 'get_steering_state') {
      try {
        sendResponse?.({
          ok: true,
          enabled: !!steeringEnabled,
          count: steeringQueue.length,
          canSendNow: canAutoSendSteeringNow(),
        });
      } catch (_) {}
      return;
    }
  });
} catch (_) {}
