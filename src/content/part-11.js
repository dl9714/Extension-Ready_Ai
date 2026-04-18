function mountSteeringUi() {
  try { (document.body || document.documentElement).appendChild(steeringHost); } catch (_) {}
  restoreSteeringDraftToInput();
  applySteeringTheme();
  positionSteeringUi(true);
  renderSteeringQueue();
  renderSteeringTemplates();
  renderSteeringAttachments();
  syncSteeringAttachmentPreview();
}
function ensureSteeringUi() {
  if (steeringHost && steeringRoot && steeringRefs) {
    return reuseExistingSteeringUi();
  }
  createSteeringUiHost();
  buildSteeringRefs();
  bindSteeringUiEvents();
  mountSteeringUi();
  return steeringRefs;
}

function acknowledgeCompletion() {
  if (!monitoring) return;
  if (isGenerating) return;
  if (completionStatus !== 'completed') return;
  completionStatus = 'idle';
  updateTitleBadge();
  updateSteeringUi();
  chrome.runtime.sendMessage({
    action: 'user_activity',
    platform: getSiteKey(),
    siteName: activeSite?.name,
  });
}
function applySteeringUiNow() {
  if (!monitoring || !steeringEnabled) {
    hideSteeringUi();
    return;
  }
  const refs = ensureSteeringUi();
  if (!refs) return;
  refs.title.textContent = getSteeringStateLabel();
  refs.meta.textContent = getSteeringQueueCountLabel();
  if (refs.tabTitleBadge) refs.tabTitleBadge.textContent = getCurrentTitleBadgeGlyph();
  if (refs.launcherCount) {
    refs.launcherCount.textContent = getSteeringQueueCountLabel();
    refs.launcherCount.style.display = steeringQueueCountVisible ? 'inline-flex' : 'none';
  }
  refs.launcherTitle.textContent = getSteeringLauncherText();
  refs.launcherSub.textContent = getSteeringLauncherSubText();
  if (refs.tabTitleMeta) refs.tabTitleMeta.textContent = hasCustomTabTitle() ? `크롬 탭 이름변경: ${normalizeCustomTabTitle(customTabTitle)} · 원래 제목: ${normalizeCustomTabTitle(nativePageTitle || activeSite?.name || 'AI')}` : `크롬 탭 이름 자동 · 원래 제목: ${normalizeCustomTabTitle(nativePageTitle || activeSite?.name || 'AI')}`;
  const titleInputActive = steeringRoot?.activeElement === refs.tabTitleInput;
  if (refs.tabTitleInput && (!titleInputActive || !String(refs.tabTitleInput.value || '').trim())) {
    refs.tabTitleInput.value = normalizeCustomTabTitle(customTabTitle);
  }
  restoreSteeringDraftToInput();
  if (refs.tabTitleSave) refs.tabTitleSave.disabled = !IS_TOP_FRAME;
  if (refs.tabTitleClear) refs.tabTitleClear.disabled = !IS_TOP_FRAME || !hasCustomTabTitle();
  if (refs.card) refs.card.dataset.advanced = steeringAdvancedEnabled ? 'true' : 'false';
  if (refs.advancedCard) refs.advancedCard.classList.toggle('enabled', !!steeringAdvancedEnabled);
  if (refs.advancedToggle) refs.advancedToggle.checked = !!steeringAdvancedEnabled;
  if (refs.advancedBody) refs.advancedBody.style.display = steeringAdvancedEnabled ? 'flex' : 'none';
  if (refs.newChatCount && refs.newChatCount.value !== String(steeringNewChatTabCount)) {
    refs.newChatCount.value = String(steeringNewChatTabCount);
  }
  refs.primary.textContent = getSteeringPrimaryLabel();
  refs.primary.disabled = false;
  const hasDraftText = !!String(refs.input?.value || '').trim();
  const hasDraftImages = getSteeringDraftAttachmentCount() > 0;
  if (refs.newChatSend) refs.newChatSend.disabled = !steeringAdvancedEnabled || !hasDraftText || hasDraftImages || getSiteKey() !== 'chatgpt';
  if (refs.sendNow) refs.sendNow.disabled = !steeringQueue.length && !hasDraftText && !hasDraftImages;
  if (refs.clear) refs.clear.disabled = !steeringQueue.length && !hasDraftText && !hasDraftImages;
  if (refs.runNext) refs.runNext.disabled = !steeringQueue.length;
  if (refs.clearQueue) refs.clearQueue.disabled = !steeringQueue.length;
  if (refs.launcherRow) refs.launcherRow.style.display = steeringLauncherVisible ? 'inline-flex' : 'none';
  refs.launcher.style.display = steeringLauncherVisible ? 'inline-flex' : 'none';
  refs.card.style.display = steeringPanelOpen ? 'block' : 'none';
  applySteeringTheme();
  positionSteeringUi();
  renderSteeringQueue();
  renderSteeringTemplates();
  renderSteeringAttachments();
  syncSteeringAttachmentPreview();
  syncSteeringQueueCount();
  updateTitleBadge();
  steeringHost.style.display = (steeringPanelOpen || steeringLauncherVisible) ? 'block' : 'none';
}
function updateSteeringUi() {
  if (steeringUiRafId) return;
  const schedule = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 16));
  steeringUiRafId = schedule(() => {
    steeringUiRafId = 0;
    applySteeringUiNow();
  });
}
// =========================
// Generating detection rules
// =========================
// Generating detection rules
// =========================
var CHATGPT_IMAGE_GENERATING_RE = /(\b(?:creating|generating|making|rendering|drawing)\s+(?:an?\s+)?images?\b|\bimages?\s+(?:is|are|being)?\s*(?:created|generated|rendered)\b|이미지(?:를|가)?\s*(?:생성|만들|그리)(?:하는|하고\s*있는|고\s*있는|는)?\s*중|이미지\s*생성\s*중)/i;
function getElementSignalText(el) {
  if (!el) return '';
  const attrs = [
    el.getAttribute?.('aria-label'),
    el.getAttribute?.('title'),
    el.getAttribute?.('data-testid'),
    el.getAttribute?.('role'),
    el.getAttribute?.('class'),
  ];
  return `${attrs.filter(Boolean).join(' ')} ${el.innerText || el.textContent || ''}`.replace(/\s+/g, ' ').trim();
}
function hasChatGptImageGenerationSignal(el) {
  const signal = getElementSignalText(el);
  if (CHATGPT_IMAGE_GENERATING_RE.test(signal)) return true;
  return /(?:image|이미지).*(?:generat|creat|progress|loading|skeleton|생성|진행|로딩)|(?:generat|creat).*(?:image)/i.test(signal);
}
function hasChatGptProgressIndicator(el) {
  if (!el) return false;
  const selectors = [
    '[role="progressbar"]',
    '[aria-busy="true"]',
    '[data-testid*="progress"]',
    '[data-testid*="loading"]',
    '.animate-spin',
    '.animate-pulse',
    '[class*="shimmer"]',
    '[class*="skeleton"]',
  ];
  for (const selector of selectors) {
    const candidates = el.matches?.(selector) ? [el] : Array.from(el.querySelectorAll?.(selector) || []);
    if (candidates.some((candidate) => isVisible(candidate))) return true;
  }
  return false;
}
function getVisibleChatGptTurnCandidates() {
  const selectors = [
    '[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn-"]',
    'article[data-testid*="conversation-turn"]',
  ];
  const seen = new Set();
  const out = [];
  for (const selector of selectors) {
    for (const el of qsa(selector)) {
      if (!el || seen.has(el) || !isVisible(el)) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}
function isLikelyUserChatGptTurn(el) {
  const author = String(el?.getAttribute?.('data-message-author-role') || '').trim().toLowerCase();
  if (author === 'user') return true;
  if (author === 'assistant') return false;
  const hasUser = !!el?.querySelector?.('[data-message-author-role="user"]');
  const hasAssistant = !!el?.querySelector?.('[data-message-author-role="assistant"]');
  return hasUser && !hasAssistant;
}
function detectChatGPTImageGenerating() {
  const statusSelectors = [
    '[role="status"]',
    '[aria-live]',
    '[aria-busy="true"]',
    '[data-testid*="image-generation"]',
    '[data-testid*="image_generation"]',
    '[data-testid*="generating-image"]',
    '[data-testid*="image-gen"]',
    '[data-testid*="progress"]',
    '[data-testid*="loading"]',
  ];
  for (const selector of statusSelectors) {
    for (const el of qsa(selector)) {
      if (!isVisible(el)) continue;
      if (hasChatGptImageGenerationSignal(el)) return true;
    }
  }
  const turns = getVisibleChatGptTurnCandidates();
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (isLikelyUserChatGptTurn(turn)) continue;
    if (CHATGPT_IMAGE_GENERATING_RE.test(getElementSignalText(turn))) return true;
    if (hasChatGptProgressIndicator(turn) && hasChatGptImageGenerationSignal(turn)) return true;
  }
  return false;
}
function detectChatGPTGenerating() {
  const selectors = [
    '[data-testid="stop-button"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="중지"]',
    'button[data-testid*="stop"]',
  ];
  for (const sel of selectors) {
    const btns = qsa(sel);
    if (btns.some((btn) => isVisible(btn) && isEnabledButtonLike(btn))) return true;
  }
  if (detectChatGPTImageGenerating()) return true;
  return false;
}
function detectGeminiGenerating() {
  // Gemini: "중지" 또는 "Stop" 단어가 들어간 버튼이 화면에 보이는지 확인
  // (open shadowRoot 내부에 들어가는 케이스 대응)
  const btns = qsa('[aria-label*="중지"], [aria-label*="Stop"], [aria-label*="stop"]');
  return btns.some((btn) => isVisible(btn) && isEnabledButtonLike(btn));
}
function detectAiStudioGenerating() {
  // AI Studio는 "Run" 버튼이 사라지고 "Stop" 전용 요소가 생기거나,
  // Material icon이 fonticon/innerText로 stop 계열을 표시하는 경우가 많다.
  // 또한 일부 구성은 오픈 shadowRoot 아래에 버튼이 들어가므로 qsa(deep query) 사용.
  // 0) 명시적 stop 버튼
  const stopButtonSelectors = [
    'ms-stop-button',
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button[aria-label*="중지"]',
    'button[title*="Stop"]',
    'button[title*="중지"]',
  ];
  for (const sel of stopButtonSelectors) {
    const els = qsa(sel);
    if (els.some((e) => isVisible(e))) return true;
  }
  // 1) Run 버튼이 "Stop"으로 바뀌는 케이스(텍스트/aria-label 기반)
  const runBtnSelectors = [
    'ms-run-button button.run-button',
    'ms-run-button button[type="submit"]',
    'button.run-button',
    'button[aria-label="Run"]',
    'button[aria-label*="Run"]',
  ];
  const RUN_STOP_RE = /(\bstop\b|\bcancel\b|중지|취소)/i;
  for (const sel of runBtnSelectors) {
    const btns = qsa(sel);
    for (const btn of btns) {
      if (!isVisible(btn)) continue;
      const aria = (btn.getAttribute?.('aria-label') || '').trim();
      const title = (btn.getAttribute?.('title') || '').trim();
      const txt = (btn.innerText || btn.textContent || '').trim();
      const hay = `${aria} ${title} ${txt}`.trim();
      if (hay && RUN_STOP_RE.test(hay)) return true;
      // 아이콘으로만 표시되는 케이스
      const iconCandidates = [
        ...(btn.querySelectorAll?.('mat-icon') ? Array.from(btn.querySelectorAll('mat-icon')) : []),
        ...(btn.querySelectorAll?.('.material-symbols-outlined') ? Array.from(btn.querySelectorAll('.material-symbols-outlined')) : []),
      ];
      for (const icon of iconCandidates) {
        if (!icon) continue;
        const iconText = (icon.textContent || '').trim().toLowerCase();
        const fontIcon = (icon.getAttribute?.('fonticon') || '').trim().toLowerCase();
        const svgIcon = (icon.getAttribute?.('svgicon') || '').trim().toLowerCase();
        const iconHay = `${iconText} ${fontIcon} ${svgIcon}`.trim();
        if (!iconHay) continue;
        if (/(\bstop\b|stop_circle|stop_circle_filled|cancel)/i.test(iconHay)) return true;
      }
    }
  }
  // 2) Material icon (fonticon/innerText) 기반 stop
  const iconSelectors = [
    // fonticon으로 stop을 쓰는 케이스
    'button mat-icon[fonticon="stop"]',
    'button mat-icon[fonticon="stop_circle"]',
    'mat-icon[fonticon="stop"]',
    'mat-icon[fonticon="stop_circle"]',
    // svgicon 기반
    'button mat-icon[svgicon*="stop"]',
    'mat-icon[svgicon*="stop"]',
    // material symbols(outlined) text 기반
    'button .material-symbols-outlined:not([class*="keyboard"])',
    '.material-symbols-outlined:not([class*="keyboard"])',
    // 일반 mat-icon 텍스트
    'button mat-icon',
    'mat-icon',
  ];
  for (const sel of iconSelectors) {
    const els = qsa(sel);
    for (const el of els) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').trim().toLowerCase();
      const fontIcon = (el.getAttribute?.('fonticon') || '').trim().toLowerCase();
      const svgIcon = (el.getAttribute?.('svgicon') || '').trim().toLowerCase();
      const hay = `${t} ${fontIcon} ${svgIcon}`.trim();
      if (!hay) continue;
      if (/(\bstop\b|stop_circle|stop_circle_filled|\bcancel\b)/i.test(hay)) return true;
    }
  }
  // 3) 로딩/프로그레스 인디케이터
  const progressSelectors = [
    '.mat-progress-spinner',
    '.mat-mdc-progress-spinner',
    'mat-progress-spinner',
    'mat-spinner',
    '.mat-progress-bar',
    '.mat-mdc-progress-bar',
    'mat-progress-bar',
  ];
  for (const sel of progressSelectors) {
    const els = qsa(sel);
    if (els.some((e) => isVisible(e))) return true;
  }
  // 4) aria-busy 힌트
  const busy = qsa('[aria-busy="true"]');
  if (busy.some((e) => isVisible(e))) return true;
  return false;
}
function detectClaudeGenerating() {
  // Claude: 버튼 텍스트에 "Stop"이 포함되어 있는지 확인
  const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
  return buttons.some((btn) => btn.innerText.includes('Stop') && isVisible(btn));
}
function detectGenericStopGenerating() {
  // 범용: Stop/중지/Cancel/취소/Abort 텍스트 or aria-label 기반
  // (등록된 사이트에서만 쓰이므로, 너무 공격적으로 잡지 않는다)
  const STOP_RE = /(\bstop\b|\bcancel\b|\babort\b|중지|취소)/i;
  const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));
  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const aria = (el.getAttribute('aria-label') || '').trim();
    const txt = (el.innerText || '').trim();
    const hay = `${aria} ${txt}`.trim();
    if (!hay) continue;
    if (STOP_RE.test(hay)) return true;
  }
  return false;
}
function detectGenerating(site) {
  const mode = site?.detection || 'generic_stop';
  if (mode === 'chatgpt') return detectChatGPTGenerating();
  if (mode === 'gemini') return detectGeminiGenerating();
  if (mode === 'aistudio') return detectAiStudioGenerating();
  if (mode === 'claude') return detectClaudeGenerating();
  return detectGenericStopGenerating();
}
function checkStatus() {
  if (!monitoring || !activeSite) return;
  const platform = activeSite.key;
  let currentlyGenerating = false;
  try {
    // web component/shadow root 구조가 동적으로 바뀌는 사이트(AI Studio 등) 보강
    // open shadowRoot가 동적으로 생기는 사이트(특히 Gemini) 대비
    maybeRescanShadowRoots();
    currentlyGenerating = detectGenerating(activeSite);
  } catch (_) {
    currentlyGenerating = false;
  }
  // 상태가 변했을 때만 처리 + heartbeat(프레임 합산용)
  let shouldSend = false;
  if (isGenerating !== currentlyGenerating) {
    isGenerating = currentlyGenerating;
    // 요구사항:
    // - 생성 시작: 🟢 -> 🟠
    // - 생성 완료: 🟠 -> ⚪ (탭이 포커스인지 여부와 무관하게 무조건 ⚪)
    // - ⚪ 상태는 "클릭/스크롤"로만 🟢로 돌아간다.
    if (isGenerating) {
      completionStatus = 'idle';
      steeringLastCompletionAt = 0;
      clearSteeringAutoSendTimer();
      clearSteeringSendLock();
      clearSteeringAwaitingResponseStart();
      if (steeringAwaitingTurnCompletion) steeringObservedGenerationSinceSend = true;
    } else {
      completionStatus = 'completed';
      steeringLastCompletionAt = Date.now();
      // Completion may queue/follow up work, but the panel itself only opens via the launcher click.
      const canAdvanceSteeringQueue = !steeringAwaitingTurnCompletion || steeringObservedGenerationSinceSend;
      if (steeringAwaitingTurnCompletion && steeringObservedGenerationSinceSend) {
        clearSteeringTurnCompletionWait();
      }
      if (canAdvanceSteeringQueue) {
        scheduleSteeringQueueProcessing(STEERING_AUTO_SEND_DELAY_MS);
      }
    }
    shouldSend = true;
    ensurePolling(true);
  } else if (!hasSentInitialState) {
    // 초기 1회는 무조건 상태 전송(연두색 뱃지 표시용)
    shouldSend = true;
  } else {
    // frame TTL이 남지 않도록 주기적으로 status를 보내준다(오탐 방지: 5초에 1번)
    const now = Date.now();
    if (!_lastHeartbeatAt || now - _lastHeartbeatAt >= HEARTBEAT_MS) {
      shouldSend = true;
    }
  }
  if (shouldSend) {
    chrome.runtime.sendMessage({
      action: "status_update",
      platform,
      siteName: activeSite.name,
      isGenerating,
    });
    hasSentInitialState = true;
    _lastHeartbeatAt = Date.now();
  }
  // 루프마다 배지 상태 강제 동기화 (사이트가 제목을 바꿔도 다시 덮어씀)
  updateTitleBadge();
  updateSteeringUi();
}
function isEditableInteractionTarget(target) {
  if (!target) return false;
  try {
    if (target.closest?.('textarea, input, [contenteditable="true"], [role="textbox"]')) return true;
  } catch (_) {}
  const tagName = String(target?.tagName || '').toLowerCase();
  if (tagName === 'textarea' || tagName === 'input') return true;
  if (target?.isContentEditable) return true;
  return false;
}
function markTypingAcknowledged(event) {
  if (isSteeringTarget(event?.target)) return;
  if (isComposerAcknowledgeSuppressed()) return;
  if (!isEditableInteractionTarget(event?.target)) return;
  acknowledgeCompletion();
}
// 사용자 상호작용(클릭/스크롤) 시 ⚪ -> 🟢 전환 (요구사항)
