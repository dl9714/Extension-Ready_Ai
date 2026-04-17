function applyDesiredDocumentTitle(force = false) {
  if (!monitoring) return;
  if (!IS_TOP_FRAME) return;
  const currentTitle = String(document.title || '');
  const targetTitle = computeDesiredDocumentTitle(currentTitle);
  if (!force && currentTitle === targetTitle) return;
  titleSyncMuted = true;
  try {
    document.title = targetTitle;
  } catch (_) {}
  if (titleSyncApplyTimer) {
    try { clearTimeout(titleSyncApplyTimer); } catch (_) {}
  }
  titleSyncApplyTimer = setTimeout(() => {
    titleSyncMuted = false;
    titleSyncApplyTimer = null;
  }, 0);
}
function queueDesiredDocumentTitleSync() {
  if (!monitoring) return;
  if (!IS_TOP_FRAME) return;
  Promise.resolve().then(() => applyDesiredDocumentTitle());
}
function ensureTitleSyncObserver() {
  if (!IS_TOP_FRAME) return;
  if (titleSyncObserver) return;
  const target = document.head || document.documentElement;
  if (!target) return;
  titleSyncObserver = new MutationObserver(() => {
    if (titleSyncMuted) return;
    const cleanTitle = getCleanDocumentTitleText();
    if (!hasCustomTabTitle()) {
      const normalizedClean = normalizeCustomTabTitle(cleanTitle);
      const rememberedCustom = normalizeCustomTabTitle(lastCustomTabTitle);
      if (!normalizedClean || normalizedClean !== rememberedCustom) {
        nativePageTitle = cleanTitle || nativePageTitle || activeSite?.name || 'AI';
        if (normalizedClean && normalizedClean !== rememberedCustom) lastCustomTabTitle = '';
      }
      return;
    }
    queueDesiredDocumentTitleSync();
  });
  try {
    titleSyncObserver.observe(target, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  } catch (_) {
    titleSyncObserver = null;
  }
}
function disconnectTitleSyncObserver() {
  if (!titleSyncObserver) return;
  try { titleSyncObserver.disconnect(); } catch (_) {}
  titleSyncObserver = null;
}
function updateTitleBadge() {
  applyDesiredDocumentTitle();
}
function clearTitleBadge() {
  if (!IS_TOP_FRAME) return;
  const cleanTitle = hasCustomTabTitle() ? normalizeCustomTabTitle(customTabTitle) : getDesiredBaseTitle(getCleanDocumentTitleText());
  try { document.title = cleanTitle; } catch (_) {}
}
var STEERING_AUTO_SEND_DELAY_MS = 1000;
var steeringHost = null;
var steeringRoot = null;
var steeringRefs = null;
var steeringPanelOpen = false;
var STEERING_STORAGE_KEYS = Object.freeze({
  ENABLED: 'steeringEnabled',
  THEME: 'steeringTheme',
  LAUNCHER_VISIBLE: 'steeringLauncherVisible',
  AUTO_FOCUS_INPUT: 'steeringAutoFocusInput',
  CLOSE_AFTER_SEND: 'steeringCloseAfterSend',
  QUEUE_COUNT_VISIBLE: 'steeringQueueCountVisible',
  TEMPLATES: 'steeringTemplates',
  ADVANCED_ENABLED: 'steeringAdvancedEnabled',
  NEW_CHAT_TAB_COUNT: 'steeringNewChatTabCount',
});
var TITLE_BADGE_STORAGE_KEYS = Object.freeze({
  ENABLED: 'titleBadgeEnabled',
  COUNT_ENABLED: 'titleBadgeCountEnabled',
});
var CUSTOM_TAB_TITLE_MAX_LENGTH = 80;
var STEERING_THEME = Object.freeze({
  DARK: 'dark',
  LIGHT: 'light',
});
var steeringEnabled = true;
var steeringTheme = STEERING_THEME.DARK;
var steeringLauncherVisible = true;
var steeringAutoFocusInput = true;
var steeringCloseAfterSend = false;
var steeringQueueCountVisible = true;
var steeringTemplates = [];
var steeringAdvancedEnabled = false;
var steeringNewChatTabCount = 3;
var titleBadgeEnabled = true;
var titleBadgeCountEnabled = true;
var customTabTitle = '';
var lastCustomTabTitle = '';
var nativePageTitle = '';
var titleSyncObserver = null;
var titleSyncApplyTimer = null;
var titleSyncMuted = false;
var steeringQueue = [];
var steeringQueueSeq = 1;
var steeringAutoSendTimer = null;
var steeringSendLock = false;
var steeringSendLockTimer = null;
var steeringProcessing = false;
var STEERING_IMAGE_LIMIT = 8;
var STEERING_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
var STEERING_IMAGE_OPTIMIZE_TARGET_BYTES = 6 * 1024 * 1024;
var STEERING_IMAGE_OPTIMIZE_MAX_DIMENSION = 2400;
var steeringAttachments = [];
var steeringAttachmentSeq = 1;
var steeringPreviewAttachmentId = null;
var steeringSuppressAcknowledgeUntil = 0;
var steeringLastReportedQueueCount = null;
var steeringLastCompletionAt = 0;
var steeringAwaitingResponseStart = false;
var steeringAwaitingResponseTimer = null;
var steeringAwaitingTurnCompletion = false;
var steeringObservedGenerationSinceSend = false;
var steeringAttachmentRenderSignature = '';
var steeringQueueRenderSignature = '';
var steeringPreviewRenderSignature = '';
var steeringTemplateRenderSignature = '';
var steeringUiRafId = 0;
var steeringLastPositionSignature = '';
var steeringDraftText = '';
var steeringSessionSiteKey = '';
var steeringQueueEditingId = null;
var steeringQueueEditingText = '';
var steeringDragActive = false;
var steeringDragHideTimer = null;
var steeringDropPointerGuardUntil = 0;
function setSteeringDraftText(value, options = {}) {
  steeringDraftText = String(value || '');
  if (options.syncInput && steeringRefs?.input && String(steeringRefs.input.value || '') !== steeringDraftText) {
    try { steeringRefs.input.value = steeringDraftText; } catch (_) {}
  }
}
function syncSteeringDraftFromInput() {
  setSteeringDraftText(steeringRefs?.input?.value || '');
}
function restoreSteeringDraftToInput() {
  const input = steeringRefs?.input;
  if (!input) return;
  const desired = String(steeringDraftText || '');
  const current = String(input.value || '');
  if (current === desired) return;
  const inputActive = steeringRoot?.activeElement === input;
  if (inputActive && current) return;
  try { input.value = desired; } catch (_) {}
}
function isSteeringTargetNode(target) {
  if (!target) return false;
  if (target === steeringHost) return true;
  try {
    if (steeringHost?.contains?.(target)) return true;
  } catch (_) {}
  try {
    if (target?.getRootNode?.() === steeringRoot) return true;
  } catch (_) {}
  return false;
}
function setSteeringDragActive(active) {
  const next = !!active;
  if (steeringDragHideTimer) {
    try { clearTimeout(steeringDragHideTimer); } catch (_) {}
    steeringDragHideTimer = null;
  }
  if (next) {
    steeringDragActive = true;
    steeringRefs?.attachmentWrap?.classList.add('dragging');
    if (steeringRefs?.dropShield) steeringRefs.dropShield.hidden = false;
    return;
  }
  steeringDragHideTimer = setTimeout(() => {
    steeringDragActive = false;
    steeringRefs?.attachmentWrap?.classList.remove('dragging');
    if (steeringRefs?.dropShield) steeringRefs.dropShield.hidden = true;
    steeringDragHideTimer = null;
  }, 60);
}
function armSteeringDropPointerGuard(duration = 360) {
  steeringDropPointerGuardUntil = Date.now() + Math.max(120, Number(duration) || 0);
}
function suppressFollowupPointerAfterSteeringDrop(event) {
  if (Date.now() > steeringDropPointerGuardUntil) return;
  if (isSteeringTargetNode(event?.target)) return;
  try { event.preventDefault(); } catch (_) {}
  try { event.stopPropagation(); } catch (_) {}
  try { event.stopImmediatePropagation?.(); } catch (_) {}
}
function getSteeringQueueEditingItem() {
  if (steeringQueueEditingId == null) return null;
  return steeringQueue.find((item) => item?.id === steeringQueueEditingId) || null;
}
function beginSteeringQueueEdit(itemId) {
  const item = steeringQueue.find((entry) => entry?.id === itemId);
  if (!item) return false;
  steeringQueueEditingId = item.id;
  steeringQueueEditingText = String(item.text || '');
  updateSteeringUi();
  return true;
}
function syncSteeringQueueEditDraft(value) {
  steeringQueueEditingText = String(value || '');
}
function cancelSteeringQueueEdit(options = {}) {
  const hadEdit = steeringQueueEditingId != null;
  steeringQueueEditingId = null;
  steeringQueueEditingText = '';
  if (hadEdit && !options.silent) updateSteeringUi();
  return hadEdit;
}
function commitSteeringQueueEdit() {
  const item = getSteeringQueueEditingItem();
  if (!item) return false;
  const nextText = String(steeringQueueEditingText || '').trim();
  steeringQueue = steeringQueue.map((entry) => entry?.id === item.id ? { ...entry, text: nextText } : entry);
  cancelSteeringQueueEdit({ silent: true });
  setSteeringStatus(nextText ? '대기를 수정했습니다.' : (getSteeringItemAttachmentCount(item) ? '이미지 대기를 수정했습니다.' : '빈 대기로 변경했습니다.'));
  updateSteeringUi();
  return true;
}
function syncSteeringQueueEditState() {
  if (steeringQueueEditingId == null) return;
  const item = getSteeringQueueEditingItem();
  if (item) return;
  steeringQueueEditingId = null;
  steeringQueueEditingText = '';
}
function resetSteeringSessionState(nextSiteKey = '') {
  steeringQueue = [];
  steeringLastReportedQueueCount = null;
  steeringProcessing = false;
  steeringPanelOpen = false;
  steeringQueueEditingId = null;
  steeringQueueEditingText = '';
  clearSteeringTurnCompletionWait();
  setSteeringDraftText('');
  clearSteeringDraftAttachments({ keepFileInputValue: true });
  try { if (steeringRefs?.input) steeringRefs.input.value = ''; } catch (_) {}
  steeringSessionSiteKey = String(nextSiteKey || '');
}
function suppressComposerAcknowledge(ms = 1200) {
  steeringSuppressAcknowledgeUntil = Date.now() + Math.max(0, ms);
}
function isComposerAcknowledgeSuppressed() {
  return Date.now() < steeringSuppressAcknowledgeUntil;
}
function normalizeSteeringTheme(value) {
  return String(value || '').trim().toLowerCase() === STEERING_THEME.LIGHT ? STEERING_THEME.LIGHT : STEERING_THEME.DARK;
}
function normalizeSteeringNewChatTabCount(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(8, parsed));
}
function truncateSteeringText(value, max = 80) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}
function normalizeSteeringTemplate(item, index = 0) {
  if (typeof item === 'string') {
    const text = String(item || '').trim();
    if (!text) return null;
    return {
      id: `tpl_${index}_${text.slice(0, 16)}`,
      name: truncateSteeringText(`템플릿 ${index + 1}`, 24),
      text,
      tooltip: '',
    };
  }
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text ?? item.content ?? '').trim();
  if (!text) return null;
  return {
    id: String(item.id || `tpl_${index}_${Date.now()}`),
    name: truncateSteeringText(item.name ?? item.title ?? item.label ?? `템플릿 ${index + 1}`, 24),
    text,
    tooltip: truncateSteeringText(item.tooltip ?? item.note ?? item.description ?? '', 160),
  };
}
function normalizeSteeringTemplates(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, index) => normalizeSteeringTemplate(item, index)).filter(Boolean).slice(0, 20);
}
function getSteeringTemplateTooltip(template) {
  const parts = [];
  const name = String(template?.name || '').trim();
  const tooltip = String(template?.tooltip || '').trim();
  const text = String(template?.text || '').trim();
  if (name) parts.push(name);
  if (tooltip) parts.push(tooltip);
  if (text) parts.push(`문구: ${text}`);
  return parts.join('\n');
}
function loadSteeringPrefs(cb) {
  try {
    chrome.storage.local.get([
      STEERING_STORAGE_KEYS.ENABLED,
      STEERING_STORAGE_KEYS.THEME,
      STEERING_STORAGE_KEYS.LAUNCHER_VISIBLE,
      STEERING_STORAGE_KEYS.AUTO_FOCUS_INPUT,
      STEERING_STORAGE_KEYS.CLOSE_AFTER_SEND,
      STEERING_STORAGE_KEYS.QUEUE_COUNT_VISIBLE,
      STEERING_STORAGE_KEYS.TEMPLATES,
      STEERING_STORAGE_KEYS.ADVANCED_ENABLED,
      STEERING_STORAGE_KEYS.NEW_CHAT_TAB_COUNT,
      TITLE_BADGE_STORAGE_KEYS.ENABLED,
      TITLE_BADGE_STORAGE_KEYS.COUNT_ENABLED,
    ], (res) => {
      steeringEnabled = typeof res?.[STEERING_STORAGE_KEYS.ENABLED] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.ENABLED] : true;
      steeringTheme = normalizeSteeringTheme(res?.[STEERING_STORAGE_KEYS.THEME]);
      steeringLauncherVisible = typeof res?.[STEERING_STORAGE_KEYS.LAUNCHER_VISIBLE] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.LAUNCHER_VISIBLE] : true;
      steeringAutoFocusInput = typeof res?.[STEERING_STORAGE_KEYS.AUTO_FOCUS_INPUT] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.AUTO_FOCUS_INPUT] : true;
      steeringCloseAfterSend = typeof res?.[STEERING_STORAGE_KEYS.CLOSE_AFTER_SEND] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.CLOSE_AFTER_SEND] : false;
      steeringQueueCountVisible = typeof res?.[STEERING_STORAGE_KEYS.QUEUE_COUNT_VISIBLE] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.QUEUE_COUNT_VISIBLE] : true;
      steeringTemplates = normalizeSteeringTemplates(res?.[STEERING_STORAGE_KEYS.TEMPLATES]);
      steeringAdvancedEnabled = typeof res?.[STEERING_STORAGE_KEYS.ADVANCED_ENABLED] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.ADVANCED_ENABLED] : false;
      steeringNewChatTabCount = normalizeSteeringNewChatTabCount(res?.[STEERING_STORAGE_KEYS.NEW_CHAT_TAB_COUNT]);
      titleBadgeEnabled = typeof res?.[TITLE_BADGE_STORAGE_KEYS.ENABLED] === 'boolean' ? !!res[TITLE_BADGE_STORAGE_KEYS.ENABLED] : true;
      titleBadgeCountEnabled = typeof res?.[TITLE_BADGE_STORAGE_KEYS.COUNT_ENABLED] === 'boolean' ? !!res[TITLE_BADGE_STORAGE_KEYS.COUNT_ENABLED] : true;
      cb?.();
    });
  } catch (_) {
    steeringEnabled = true;
    steeringTheme = STEERING_THEME.DARK;
    steeringLauncherVisible = true;
    steeringAutoFocusInput = true;
    steeringCloseAfterSend = false;
    steeringQueueCountVisible = true;
    steeringTemplates = [];
    steeringAdvancedEnabled = false;
    steeringNewChatTabCount = 3;
    titleBadgeEnabled = true;
    titleBadgeCountEnabled = true;
    cb?.();
  }
}
