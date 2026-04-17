function requestCustomTabTitleSync() {
  if (!IS_TOP_FRAME) return;
  try {
    chrome.runtime.sendMessage({ action: 'get_custom_tab_title' }, (resp) => {
      if (chrome.runtime.lastError) return;
      customTabTitle = normalizeCustomTabTitle(resp?.title || '');
      if (!hasCustomTabTitle()) {
        const clean = getCleanDocumentTitleText();
        nativePageTitle = clean || nativePageTitle || activeSite?.name || 'AI';
      }
      applyDesiredDocumentTitle(true);
      updateSteeringUi();
    });
  } catch (_) {}
}
function verifyCustomTabTitleState(expectedTitle, onDone) {
  if (!IS_TOP_FRAME) {
    try { onDone?.(false, '상단 프레임에서만 탭 이름을 바꿀 수 있습니다.'); } catch (_) {}
    return;
  }
  try {
    chrome.runtime.sendMessage({ action: 'get_custom_tab_title' }, (resp) => {
      if (chrome.runtime.lastError) {
        try { onDone?.(false, chrome.runtime.lastError.message || '탭 이름 확인에 실패했습니다.'); } catch (_) {}
        return;
      }
      const actualTitle = normalizeCustomTabTitle(resp?.title || '');
      try { onDone?.(actualTitle === normalizeCustomTabTitle(expectedTitle), actualTitle); } catch (_) {}
    });
  } catch (_) {
    try { onDone?.(false, '탭 이름 확인에 실패했습니다.'); } catch (_) {}
  }
}
function setCustomTabTitleValue(nextTitle, options = {}) {
  if (!IS_TOP_FRAME) return;
  const normalized = normalizeCustomTabTitle(nextTitle);
  if (normalized) lastCustomTabTitle = normalized;
  customTabTitle = normalized;
  if (!normalized) {
    const clean = getCleanDocumentTitleText();
    nativePageTitle = clean || nativePageTitle || activeSite?.name || 'AI';
  }
  if (options.sync !== false) {
    applyDesiredDocumentTitle(true);
  }
  updateSteeringUi();
}
function saveCustomTabTitleFromInput() {
  if (!IS_TOP_FRAME) {
    setSteeringStatus('상단 프레임에서만 탭 이름을 바꿀 수 있습니다.', true);
    return;
  }
  const refs = ensureSteeringUi();
  const nextTitle = normalizeCustomTabTitle(refs?.tabTitleInput?.value || '');
  if (!nextTitle) {
    clearCustomTabTitleOverride();
    return;
  }
  const fallbackClean = getCleanDocumentTitleText();
  if (!hasCustomTabTitle()) nativePageTitle = fallbackClean || nativePageTitle || activeSite?.name || 'AI';
  setCustomTabTitleValue(nextTitle);
  const finalizeSuccess = (savedTitle = nextTitle) => {
    const confirmedTitle = normalizeCustomTabTitle(savedTitle || nextTitle) || nextTitle;
    setCustomTabTitleValue(confirmedTitle);
    setSteeringStatus(`크롬 탭 이름변경: ${confirmedTitle}`);
    updateSteeringUi();
  };
  const finalizeFailure = (message) => {
    setSteeringStatus(message || '탭 이름 저장에 실패했습니다.', true);
  };
  const verifyAfterFailure = (fallbackMessage) => {
    verifyCustomTabTitleState(nextTitle, (matched, info) => {
      if (matched) {
        finalizeSuccess(nextTitle);
        return;
      }
      finalizeFailure(typeof info === 'string' && info && info !== nextTitle ? fallbackMessage || info : fallbackMessage || '탭 이름 저장에 실패했습니다.');
    });
  };
  try {
    chrome.runtime.sendMessage({ action: 'set_custom_tab_title', title: nextTitle }, (resp) => {
      if (chrome.runtime.lastError) {
        verifyAfterFailure(chrome.runtime.lastError.message || '탭 이름 저장에 실패했습니다.');
        return;
      }
      if (resp?.ok === false) {
        verifyAfterFailure(resp?.message || '탭 이름 저장에 실패했습니다.');
        return;
      }
      finalizeSuccess(resp?.title || nextTitle);
    });
  } catch (_) {
    verifyAfterFailure('탭 이름 저장에 실패했습니다.');
  }
}
function clearCustomTabTitleOverride() {
  if (!IS_TOP_FRAME) {
    setSteeringStatus('상단 프레임에서만 탭 이름을 바꿀 수 있습니다.', true);
    return;
  }
  customTabTitle = '';
  applyDesiredDocumentTitle(true);
  updateSteeringUi();
  const finalizeSuccess = () => {
    setCustomTabTitleValue('', { sync: true });
    setSteeringStatus('크롬 탭 이름변경을 해제했습니다.');
    updateSteeringUi();
  };
  const verifyAfterFailure = (fallbackMessage) => {
    verifyCustomTabTitleState('', (matched, info) => {
      if (matched) {
        finalizeSuccess();
        return;
      }
      setSteeringStatus(fallbackMessage || (typeof info === 'string' ? info : '크롬 탭 이름변경 해제에 실패했습니다.'), true);
    });
  };
  try {
    chrome.runtime.sendMessage({ action: 'clear_custom_tab_title' }, (resp) => {
      if (chrome.runtime.lastError) {
        verifyAfterFailure(chrome.runtime.lastError.message || '크롬 탭 이름변경 해제에 실패했습니다.');
        return;
      }
      if (resp?.ok === false) {
        verifyAfterFailure(resp?.message || '크롬 탭 이름변경 해제에 실패했습니다.');
        return;
      }
      finalizeSuccess();
    });
  } catch (_) {
    verifyAfterFailure('크롬 탭 이름변경 해제에 실패했습니다.');
  }
}
function clearSteeringAutoSendTimer() {
  if (!steeringAutoSendTimer) return;
  try { clearTimeout(steeringAutoSendTimer); } catch (_) {}
  steeringAutoSendTimer = null;
}
function clearSteeringSendLock() {
  steeringSendLock = false;
  if (!steeringSendLockTimer) return;
  try { clearTimeout(steeringSendLockTimer); } catch (_) {}
  steeringSendLockTimer = null;
}
function clearSteeringAwaitingResponseStart() {
  steeringAwaitingResponseStart = false;
  if (!steeringAwaitingResponseTimer) return;
  try { clearTimeout(steeringAwaitingResponseTimer); } catch (_) {}
  steeringAwaitingResponseTimer = null;
}
function clearSteeringTurnCompletionWait() {
  steeringAwaitingTurnCompletion = false;
  steeringObservedGenerationSinceSend = false;
}
function armSteeringAwaitingResponseStart(ms = 15000) {
  clearSteeringAwaitingResponseStart();
  steeringAwaitingResponseStart = true;
  steeringAwaitingResponseTimer = setTimeout(() => {
    steeringAwaitingResponseStart = false;
    steeringAwaitingResponseTimer = null;
    updateSteeringUi();
  }, Math.max(1500, ms));
}
function armSteeringSendLock(ms = 2000) {
  clearSteeringSendLock();
  steeringSendLock = true;
  steeringSendLockTimer = setTimeout(() => {
    steeringSendLock = false;
    steeringSendLockTimer = null;
    updateSteeringUi();
  }, Math.max(200, ms));
}
function hasActiveSteeringOffer() {
  return !isGenerating && (completionStatus === 'completed' || completionStatus === 'idle');
}
function canAutoSendSteeringNow() {
  return hasActiveSteeringOffer() && !steeringSendLock && !steeringProcessing && !steeringAwaitingResponseStart && !steeringAwaitingTurnCompletion;
}
function clearSteeringCompletionOffer() {
  if (completionStatus === 'completed') {
    completionStatus = 'idle';
    updateTitleBadge();
    try {
      chrome.runtime.sendMessage({
        action: 'user_activity',
        platform: getSiteKey(),
        siteName: activeSite?.name,
      });
    } catch (_) {}
  }
}
function getSteeringLauncherText() {
  return steeringPanelOpen ? '후속 지시 닫기' : '후속 지시 열기';
}
function getSteeringLauncherSubText() {
  return '항상 열어둘 수 있는 후속 지시 패널';
}
function getSteeringStateLabel() {
  const name = activeSite?.name || 'AI';
  return `${name} 후속 지시`;
}
function getSteeringPrimaryLabel() {
  if (steeringAdvancedEnabled) return '새 채팅';
  return canAutoSendSteeringNow() ? 'Enter' : '입력대기';
}
function setSteeringAdvancedEnabled(nextValue) {
  steeringAdvancedEnabled = !!nextValue;
  try {
    chrome.storage.local.set({ [STEERING_STORAGE_KEYS.ADVANCED_ENABLED]: steeringAdvancedEnabled });
  } catch (_) {}
  setSteeringStatus(steeringAdvancedEnabled ? '고급설정 ON · 새 채팅 전송 모드' : '고급설정 OFF · 현재 대화 후속 지시 모드');
  updateSteeringUi();
}
function setSteeringNewChatTabCountValue(value) {
  steeringNewChatTabCount = normalizeSteeringNewChatTabCount(value);
  try {
    chrome.storage.local.set({ [STEERING_STORAGE_KEYS.NEW_CHAT_TAB_COUNT]: steeringNewChatTabCount });
  } catch (_) {}
  setSteeringStatus(`새 채팅 탭 수: ${steeringNewChatTabCount}`);
  updateSteeringUi();
}
function applySteeringTheme() {
  if (!steeringHost || !steeringRoot) return;
  steeringHost.dataset.theme = steeringTheme;
  const dock = steeringRoot.querySelector('.dock');
  if (dock) dock.setAttribute('data-theme', steeringTheme);
}
function getSteeringAnchorElement() {
  const composer = getActiveComposer();
  if (!composer) return null;
  const form = composer.closest?.('form');
  if (form && isVisible(form)) return form;
  const group = composer.closest?.('[data-testid], [role="group"], [role="presentation"]');
  if (group && isVisible(group)) return group;
  return composer;
}
function hasChatGptConversationTurns() {
  const selectors = [
    '[data-testid^="conversation-turn-"]',
    'article[data-testid*="conversation-turn"]',
    'main [data-message-author-role]',
  ];
  for (const selector of selectors) {
    const candidates = qsa(selector);
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const author = String(el.getAttribute?.('data-message-author-role') || '').trim();
      const testId = String(el.getAttribute?.('data-testid') || '').trim();
      if (author) return true;
      if (/conversation-turn/i.test(testId)) return true;
    }
  }
  return false;
}
function shouldDockSteeringAtViewportBottom() {
  if (getSiteKey() !== 'chatgpt') return false;
  return !hasChatGptConversationTurns();
}
function positionSteeringUi(force = false) {
  if (!steeringHost) return;
  if (shouldDockSteeringAtViewportBottom()) {
    const bottomDockSignature = '18|18|bottomdock';
    if (!force && steeringLastPositionSignature === bottomDockSignature) return;
    steeringLastPositionSignature = bottomDockSignature;
    steeringHost.style.left = 'auto';
    steeringHost.style.transform = 'none';
    steeringHost.style.right = '18px';
    steeringHost.style.bottom = '18px';
    return;
  }
  const anchor = getSteeringAnchorElement();
  if (anchor) {
    try {
      const rect = anchor.getBoundingClientRect();
      const right = Math.max(12, Math.round(window.innerWidth - rect.right));
      const bottom = Math.max(12, Math.round(window.innerHeight - rect.top + 10));
      const signature = `${right}|${bottom}`;
      if (!force && steeringLastPositionSignature === signature) return;
      steeringLastPositionSignature = signature;
      steeringHost.style.left = 'auto';
      steeringHost.style.transform = 'none';
      steeringHost.style.right = `${right}px`;
      steeringHost.style.bottom = `${bottom}px`;
      return;
    } catch (_) {}
  }
  const fallbackSignature = '18|140';
  if (!force && steeringLastPositionSignature === fallbackSignature) return;
  steeringLastPositionSignature = fallbackSignature;
  steeringHost.style.left = 'auto';
  steeringHost.style.transform = 'none';
  steeringHost.style.right = '18px';
  steeringHost.style.bottom = '140px';
}
window.addEventListener('resize', () => {
  positionSteeringUi();
});
function isSteeringTarget(target) {
  if (!target) return false;
  try {
    if (steeringHost && steeringHost.contains(target)) return true;
  } catch (_) {}
  try {
    if (steeringRoot && target?.getRootNode?.() === steeringRoot) return true;
  } catch (_) {}
  return false;
}
function getCurrentComposerText(el) {
  if (!el) return '';
  const tagName = String(el.tagName || '').toLowerCase();
  try {
    if (tagName === 'textarea' || tagName === 'input') return String(el.value || '');
    if (el.isContentEditable) return String(el.innerText || el.textContent || '');
  } catch (_) {}
  return '';
}
function mergeSteeringText(existingText, nextText) {
  const existing = String(existingText || '').trim();
  const next = String(nextText || '').trim();
  if (!existing) return next;
  if (!next) return existing;
  if (existing === next) return existing;
  return `${existing}
${next}`;
}
function findVisibleEditable(selectors) {
  for (const selector of selectors) {
    const candidates = qsa(selector);
    for (const el of candidates) {
      if (!el || !isVisible(el)) continue;
      if (el.disabled === true || el.readOnly === true) continue;
      if (el.getAttribute?.('aria-hidden') === 'true') continue;
      return el;
    }
  }
  return null;
}
