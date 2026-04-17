function $(id) {
  return document.getElementById(id);
}
function setHint(text, isError = false) {
  const el = $('status-hint');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#c83d3d' : '#8a91a1';
}
function getSitesApi() {
  return window?.ReadyAi?.sites;
}
const SOUND_PRESETS = Object.freeze({
  off: 'off',
  soft: 'soft',
  double: 'double',
  triple: 'triple',
  long: 'long',
  custom: 'custom',
});
const MAX_CUSTOM_SOUND_FILE_BYTES = 1024 * 1024 * 2;
const MAX_TEMPLATE_COUNT = 20;
const MAX_TEMPLATE_NAME_LENGTH = 24;
const MAX_TEMPLATE_TOOLTIP_LENGTH = 160;
let runtimeSnapshot = {
  items: [],
  history: [],
  snoozeUntil: 0,
  quietHoursActive: false,
  suppressionReason: '',
};
let dashboardTimer = null;
let dashboardRefreshInFlight = null;
let lastDashboardListSignature = '';
let lastDashboardStatsSignature = '';
let lastHistorySignature = '';
let lastDashboardVersionSeen = 0;
let lastDashboardFetchedAt = 0;
let lastTitleManagerListSignature = '';
const DASHBOARD_META_FORCE_REFRESH_MS = 30000;
let dashboardView = {
  filter: 'ALL',
  sort: 'status',
  search: '',
};
let currentPopupConfig = null;
let pendingConfigSaveTimer = null;
let pendingConfigSavePayload = null;
let pendingConfigSaveSignature = '';
let lastSavedConfigSignature = '';
let pendingConfigSaveCallbacks = [];
let filteredDashboardCacheKey = '';
let filteredDashboardCacheItems = [];
let lastRelativeTimeBucket = -1;
const CONFIG_SAVE_DEBOUNCE_MS = 120;
const DASHBOARD_RELATIVE_TIME_BUCKET_MS = 30000;
const DASHBOARD_SEARCH_DEBOUNCE_MS = 120;
const CUSTOM_TAB_TITLE_MAX_LENGTH = 80;
function soundPresetLabel(soundKey) {
  switch (soundKey) {
    case SOUND_PRESETS.off: return '없음';
    case SOUND_PRESETS.soft: return '기본 1회';
    case SOUND_PRESETS.double: return '기본 2회';
    case SOUND_PRESETS.triple: return '기본 3회';
    case SOUND_PRESETS.long: return '길게 1회';
    case SOUND_PRESETS.custom: return '사용자 파일';
    default: return String(soundKey || '기본 1회');
  }
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
function normalizeSoundKey(soundKey, fallback) {
  const key = String(soundKey || '').trim();
  return Object.prototype.hasOwnProperty.call(SOUND_PRESETS, key) ? key : fallback;
}
function volumeToPercent(volume) {
  return clampInt(Math.round(clampNumber(volume, 0.8, 0, 1) * 100), 80, 0, 100);
}
function percentToVolume(percent) {
  return clampNumber(percent / 100, 0.8, 0, 1);
}
function normalizeSteeringNewChatTabCount(value) {
  return clampInt(value, 3, 1, 8);
}
function normalizeClockTime(value, fallback = '23:00') {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10) || 0));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10) || 0));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function clockTimeToMinutes(value, fallback = 0) {
  const normalized = normalizeClockTime(value, '00:00');
  const [hh, mm] = normalized.split(':').map((v) => parseInt(v, 10) || 0);
  return (hh * 60) + mm;
}
function truncateText(value, max = 80) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}
function buildTemplateId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeTemplateItem(item, index = 0) {
  if (typeof item === 'string') {
    const text = String(item || '').trim();
    if (!text) return null;
    return {
      id: buildTemplateId(),
      name: truncateText(`템플릿 ${index + 1}`, MAX_TEMPLATE_NAME_LENGTH),
      text,
      tooltip: '',
    };
  }
  if (!item || typeof item !== 'object') return null;
  const text = String(item.text ?? item.content ?? '').trim();
  if (!text) return null;
  const rawName = String(item.name ?? item.title ?? item.label ?? '').trim();
  const rawTooltip = String(item.tooltip ?? item.note ?? item.description ?? '').trim();
  return {
    id: String(item.id || buildTemplateId()),
    name: truncateText(rawName || `템플릿 ${index + 1}`, MAX_TEMPLATE_NAME_LENGTH),
    text,
    tooltip: truncateText(rawTooltip, MAX_TEMPLATE_TOOLTIP_LENGTH),
  };
}
function normalizeTemplateList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, index) => normalizeTemplateItem(item, index)).filter(Boolean).slice(0, MAX_TEMPLATE_COUNT);
}
function getTemplateTooltip(template) {
  const parts = [];
  const name = truncateText(template?.name || '', MAX_TEMPLATE_NAME_LENGTH);
  const tooltip = String(template?.tooltip || '').trim();
  const text = String(template?.text || '').trim();
  if (name) parts.push(name);
  if (tooltip) parts.push(tooltip);
  if (text) parts.push(`문구: ${text}`);
  return parts.join('\n');
}
function getTemplatePreview(template) {
  const tooltip = String(template?.tooltip || '').trim();
  if (tooltip) return truncateText(tooltip, 60);
  return truncateText(template?.text || '', 60);
}
function readTemplateEditor() {
  const name = truncateText($('template-name')?.value || '', MAX_TEMPLATE_NAME_LENGTH);
  const text = String($('template-draft')?.value || '').trim();
  const tooltip = truncateText($('template-tooltip')?.value || '', MAX_TEMPLATE_TOOLTIP_LENGTH);
  const editingId = String($('template-editing-id')?.value || '').trim();
  return { id: editingId, name: name || '템플릿', text, tooltip };
}
function setTemplateEditorState(template = null) {
  const editingId = $('template-editing-id');
  const name = $('template-name');
  const draft = $('template-draft');
  const tooltip = $('template-tooltip');
  const label = $('template-editor-mode');
  const cancelBtn = $('cancel-template-edit');
  if (template) {
    if (editingId) editingId.value = String(template.id || '');
    if (name) name.value = String(template.name || '');
    if (draft) draft.value = String(template.text || '');
    if (tooltip) tooltip.value = String(template.tooltip || '');
    if (label) label.textContent = `수정 중 · ${truncateText(template.name || '템플릿', 18)}`;
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    return;
  }
  if (editingId) editingId.value = '';
  if (name) name.value = '';
  if (draft) draft.value = currentPopupConfig?.steeringRecentDraft || '';
  if (tooltip) tooltip.value = '';
  if (label) label.textContent = '새 템플릿';
  if (cancelBtn) cancelBtn.style.display = 'none';
}
function isQuietHoursActiveLocal(cfg, ts = Date.now()) {
  if (!cfg?.quietHoursEnabled) return false;
  const start = clockTimeToMinutes(cfg.quietHoursStart, 23 * 60);
  const end = clockTimeToMinutes(cfg.quietHoursEnd, 8 * 60);
  if (start === end) return true;
  const d = new Date(ts);
  const nowMinutes = (d.getHours() * 60) + d.getMinutes();
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}
function getQuietHoursLabel(cfg) {
  const start = normalizeClockTime(cfg?.quietHoursStart, '23:00');
  const end = normalizeClockTime(cfg?.quietHoursEnd, '08:00');
  return `${start} ~ ${end}`;
}
function getRuntimeSuppressionLabel(cfg) {
  if (cfg?.dndMode) return '방해 금지 중';
  if (runtimeSnapshot.snoozeUntil > Date.now()) return `스누즈 ~ ${formatDateTime(runtimeSnapshot.snoozeUntil)}`;
  if (runtimeSnapshot.quietHoursActive || isQuietHoursActiveLocal(cfg)) return `조용한 시간 ${getQuietHoursLabel(cfg)}`;
  return '알림 활성';
}
function getVisibleDashboardItems() {
  return getFilteredDashboardItems();
}
function getVisibleDashboardLinksText(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const title = item.title || item.siteName || `탭 ${item.tabId}`;
    return `${title}\n${item.url || ''}`.trim();
  }).join('\n\n');
}
function getVisibleDashboardSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const orange = list.filter((item) => item.status === 'ORANGE').length;
  const green = list.filter((item) => item.status === 'GREEN').length;
  const queued = list.reduce((sum, item) => sum + Math.max(0, Number(item.steeringQueueCount) || 0), 0);
  return { total: list.length, orange, green, queued };
}
function buildDashboardListSignature(items, view) {
  const list = Array.isArray(items) ? items : [];
  return JSON.stringify({
    view: { filter: view?.filter || 'ALL', sort: view?.sort || 'status', search: view?.search || '' },
    items: list.map((item) => [item.tabId, item.status, item.title || '', item.host || '', item.siteName || '', item.platform || '', item.lastUpdateAt || 0, item.steeringQueueCount || 0, !!item.active, !!item.discarded, !!item.hasCustomTabTitle, item.customTabTitle || '']),
  });
}
function buildHistorySignature(history) {
  const list = Array.isArray(history) ? history.slice(0, 12) : [];
  return JSON.stringify({
    items: list.map((item) => [item.kind || '', item.at || 0, item.siteName || '', item.peakOrangeCount || 0]),
  });
}
function applyQuickPreset(cfg, preset) {
  const mode = String(preset || '').trim();
  if (mode === 'focus') {
    cfg.dndMode = false;
    cfg.badgeEnabled = true;
    cfg.individualCompletionNotificationEnabled = true;
    cfg.batchCompletionNotificationEnabled = true;
    cfg.individualCompletionSound = SOUND_PRESETS.soft;
    cfg.batchCompletionSound = SOUND_PRESETS.double;
    cfg.individualCompletionVolume = 0.45;
    cfg.batchCompletionVolume = 0.55;
    cfg.batchCompletionThreshold = 4;
    cfg.quietHoursEnabled = true;
    cfg.quietHoursStart = '23:00';
    cfg.quietHoursEnd = '08:00';
  } else if (mode === 'loud') {
    cfg.dndMode = false;
    cfg.badgeEnabled = true;
    cfg.individualCompletionNotificationEnabled = true;
    cfg.batchCompletionNotificationEnabled = true;
    cfg.individualCompletionSound = SOUND_PRESETS.double;
    cfg.batchCompletionSound = SOUND_PRESETS.triple;
    cfg.individualCompletionVolume = 0.8;
    cfg.batchCompletionVolume = 0.95;
    cfg.batchCompletionThreshold = 3;
    cfg.quietHoursEnabled = false;
  } else {
    cfg.dndMode = false;
    cfg.badgeEnabled = true;
    cfg.individualCompletionNotificationEnabled = true;
    cfg.batchCompletionNotificationEnabled = true;
    cfg.individualCompletionSound = SOUND_PRESETS.soft;
    cfg.batchCompletionSound = SOUND_PRESETS.triple;
    cfg.individualCompletionVolume = 0.75;
    cfg.batchCompletionVolume = 0.9;
    cfg.batchCompletionThreshold = 4;
    cfg.quietHoursEnabled = false;
    cfg.quietHoursStart = normalizeClockTime(cfg.quietHoursStart, '23:00');
    cfg.quietHoursEnd = normalizeClockTime(cfg.quietHoursEnd, '08:00');
  }
}
function updateSummaryText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}
function setHidden(id, hidden) {
  const el = $(id);
  if (el) el.classList.toggle('hidden', !!hidden);
}
function getSitesStorageKeys() {
  const sitesApi = getSitesApi();
  return {
    enabledKey: sitesApi?.STORAGE_KEYS?.ENABLED_SITES || 'enabledSites',
    customKey: sitesApi?.STORAGE_KEYS?.CUSTOM_SITES || 'customSites',
  };
}
function buildConfigStoragePayload(cfg) {
  const { enabledKey, customKey } = getSitesStorageKeys();
  return {
    dndMode: !!cfg.dndMode,
    badgeEnabled: !!cfg.badgeEnabled,
    badgeCountEnabled: !!cfg.badgeCountEnabled,
    titleBadgeEnabled: !!cfg.titleBadgeEnabled,
    titleBadgeCountEnabled: !!cfg.titleBadgeCountEnabled,
    completionHistoryEnabled: !!cfg.completionHistoryEnabled,
    dashboardAutoRefreshEnabled: !!cfg.dashboardAutoRefreshEnabled,
    [enabledKey]: cfg.enabledSites,
    [customKey]: cfg.customSites,
    geminiProbeEnabled: !!cfg.geminiProbeEnabled,
    geminiProbePeriodMin: cfg.geminiProbePeriodMin,
    geminiProbeOnlyIdle: !!cfg.geminiProbeOnlyIdle,
    geminiProbeIdleSec: cfg.geminiProbeIdleSec,
    geminiProbeMinOrangeSec: cfg.geminiProbeMinOrangeSec,
    individualCompletionNotificationEnabled: !!cfg.individualCompletionNotificationEnabled,
    individualCompletionSound: normalizeSoundKey(cfg.individualCompletionSound, SOUND_PRESETS.soft),
    individualCompletionVolume: clampNumber(cfg.individualCompletionVolume, 0.75, 0, 1),
    individualCompletionCustomSoundDataUrl: String(cfg.individualCompletionCustomSoundDataUrl || ''),
    individualCompletionCustomSoundName: String(cfg.individualCompletionCustomSoundName || ''),
    batchCompletionNotificationEnabled: !!cfg.batchCompletionNotificationEnabled,
    batchCompletionSound: normalizeSoundKey(cfg.batchCompletionSound, SOUND_PRESETS.triple),
    batchCompletionThreshold: clampInt(cfg.batchCompletionThreshold, 4, 2, 99),
    batchCompletionVolume: clampNumber(cfg.batchCompletionVolume, 0.9, 0, 1),
    batchCompletionCustomSoundDataUrl: String(cfg.batchCompletionCustomSoundDataUrl || ''),
    batchCompletionCustomSoundName: String(cfg.batchCompletionCustomSoundName || ''),
    steeringEnabled: !!cfg.steeringEnabled,
    steeringTheme: String(cfg.steeringTheme || 'dark').trim().toLowerCase() === 'light' ? 'light' : 'dark',
    steeringLauncherVisible: !!cfg.steeringLauncherVisible,
    steeringAutoFocusInput: !!cfg.steeringAutoFocusInput,
    steeringCloseAfterSend: !!cfg.steeringCloseAfterSend,
    steeringQueueCountVisible: !!cfg.steeringQueueCountVisible,
    steeringAdvancedEnabled: !!cfg.steeringAdvancedEnabled,
    steeringNewChatTabCount: normalizeSteeringNewChatTabCount(cfg.steeringNewChatTabCount),
    steeringTemplates: normalizeTemplateList(cfg.steeringTemplates),
    steeringRecentDraft: String(cfg.steeringRecentDraft || ''),
    quietHoursEnabled: !!cfg.quietHoursEnabled,
    quietHoursStart: normalizeClockTime(cfg.quietHoursStart, '23:00'),
    quietHoursEnd: normalizeClockTime(cfg.quietHoursEnd, '08:00'),
  };
}
function flushPendingConfigSave() {
  if (pendingConfigSaveTimer) {
    clearTimeout(pendingConfigSaveTimer);
    pendingConfigSaveTimer = null;
  }
  if (!pendingConfigSavePayload) return;
  const payload = pendingConfigSavePayload;
  const signature = pendingConfigSaveSignature;
  const callbacks = pendingConfigSaveCallbacks.slice();
  pendingConfigSavePayload = null;
  pendingConfigSaveSignature = '';
  pendingConfigSaveCallbacks = [];
  chrome.storage.local.set(payload, () => {
    lastSavedConfigSignature = signature;
    callbacks.forEach((cb) => {
      try { cb?.(); } catch (_) {}
    });
  });
}
function saveConfig(cfg, cb, options = {}) {
  const payload = buildConfigStoragePayload(cfg);
  const signature = JSON.stringify(payload);
  if (!options.force && signature === lastSavedConfigSignature && !pendingConfigSavePayload) {
    cb?.();
    return;
  }
  pendingConfigSavePayload = payload;
  pendingConfigSaveSignature = signature;
  if (typeof cb === 'function') pendingConfigSaveCallbacks.push(cb);
  if (options.flushImmediately) {
    flushPendingConfigSave();
    return;
  }
  if (pendingConfigSaveTimer) clearTimeout(pendingConfigSaveTimer);
  pendingConfigSaveTimer = setTimeout(() => flushPendingConfigSave(), CONFIG_SAVE_DEBOUNCE_MS);
}
function invalidateFilteredDashboardCache() {
  filteredDashboardCacheKey = '';
  filteredDashboardCacheItems = [];
}
function getDashboardRelativeTimeBucket() {
  return Math.floor(Date.now() / DASHBOARD_RELATIVE_TIME_BUCKET_MS);
}
function refreshRelativeTimeLabels(force = false) {
  const bucket = getDashboardRelativeTimeBucket();
  if (!force && bucket === lastRelativeTimeBucket) return;
  lastRelativeTimeBucket = bucket;
  document.querySelectorAll('[data-role="relative-time"]').forEach((el) => {
    const ts = clampInt(el.getAttribute('data-ts'), 0, 0, Number.MAX_SAFE_INTEGER);
    if (!ts) return;
    const mode = el.getAttribute('data-mode') || 'ago';
    if (mode === 'history') {
      el.textContent = `${formatTime(ts)} · ${formatAgo(ts)}`;
      return;
    }
    const prefix = el.getAttribute('data-prefix') || '';
    const suffix = el.getAttribute('data-suffix') || '';
    el.textContent = `${prefix}${formatAgo(ts)}${suffix}`;
  });
}
function loadConfig(cb) {
  const sitesApi = getSitesApi();
  const { enabledKey, customKey } = getSitesStorageKeys();
  chrome.storage.local.get([
    'dndMode',
    'badgeEnabled',
    'badgeCountEnabled',
    'titleBadgeEnabled',
    'titleBadgeCountEnabled',
    'completionHistoryEnabled',
    'dashboardAutoRefreshEnabled',
    'steeringLauncherVisible',
    'steeringAutoFocusInput',
    'steeringCloseAfterSend',
    'steeringQueueCountVisible',
    'steeringAdvancedEnabled',
    'steeringNewChatTabCount',
    enabledKey,
    customKey,
    'geminiProbeEnabled',
    'geminiProbePeriodMin',
    'geminiProbeOnlyIdle',
    'geminiProbeIdleSec',
    'geminiProbeMinOrangeSec',
    'individualCompletionNotificationEnabled',
    'individualCompletionSound',
    'individualCompletionVolume',
    'individualCompletionCustomSoundDataUrl',
    'individualCompletionCustomSoundName',
    'batchCompletionNotificationEnabled',
    'batchCompletionSound',
    'batchCompletionThreshold',
    'batchCompletionVolume',
    'batchCompletionCustomSoundDataUrl',
    'batchCompletionCustomSoundName',
    'steeringEnabled',
    'steeringTheme',
    'steeringTemplates',
    'steeringRecentDraft',
    'quietHoursEnabled',
    'quietHoursStart',
    'quietHoursEnd',
  ], (res) => {
    const enabledSites = sitesApi?.ensureEnabledSitesObject
      ? sitesApi.ensureEnabledSitesObject(res?.[enabledKey])
      : (res?.[enabledKey] || {});
    const customSites = sitesApi?.normalizeCustomSites
      ? sitesApi.normalizeCustomSites(res?.[customKey])
      : (res?.[customKey] || []);
    cb({
      dndMode: !!res.dndMode,
      badgeEnabled: (typeof res.badgeEnabled === 'boolean') ? res.badgeEnabled : true,
      badgeCountEnabled: (typeof res.badgeCountEnabled === 'boolean') ? res.badgeCountEnabled : true,
      titleBadgeEnabled: (typeof res.titleBadgeEnabled === 'boolean') ? res.titleBadgeEnabled : true,
      titleBadgeCountEnabled: (typeof res.titleBadgeCountEnabled === 'boolean') ? res.titleBadgeCountEnabled : true,
      completionHistoryEnabled: (typeof res.completionHistoryEnabled === 'boolean') ? res.completionHistoryEnabled : true,
      dashboardAutoRefreshEnabled: (typeof res.dashboardAutoRefreshEnabled === 'boolean') ? res.dashboardAutoRefreshEnabled : true,
      enabledSites,
      customSites,
      geminiProbeEnabled: (typeof res.geminiProbeEnabled === 'boolean') ? res.geminiProbeEnabled : true,
      geminiProbePeriodMin: (res.geminiProbePeriodMin != null) ? res.geminiProbePeriodMin : 1,
      geminiProbeOnlyIdle: (typeof res.geminiProbeOnlyIdle === 'boolean') ? res.geminiProbeOnlyIdle : true,
      geminiProbeIdleSec: (res.geminiProbeIdleSec != null) ? res.geminiProbeIdleSec : 60,
      geminiProbeMinOrangeSec: (res.geminiProbeMinOrangeSec != null) ? res.geminiProbeMinOrangeSec : 12,
      individualCompletionNotificationEnabled: (typeof res.individualCompletionNotificationEnabled === 'boolean') ? res.individualCompletionNotificationEnabled : true,
      individualCompletionSound: normalizeSoundKey(res.individualCompletionSound, SOUND_PRESETS.soft),
      individualCompletionVolume: clampNumber(res.individualCompletionVolume, 0.75, 0, 1),
      individualCompletionCustomSoundDataUrl: String(res.individualCompletionCustomSoundDataUrl || ''),
      individualCompletionCustomSoundName: String(res.individualCompletionCustomSoundName || ''),
      batchCompletionNotificationEnabled: (typeof res.batchCompletionNotificationEnabled === 'boolean') ? res.batchCompletionNotificationEnabled : true,
      batchCompletionSound: normalizeSoundKey(res.batchCompletionSound, SOUND_PRESETS.triple),
      batchCompletionThreshold: clampInt(res.batchCompletionThreshold, 4, 2, 99),
      batchCompletionVolume: clampNumber(res.batchCompletionVolume, 0.9, 0, 1),
      batchCompletionCustomSoundDataUrl: String(res.batchCompletionCustomSoundDataUrl || ''),
      batchCompletionCustomSoundName: String(res.batchCompletionCustomSoundName || ''),
      steeringEnabled: (typeof res.steeringEnabled === 'boolean') ? res.steeringEnabled : true,
      steeringTheme: String(res.steeringTheme || 'dark').trim().toLowerCase() === 'light' ? 'light' : 'dark',
      steeringLauncherVisible: (typeof res.steeringLauncherVisible === 'boolean') ? res.steeringLauncherVisible : true,
      steeringAutoFocusInput: (typeof res.steeringAutoFocusInput === 'boolean') ? res.steeringAutoFocusInput : true,
      steeringCloseAfterSend: (typeof res.steeringCloseAfterSend === 'boolean') ? res.steeringCloseAfterSend : false,
      steeringQueueCountVisible: (typeof res.steeringQueueCountVisible === 'boolean') ? res.steeringQueueCountVisible : true,
      steeringAdvancedEnabled: (typeof res.steeringAdvancedEnabled === 'boolean') ? res.steeringAdvancedEnabled : false,
      steeringNewChatTabCount: normalizeSteeringNewChatTabCount(res.steeringNewChatTabCount),
      steeringTemplates: normalizeTemplateList(res.steeringTemplates),
      steeringRecentDraft: String(res.steeringRecentDraft || ''),
      quietHoursEnabled: (typeof res.quietHoursEnabled === 'boolean') ? res.quietHoursEnabled : false,
      quietHoursStart: normalizeClockTime(res.quietHoursStart, '23:00'),
      quietHoursEnd: normalizeClockTime(res.quietHoursEnd, '08:00'),
    });
  });
}
function getSoundCfg(cfg, kind) {
  if (kind === 'batch') {
    return {
      enabledKey: 'batchCompletionNotificationEnabled',
      soundKey: 'batchCompletionSound',
      volumeKey: 'batchCompletionVolume',
      customDataKey: 'batchCompletionCustomSoundDataUrl',
      customNameKey: 'batchCompletionCustomSoundName',
    };
  }
  return {
    enabledKey: 'individualCompletionNotificationEnabled',
    soundKey: 'individualCompletionSound',
    volumeKey: 'individualCompletionVolume',
    customDataKey: 'individualCompletionCustomSoundDataUrl',
    customNameKey: 'individualCompletionCustomSoundName',
  };
}
function renderBuiltinSites(cfg) {
  const sitesApi = getSitesApi();
  const container = $('builtin-sites');
  if (!container || !sitesApi?.BUILTIN_SITES) return;
  container.innerHTML = '';
  for (const s of sitesApi.BUILTIN_SITES) {
    const row = document.createElement('div');
    row.className = 'site-row';
    const left = document.createElement('div');
    left.className = 'site-left';
    const name = document.createElement('div');
    name.className = 'site-name';
    name.textContent = s.name;
    const sub = document.createElement('div');
    sub.className = 'site-sub';
    sub.textContent = (s.patterns || []).join(' , ');
    left.appendChild(name);
    left.appendChild(sub);
    const switchWrap = document.createElement('label');
    switchWrap.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!cfg.enabledSites?.[s.key];
    const slider = document.createElement('span');
    slider.className = 'slider';
    input.addEventListener('change', () => {
      cfg.enabledSites[s.key] = input.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
    switchWrap.appendChild(input);
    switchWrap.appendChild(slider);
    row.appendChild(left);
    row.appendChild(switchWrap);
    container.appendChild(row);
  }
}
function renderCustomSites(cfg) {
  const sitesApi = getSitesApi();
  const container = $('custom-sites');
  if (!container || !sitesApi) return;
  container.innerHTML = '';
  const customSites = Array.isArray(cfg.customSites) ? cfg.customSites : [];
  if (!customSites.length) {
    const empty = document.createElement('div');
    empty.className = 'desc';
    empty.textContent = '직접 추가한 사이트가 없습니다.';
    container.appendChild(empty);
    return;
  }
  for (const s of customSites) {
    const row = document.createElement('div');
    row.className = 'site-row';
    const left = document.createElement('div');
    left.className = 'site-left';
    const name = document.createElement('div');
    name.className = 'site-name';
    name.textContent = s.name;
    const modeLabel = sitesApi.DETECTION_MODES?.find((m) => m.key === s.detection)?.label || s.detection;
    const sub = document.createElement('div');
    sub.className = 'site-sub';
    sub.textContent = `${modeLabel} · ${(s.patterns || []).join(' , ')}`;
    left.appendChild(name);
    left.appendChild(sub);
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.alignItems = 'center';
    actions.style.gap = '8px';
    const switchWrap = document.createElement('label');
    switchWrap.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!s.enabled;
    const slider = document.createElement('span');
    slider.className = 'slider';
    input.addEventListener('change', () => {
      s.enabled = input.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
    switchWrap.appendChild(input);
    switchWrap.appendChild(slider);
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = '삭제';
    del.addEventListener('click', () => {
      cfg.customSites = cfg.customSites.filter((x) => x.id !== s.id);
      saveConfig(cfg, () => {
        renderCustomSites(cfg);
        refreshSummary(cfg);
        setHint('삭제됨');
      });
    });
    actions.appendChild(switchWrap);
    actions.appendChild(del);
    row.appendChild(left);
    row.appendChild(actions);
    container.appendChild(row);
  }
}
function renderDetectionOptions() {
  const sitesApi = getSitesApi();
  const select = $('custom-detection');
  if (!select || !sitesApi?.DETECTION_MODES) return;
  select.innerHTML = '';
  for (const mode of sitesApi.DETECTION_MODES) {
    const opt = document.createElement('option');
    opt.value = mode.key;
    opt.textContent = mode.label;
    select.appendChild(opt);
  }
  select.value = 'generic_stop';
}
function formatTime(ts) {
  if (!ts) return '기록 없음';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(ts));
  } catch (_) {
    return new Date(ts).toLocaleTimeString();
  }
}
function formatDateTime(ts) {
  if (!ts) return '해제됨';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch (_) {
    return new Date(ts).toLocaleString();
  }
}
function formatRelativeMs(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  return `${day}일 전`;
}
function formatAgo(ts) {
  if (!ts) return '기록 없음';
  return formatRelativeMs(Date.now() - ts);
}
function statusClass(status) {
  if (status === 'ORANGE') return 'orange';
  if (status === 'GREEN') return 'white';
  return 'green';
}
function statusLabel(status) {
  if (status === 'ORANGE') return '진행중';
  if (status === 'GREEN') return '완료';
  return '대기 없음';
}
function getHostLabel(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return '';
  }
}
function getDraftValue(cfg) {
  const direct = String($('template-draft')?.value || '').trim();
  if (direct) return direct;
  return String(cfg?.steeringRecentDraft || '').trim();
}
function getStatusRank(status) {
  if (status === 'ORANGE') return 3;
  if (status === 'GREEN') return 2;
  return 1;
}
function getFilteredDashboardItems() {
  const search = String(dashboardView.search || '').trim().toLowerCase();
  const cacheKey = JSON.stringify({
    version: lastDashboardVersionSeen || 0,
    filter: dashboardView.filter || 'ALL',
    sort: dashboardView.sort || 'status',
    search,
  });
  if (filteredDashboardCacheKey === cacheKey && Array.isArray(filteredDashboardCacheItems)) {
    return filteredDashboardCacheItems.slice();
  }
  const base = Array.isArray(runtimeSnapshot.items) ? runtimeSnapshot.items.slice() : [];
  const filtered = base.filter((item) => {
    if (dashboardView.filter === 'ORANGE' && item.status !== 'ORANGE') return false;
    if (dashboardView.filter === 'GREEN' && item.status !== 'GREEN') return false;
    if (dashboardView.filter === 'QUEUED' && !(Math.max(0, Number(item.steeringQueueCount) || 0) > 0)) return false;
    if (!search) return true;
    const hay = [item.title, item.siteName, item.host, item.platform, item.url].map((v) => String(v || '').toLowerCase()).join(' ');
    return hay.includes(search);
  });
  filtered.sort((a, b) => {
    const mode = String(dashboardView.sort || 'status');
    if (mode === 'recent') {
      return (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0) || getStatusRank(b.status) - getStatusRank(a.status);
    }
    if (mode === 'queue') {
      return (Math.max(0, Number(b.steeringQueueCount) || 0) - Math.max(0, Number(a.steeringQueueCount) || 0))
        || getStatusRank(b.status) - getStatusRank(a.status)
        || (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0);
    }
    if (mode === 'title') {
      return String(a.title || '').localeCompare(String(b.title || ''), 'ko')
        || getStatusRank(b.status) - getStatusRank(a.status)
        || (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0);
    }
    return getStatusRank(b.status) - getStatusRank(a.status)
      || (Math.max(0, Number(b.steeringQueueCount) || 0) - Math.max(0, Number(a.steeringQueueCount) || 0))
      || (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0);
  });
  filteredDashboardCacheKey = cacheKey;
  filteredDashboardCacheItems = filtered.slice();
  return filtered;
}
function updateDashboardViewUi() {
  const map = {
    'dashboard-filter-all': 'ALL',
    'dashboard-filter-orange': 'ORANGE',
    'dashboard-filter-green': 'GREEN',
    'dashboard-filter-queued': 'QUEUED',
  };
  Object.entries(map).forEach(([id, value]) => {
    const btn = $(id);
    if (btn) btn.classList.toggle('active', dashboardView.filter === value);
  });
  const search = $('dashboard-search');
  if (search && search.value !== String(dashboardView.search || '')) search.value = String(dashboardView.search || '');
  const sort = $('dashboard-sort');
  if (sort && sort.value !== String(dashboardView.sort || 'status')) sort.value = String(dashboardView.sort || 'status');
}
async function copyTextToClipboard(text, successLabel = '복사됨') {
  const value = String(text || '').trim();
  if (!value) {
    setHint('복사할 값이 없음', true);
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    setHint(successLabel);
    return true;
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    setHint(ok ? successLabel : '복사 실패', !ok);
    return !!ok;
  }
}
async function sendSteeringToTab(tabId, text, opts = {}) {
  const value = String(text || '').trim();
  if (!value) {
    setHint('전송할 문구를 먼저 입력해줘', true);
    return false;
  }
  const res = await pSendTabMessage(tabId, { action: 'enqueue_steering_prompt', text: value });
  if (res?.ok) {
    const successText = typeof opts.successText === 'string'
      ? opts.successText
      : `대기 추가됨 (${res.count || 1})`;
    if (successText) setHint(successText);
    return true;
  }
  const err = String(res?.message || res?.error || '이 탭이 지원되지 않음');
  setHint(`${opts.failPrefix || '전송 실패'}: ${err}`, true);
  return false;
}
async function clearSteeringQueueForTab(tabId) {
  const res = await pSendTabMessage(tabId, { action: 'clear_steering_queue' });
  setHint(res?.ok ? '이 탭 대기열 비움' : '이 탭 대기열 비우기 실패', !res?.ok);
  return !!res?.ok;
}
function normalizeCustomTabTitleValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, CUSTOM_TAB_TITLE_MAX_LENGTH);
}
function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || '백그라운드 연결 실패' });
          return;
        }
        resolve(res || { ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || '백그라운드 연결 실패' });
    }
  });
}
async function setCustomTitleForTabId(tabId, title) {
  const value = normalizeCustomTabTitleValue(title);
  if (!value) {
    setHint('탭 이름을 먼저 입력해줘', true);
    return false;
  }
  const res = await sendRuntimeMessage({ action: 'set_custom_tab_title_for_tab', tabId, title: value });
  if (!res?.ok) {
    setHint(res?.message || res?.error || '탭 이름 저장 실패', true);
    return false;
  }
  return true;
}
async function clearCustomTitleForTabId(tabId) {
  const res = await sendRuntimeMessage({ action: 'clear_custom_tab_title_for_tab', tabId });
  if (!res?.ok) {
    setHint(res?.message || res?.error || '탭 이름 해제 실패', true);
    return false;
  }
  return true;
}
async function getActiveBrowserTab() {
  const tabs = await pQueryTabs({ active: true, currentWindow: true });
  return tabs[0] || null;
}
function buildBulkTitleValue(baseTitle, index, numberingEnabled, startNumber) {
  const base = normalizeCustomTabTitleValue(baseTitle);
  if (!base) return '';
  if (!numberingEnabled) return base;
  return normalizeCustomTabTitleValue(`${base} ${startNumber + index}`);
}
async function applyBulkTitleToItems(items, baseTitle, opts = {}) {
  const targets = Array.isArray(items) ? items.filter((item) => Number.isFinite(item?.tabId)) : [];
  if (!targets.length) {
    setHint('적용할 탭이 없음', true);
    return { ok: false, count: 0, total: 0 };
  }
  const base = normalizeCustomTabTitleValue(baseTitle);
  if (!base) {
    setHint('이름을 먼저 입력해줘', true);
    return { ok: false, count: 0, total: targets.length };
  }
  const numberingEnabled = opts.numberingEnabled !== false;
  const startNumber = clampInt(opts.startNumber, 1, 1, 9999);
  const payload = targets.map((item, index) => ({
    tabId: item.tabId,
    title: buildBulkTitleValue(base, index, numberingEnabled, startNumber),
  })).filter((item) => item.title);
  const res = await sendRuntimeMessage({ action: 'batch_set_custom_tab_titles_for_tabs', items: payload });
  if (!res?.ok && !(res && typeof res.count === 'number')) {
    setHint(res?.message || res?.error || '탭 이름 일괄 적용 실패', true);
    return { ok: false, count: 0, total: targets.length };
  }
  return { ok: (res?.count || 0) > 0, count: Math.max(0, Number(res?.count) || 0), total: targets.length };
}
async function clearBulkTitleForItems(items) {
  const targets = Array.isArray(items) ? items.filter((item) => Number.isFinite(item?.tabId)) : [];
  if (!targets.length) {
    setHint('해제할 탭이 없음', true);
    return { ok: false, count: 0, total: 0 };
  }
  const res = await sendRuntimeMessage({
    action: 'batch_clear_custom_tab_titles_for_tabs',
    tabIds: targets.map((item) => item.tabId),
  });
  if (!res?.ok && !(res && typeof res.count === 'number')) {
    setHint(res?.message || res?.error || '탭 이름 일괄 해제 실패', true);
    return { ok: false, count: 0, total: targets.length };
  }
  return { ok: (res?.count || 0) > 0, count: Math.max(0, Number(res?.count) || 0), total: targets.length };
}
async function renderTitleManager(cfg, options = {}) {
  const preserveInput = !!options.preserveInput;
  const activeSummary = $('active-tab-title-summary');
  const activeInput = $('active-tab-title-input');
  const activeSave = $('active-tab-title-save');
  const activeClear = $('active-tab-title-clear');
  const listEl = $('title-manager-list');
  const activeTab = await getActiveBrowserTab();
  const items = Array.isArray(runtimeSnapshot.items) ? runtimeSnapshot.items.slice() : [];
  const activeItem = items.find((item) => item.tabId === activeTab?.id) || null;
  if (activeSummary) {
    if (activeTab?.id) {
      const host = activeItem?.host || getHostLabel(activeTab?.url || '');
      const fixed = normalizeCustomTabTitleValue(activeItem?.customTabTitle || '');
      activeSummary.textContent = `${activeItem?.title || activeTab.title || '현재 탭'} · ${host || 'URL 없음'}${fixed ? ` · 고정됨: ${fixed}` : ' · 자동 제목'}`;
    } else {
      activeSummary.textContent = '현재 탭을 찾지 못했습니다.';
    }
  }
  if (activeInput && !preserveInput) activeInput.value = normalizeCustomTabTitleValue(activeItem?.customTabTitle || '');
  if (activeSave) activeSave.disabled = !activeTab?.id;
  if (activeClear) activeClear.disabled = !activeTab?.id;
  if (!listEl) return;
  const sorted = items.sort((a, b) => {
    const activeRank = (v) => v.active ? 1 : 0;
    const customRank = (v) => v.hasCustomTabTitle ? 1 : 0;
    return activeRank(b) - activeRank(a)
      || customRank(b) - customRank(a)
      || (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0);
  });
  const listSignature = JSON.stringify(sorted.map((item) => [
    item.tabId,
    item.title || '',
    item.status || '',
    item.siteName || '',
    item.platform || '',
    item.host || '',
    item.url || '',
    item.customTabTitle || '',
    !!item.hasCustomTabTitle,
    !!item.active,
    item.lastUpdateAt || 0,
  ]));
  if (lastTitleManagerListSignature === listSignature) return;
  lastTitleManagerListSignature = listSignature;
  listEl.innerHTML = '';
  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.className = 'desc';
    empty.textContent = '현재 추적 중인 탭이 없습니다.';
    listEl.appendChild(empty);
    return;
  }
  sorted.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'title-manager-row';
    const top = document.createElement('div');
    top.className = 'title-manager-top';
    const left = document.createElement('div');
    left.className = 'title-manager-left';
    const title = document.createElement('div');
    title.className = 'title-manager-title';
    title.textContent = item.title || item.siteName || item.host || `탭 ${item.tabId}`;
    const sub = document.createElement('div');
    sub.className = 'title-manager-sub';
    const customText = normalizeCustomTabTitleValue(item.customTabTitle || '');
    sub.textContent = `${statusLabel(item.status)} · ${item.siteName || item.platform || '미확인'} · ${item.host || getHostLabel(item.url) || 'URL 없음'}${customText ? ` · 고정: ${customText}` : ' · 자동 제목'}`;
    left.appendChild(title);
    left.appendChild(sub);
    top.appendChild(left);
    const right = document.createElement('div');
    if (customText) {
      const pin = document.createElement('span');
      pin.className = 'title-badge-pin';
      pin.textContent = '고정';
      right.appendChild(pin);
    } else {
      const state = document.createElement('span');
      state.className = `state-chip ${statusClass(item.status)}`;
      state.textContent = statusLabel(item.status);
      right.appendChild(state);
    }
    top.appendChild(right);
    row.appendChild(top);
    const field = document.createElement('div');
    field.className = 'title-manager-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = CUSTOM_TAB_TITLE_MAX_LENGTH;
    input.value = customText;
    input.placeholder = '이 탭 이름 고정';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn primary';
    saveBtn.type = 'button';
    saveBtn.textContent = '저장';
    saveBtn.addEventListener('click', async () => {
      const ok = await setCustomTitleForTabId(item.tabId, input.value);
      if (ok) {
        setHint(`탭 이름 저장됨: ${normalizeCustomTabTitleValue(input.value)}`);
        lastTitleManagerListSignature = '';
        await refreshRuntimeDashboard(cfg, true, { force: true });
        renderTitleManager(cfg);
      }
    });
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn';
    clearBtn.type = 'button';
    clearBtn.textContent = '해제';
    clearBtn.addEventListener('click', async () => {
      const ok = await clearCustomTitleForTabId(item.tabId);
      if (ok) {
        setHint('탭 이름 고정 해제됨');
        lastTitleManagerListSignature = '';
        await refreshRuntimeDashboard(cfg, true, { force: true });
        renderTitleManager(cfg);
      }
    });
    field.appendChild(input);
    field.appendChild(saveBtn);
    field.appendChild(clearBtn);
    row.appendChild(field);
    const chips = document.createElement('div');
    chips.className = 'title-chip-row';
    ['작업', '확인', '보류', '중요'].forEach((preset) => {
      const btn = document.createElement('button');
      btn.className = 'title-chip-btn';
      btn.type = 'button';
      btn.textContent = preset;
      btn.addEventListener('click', async () => {
        const ok = await setCustomTitleForTabId(item.tabId, preset);
        if (ok) {
          setHint(`탭 이름 저장됨: ${preset}`);
          lastTitleManagerListSignature = '';
          await refreshRuntimeDashboard(cfg, true, { force: true });
          renderTitleManager(cfg);
        }
      });
      chips.appendChild(btn);
    });
    const openBtn = document.createElement('button');
    openBtn.className = 'title-chip-btn';
    openBtn.type = 'button';
    openBtn.textContent = '탭 열기';
    openBtn.addEventListener('click', () => focusTab(item.tabId, item.windowId));
    chips.appendChild(openBtn);
    row.appendChild(chips);
    listEl.appendChild(row);
  });
}
async function focusNextGreenTab() {
  const items = (Array.isArray(runtimeSnapshot.items) ? runtimeSnapshot.items.slice() : [])
    .filter((item) => item.status === 'GREEN')
    .sort((a, b) => (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0));
  if (!items.length) {
    setHint('열 수 있는 완료 탭이 없음', true);
    return false;
  }
  await focusTab(items[0].tabId, items[0].windowId);
  setHint('다음 완료 탭으로 이동');
  return true;
}
async function sendSteeringToItems(items, text, label) {
  const value = String(text || '').trim();
  const targets = Array.isArray(items) ? items.filter((item) => typeof item?.tabId === 'number') : [];
  if (!value) {
    setHint('전송할 문구를 먼저 입력해줘', true);
    return { ok: false, successCount: 0, failCount: targets.length };
  }
  if (!targets.length) {
    setHint(`${label} 대상이 없음`, true);
    return { ok: false, successCount: 0, failCount: 0 };
  }
  let successCount = 0;
  let failCount = 0;
  for (const item of targets) {
    const ok = await sendSteeringToTab(item.tabId, value, { successText: '' , failPrefix: `${item.title || item.siteName || '탭'} 전송 실패`});
    if (ok) successCount += 1;
    else failCount += 1;
  }
  setHint(`${label}: ${successCount}개 성공${failCount ? ` · ${failCount}개 실패` : ''}`, failCount > 0 && successCount === 0);
  return { ok: successCount > 0, successCount, failCount };
}
function refreshSummary(cfg) {
  const sitesApi = getSitesApi();
  const builtinSites = Array.isArray(sitesApi?.BUILTIN_SITES) ? sitesApi.BUILTIN_SITES : [];
  const builtinEnabledCount = builtinSites.filter((s) => !!cfg.enabledSites?.[s.key]).length;
  const customSites = Array.isArray(cfg.customSites) ? cfg.customSites : [];
  const customEnabledCount = customSites.filter((s) => !!s.enabled).length;
  const orangeCount = runtimeSnapshot.items.filter((item) => item.status === 'ORANGE').length;
  const greenCount = runtimeSnapshot.items.filter((item) => item.status === 'GREEN').length;
  const queueCount = runtimeSnapshot.items.reduce((sum, item) => sum + Math.max(0, Number(item.steeringQueueCount) || 0), 0);
  const trackedCount = runtimeSnapshot.items.length;
  const templateCount = (cfg.steeringTemplates || []).length;
  const alertEnabled = cfg.individualCompletionNotificationEnabled || cfg.batchCompletionNotificationEnabled;
  const snoozed = runtimeSnapshot.snoozeUntil > Date.now();
  const quiet = isQuietHoursActiveLocal(cfg);
  const mainStatus = cfg.dndMode
    ? '방해 금지'
    : (snoozed ? '스누즈 중' : (quiet ? '조용한 시간' : (greenCount > 0 ? '완료 감지' : (orangeCount > 0 ? '감시 중' : '대기 중'))));
  updateSummaryText('main-status-badge', mainStatus);
  updateSummaryText('main-stat-tracked', String(trackedCount));
  updateSummaryText('main-stat-orange', String(orangeCount));
  updateSummaryText('main-stat-green', String(greenCount));
  updateSummaryText('main-stat-queue', String(queueCount));
  updateSummaryText('main-chip-alert', alertEnabled ? `알림 ${soundPresetLabel(cfg.individualCompletionSound)}` : '알림 꺼짐');
  updateSummaryText('main-chip-site', `사이트 ${builtinEnabledCount + customEnabledCount}`);
  updateSummaryText('main-chip-template', `템플릿 ${templateCount}`);
  updateSummaryText('main-chip-quiet', snoozed ? '스누즈 적용' : (cfg.quietHoursEnabled ? getQuietHoursLabel(cfg) : '조용한 시간 꺼짐'));
  updateSummaryText('quick-dnd-sub', cfg.dndMode ? '완료 팝업 숨김' : '완료 팝업 표시');
  updateSummaryText('quick-steering-sub', cfg.steeringEnabled ? (cfg.steeringAdvancedEnabled ? `새 채팅 ${normalizeSteeringNewChatTabCount(cfg.steeringNewChatTabCount)}탭` : `${cfg.steeringTheme === 'light' ? '라이트' : '다크'} 패널`) : '런처 꺼짐');
  updateSummaryText('quick-quiet-sub', cfg.quietHoursEnabled ? `${getQuietHoursLabel(cfg)}${quiet ? ' · 지금 적용' : ''}` : '사용 안 함');
  const quickDnd = $('quick-dnd-toggle');
  if (quickDnd && quickDnd.checked !== !!cfg.dndMode) quickDnd.checked = !!cfg.dndMode;
  const quickSteering = $('quick-steering-toggle');
  if (quickSteering && quickSteering.checked !== !!cfg.steeringEnabled) quickSteering.checked = !!cfg.steeringEnabled;
  const steeringAdvancedToggle = $('steering-advanced-toggle');
  if (steeringAdvancedToggle && steeringAdvancedToggle.checked !== !!cfg.steeringAdvancedEnabled) steeringAdvancedToggle.checked = !!cfg.steeringAdvancedEnabled;
  const steeringNewChatCount = $('steering-new-chat-count');
  const normalizedNewChatCount = String(normalizeSteeringNewChatTabCount(cfg.steeringNewChatTabCount));
  if (steeringNewChatCount && steeringNewChatCount.value !== normalizedNewChatCount) steeringNewChatCount.value = normalizedNewChatCount;
  const quickQuiet = $('quick-quiet-toggle');
  if (quickQuiet && quickQuiet.checked !== !!cfg.quietHoursEnabled) quickQuiet.checked = !!cfg.quietHoursEnabled;
  const advancedToggleMap = {
    'advanced-steering-enabled': !!cfg.steeringEnabled,
    'advanced-steering-launcher-visible': !!cfg.steeringLauncherVisible,
    'advanced-steering-auto-focus': !!cfg.steeringAutoFocusInput,
    'advanced-steering-close-after-send': !!cfg.steeringCloseAfterSend,
    'advanced-steering-count-visible': !!cfg.steeringQueueCountVisible,
    'advanced-steering-advanced-enabled': !!cfg.steeringAdvancedEnabled,
    'advanced-badge-enabled': !!cfg.badgeEnabled,
    'advanced-badge-count-enabled': !!cfg.badgeCountEnabled,
    'advanced-title-badge-enabled': !!cfg.titleBadgeEnabled,
    'advanced-title-badge-count-enabled': !!cfg.titleBadgeCountEnabled,
    'advanced-history-enabled': !!cfg.completionHistoryEnabled,
    'advanced-dashboard-auto-refresh': !!cfg.dashboardAutoRefreshEnabled,
  };
  Object.entries(advancedToggleMap).forEach(([id, value]) => {
    const el = $(id);
    if (el && el.checked !== value) el.checked = value;
  });
  const advancedSummary = $('advanced-settings-summary');
  if (advancedSummary) {
    const parts = [];
    parts.push(cfg.steeringLauncherVisible ? '후속 지시 버튼 표시' : '후속 지시 버튼 숨김');
    parts.push(cfg.steeringAdvancedEnabled ? `고급 새 채팅 ${normalizeSteeringNewChatTabCount(cfg.steeringNewChatTabCount)}탭` : '기본 후속 지시');
    parts.push(cfg.badgeEnabled ? (cfg.badgeCountEnabled ? '배지 숫자 켜짐' : '배지 숫자 꺼짐') : '배지 꺼짐');
    parts.push(cfg.titleBadgeEnabled ? (cfg.titleBadgeCountEnabled ? '탭 제목 숫자 켜짐' : '탭 제목 숫자 꺼짐') : '탭 제목 표시 꺼짐');
    parts.push(cfg.completionHistoryEnabled ? '완료 이력 저장' : '완료 이력 저장 안 함');
    parts.push(cfg.dashboardAutoRefreshEnabled ? '팝업 자동 새로고침' : '수동 새로고침');
    advancedSummary.textContent = parts.join(' · ');
  }
  setHidden('history-divider', !cfg.completionHistoryEnabled);
  setHidden('history-title', !cfg.completionHistoryEnabled);
  setHidden('completion-history', !cfg.completionHistoryEnabled);
}
function openSheet(sheetId) {
  document.querySelectorAll('.sheet.active').forEach((el) => el.classList.remove('active'));
  const target = $(sheetId);
  if (target) {
    target.classList.add('active');
    const scroller = target.querySelector('.sheet-scroll');
    if (scroller) scroller.scrollTop = 0;
  }
  if (sheetId === 'title-manager-sheet' && currentPopupConfig) {
    refreshRuntimeDashboard(currentPopupConfig, true, { force: true }).then(() => {
      renderTitleManager(currentPopupConfig, { preserveInput: false });
    }).catch(() => {
      renderTitleManager(currentPopupConfig, { preserveInput: false });
    });
  }
}
function closeSheets() {
  document.querySelectorAll('.sheet.active').forEach((el) => el.classList.remove('active'));
}
function wireSheetNavigation() {
  document.querySelectorAll('[data-open-sheet]').forEach((btn) => {
    btn.addEventListener('click', () => openSheet(btn.getAttribute('data-open-sheet')));
  });
  document.querySelectorAll('[data-close-sheet]').forEach((btn) => {
    btn.addEventListener('click', () => closeSheets());
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheets();
  });
}
function updateVolumeLabel(kind, volume) {
  const el = $(`${kind}-volume-label`);
  if (el) el.textContent = `${volumeToPercent(volume)}%`;
}
function updateCustomSoundUi(cfg, kind) {
  const map = getSoundCfg(cfg, kind);
  const select = $(`${kind}-sound`);
  const fileInfo = $(`${kind}-custom-file-info`);
  const clearBtn = $(`${kind}-custom-clear`);
  const uploadRow = $(`${kind}-custom-upload-row`);
  const hasCustom = !!cfg[map.customDataKey];
  if (fileInfo) fileInfo.textContent = hasCustom ? `파일: ${cfg[map.customNameKey] || '사용자 파일'}` : '파일 없음';
  if (clearBtn) clearBtn.disabled = !hasCustom;
  if (uploadRow) uploadRow.classList.toggle('hidden', normalizeSoundKey(select?.value, cfg[map.soundKey]) !== SOUND_PRESETS.custom);
}
function sendSoundTest(cfg, kind) {
  const map = getSoundCfg(cfg, kind);
  const soundKey = normalizeSoundKey(cfg[map.soundKey], SOUND_PRESETS.soft);
  chrome.runtime.sendMessage({
    action: 'test_alert_sound',
    kind,
    soundKey,
    volume: clampNumber(cfg[map.volumeKey], 0.8, 0, 1),
    customSoundDataUrl: String(cfg[map.customDataKey] || ''),
  }, (res) => {
    if (chrome.runtime.lastError) {
      setHint('알림음 테스트 실패: 백그라운드 연결 오류', true);
      return;
    }
    if (res?.ok) {
      setHint('알림음 테스트 재생');
    } else if (soundKey === SOUND_PRESETS.custom && !cfg[map.customDataKey]) {
      setHint('사용자 지정 파일을 먼저 넣어줘', true);
    } else {
      setHint('알림음 재생 실패', true);
    }
  });
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}
function wireSoundSection(cfg, kind) {
  const map = getSoundCfg(cfg, kind);
  const toggle = $(`${kind}-alert-toggle`);
  const soundSelect = $(`${kind}-sound`);
  const volumeRange = $(`${kind}-volume`);
  const thresholdInput = $('batch-threshold');
  const testBtn = $(`${kind}-sound-test`);
  const fileInput = $(`${kind}-custom-file`);
  const clearBtn = $(`${kind}-custom-clear`);
  if (toggle) {
    toggle.checked = !!cfg[map.enabledKey];
    toggle.addEventListener('change', () => {
      cfg[map.enabledKey] = !!toggle.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (soundSelect) {
    soundSelect.value = normalizeSoundKey(cfg[map.soundKey], SOUND_PRESETS.soft);
    soundSelect.addEventListener('change', () => {
      cfg[map.soundKey] = normalizeSoundKey(soundSelect.value, SOUND_PRESETS.soft);
      updateCustomSoundUi(cfg, kind);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (volumeRange) {
    volumeRange.value = String(volumeToPercent(cfg[map.volumeKey]));
    updateVolumeLabel(kind, cfg[map.volumeKey]);
    volumeRange.addEventListener('input', () => {
      cfg[map.volumeKey] = percentToVolume(clampInt(volumeRange.value, 80, 0, 100));
      updateVolumeLabel(kind, cfg[map.volumeKey]);
    });
    volumeRange.addEventListener('change', () => {
      cfg[map.volumeKey] = percentToVolume(clampInt(volumeRange.value, 80, 0, 100));
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (kind === 'batch' && thresholdInput) {
    thresholdInput.value = String(cfg.batchCompletionThreshold ?? 4);
    thresholdInput.addEventListener('change', () => {
      cfg.batchCompletionThreshold = clampInt(thresholdInput.value, 4, 2, 99);
      thresholdInput.value = String(cfg.batchCompletionThreshold);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (testBtn) {
    testBtn.addEventListener('click', () => sendSoundTest(cfg, kind));
  }
  if (fileInput) {
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_CUSTOM_SOUND_FILE_BYTES) {
        setHint('사운드 파일은 2MB 이하로 넣어줘', true);
        fileInput.value = '';
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        cfg[map.customDataKey] = dataUrl;
        cfg[map.customNameKey] = file.name || '사용자 파일';
        cfg[map.soundKey] = SOUND_PRESETS.custom;
        if (soundSelect) soundSelect.value = SOUND_PRESETS.custom;
        updateCustomSoundUi(cfg, kind);
        saveConfig(cfg, () => {
          refreshSummary(cfg);
          setHint('사용자 지정 알림음 저장됨');
        });
      } catch (_) {
        setHint('파일 읽기 실패', true);
      } finally {
        fileInput.value = '';
      }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      cfg[map.customDataKey] = '';
      cfg[map.customNameKey] = '';
      if (cfg[map.soundKey] === SOUND_PRESETS.custom) {
        cfg[map.soundKey] = kind === 'batch' ? SOUND_PRESETS.triple : SOUND_PRESETS.soft;
        if (soundSelect) soundSelect.value = cfg[map.soundKey];
      }
      updateCustomSoundUi(cfg, kind);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('사용자 지정 알림음 삭제됨');
      });
    });
  }
  updateCustomSoundUi(cfg, kind);
}
function pQueryTabs(query) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query(query, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    } catch (_) {
      resolve([]);
    }
  });
}
function pSendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || '메시지 전송 실패' });
          return;
        }
        resolve(res || { ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || '메시지 전송 실패' });
    }
  });
}
function pUpdateTab(tabId, props) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.update(tabId, props, (tab) => resolve(tab || null));
    } catch (_) {
      resolve(null);
    }
  });
}
function pUpdateWindow(windowId, props) {
  return new Promise((resolve) => {
    try {
      chrome.windows.update(windowId, props, (win) => resolve(win || null));
    } catch (_) {
      resolve(null);
    }
  });
}
function requestDashboardMeta() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'get_dashboard_meta' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, version: 0, itemsCount: 0, hasOrange: false, hasGreen: false });
        return;
      }
      resolve(res?.ok ? res : { ok: false, version: 0, itemsCount: 0, hasOrange: false, hasGreen: false });
    });
  });
}
function requestDashboard() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'get_dashboard' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, items: [], history: [], snoozeUntil: 0, version: 0 });
        return;
      }
      resolve(res?.ok ? res : { ok: false, items: [], history: [], snoozeUntil: 0, version: 0 });
    });
  });
}
async function focusTab(tabId, windowId) {
  await pUpdateTab(tabId, { active: true });
  if (typeof windowId === 'number') await pUpdateWindow(windowId, { focused: true });
}
async function sendSteeringToActiveTab(text) {
  const tabs = await pQueryTabs({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    setHint('현재 활성 탭을 찾지 못함', true);
    return false;
  }
  return sendSteeringToTab(tab.id, text, { successText: '현재 탭에 대기 추가됨' });
}
async function fillPatternFromCurrentTab() {
  const tabs = await pQueryTabs({ active: true, currentWindow: true });
  const tab = tabs[0];
  const url = String(tab?.url || '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    setHint('현재 탭 URL에서 패턴을 만들 수 없음', true);
    return;
  }
  try {
    const parsed = new URL(url);
    $('custom-name').value = $('custom-name').value || (parsed.hostname.replace(/^www\./, '') || 'My AI 서비스');
    $('custom-patterns').value = `${parsed.origin}/*`;
    setHint('현재 탭 기준으로 패턴 채움');
  } catch (_) {
    setHint('현재 탭 URL 해석 실패', true);
  }
}
function renderHistory(history) {
  const container = $('completion-history');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(history) || !history.length) {
    const empty = document.createElement('div');
    empty.className = 'desc';
    empty.textContent = '최근 완료 이력이 없습니다.';
    container.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  history.slice(0, 12).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-row';
    const top = document.createElement('div');
    top.className = 'history-top';
    const left = document.createElement('div');
    left.className = 'history-left';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = item.kind === 'batch'
      ? `일괄 완료 · ${item.peakOrangeCount || 0}개`
      : (item.siteName || 'AI 답변 완료');
    const sub = document.createElement('div');
    sub.className = 'history-sub';
    sub.setAttribute('data-role', 'relative-time');
    sub.setAttribute('data-mode', 'history');
    sub.setAttribute('data-ts', String(item.at || 0));
    sub.textContent = `${formatTime(item.at)} · ${formatAgo(item.at)}`;
    left.appendChild(title);
    left.appendChild(sub);
    top.appendChild(left);
    row.appendChild(top);
    frag.appendChild(row);
  });
  container.appendChild(frag);
}
function renderDashboardData(data, cfg) {
  runtimeSnapshot = {
    items: Array.isArray(data?.items) ? data.items : [],
    history: Array.isArray(data?.history) ? data.history : [],
    snoozeUntil: clampInt(data?.snoozeUntil, 0, 0, Number.MAX_SAFE_INTEGER),
    quietHoursActive: !!data?.quietHoursActive,
    suppressionReason: String(data?.suppressionReason || ''),
  };
  invalidateFilteredDashboardCache();
  lastDashboardVersionSeen = clampInt(data?.version, lastDashboardVersionSeen || 0, 0, Number.MAX_SAFE_INTEGER);
  lastDashboardFetchedAt = Date.now();
  updateDashboardViewUi();
  const visibleItems = getFilteredDashboardItems();
  const listSignature = buildDashboardListSignature(visibleItems, dashboardView);
  const historySignature = buildHistorySignature(runtimeSnapshot.history);
  if (lastDashboardListSignature !== listSignature) {
    lastDashboardListSignature = listSignature;
    const container = $('dashboard-list');
    if (container) {
      container.innerHTML = '';
      if (!visibleItems.length) {
        const empty = document.createElement('div');
        empty.className = 'desc';
        empty.textContent = runtimeSnapshot.items.length ? '필터 조건에 맞는 탭이 없습니다.' : '현재 추적 중인 탭이 없습니다.';
        container.appendChild(empty);
      } else {
        const frag = document.createDocumentFragment();
        visibleItems.forEach((item) => {
          const row = document.createElement('div');
          row.className = 'dash-row';
          const top = document.createElement('div');
          top.className = 'dash-top';
          const left = document.createElement('div');
          left.className = 'dash-left';
          const title = document.createElement('div');
          title.className = 'dash-title';
          title.textContent = item.title || item.siteName || getHostLabel(item.url) || `탭 ${item.tabId}`;
          const sub = document.createElement('div');
          sub.className = 'dash-sub';
          const queueLabel = item.steeringQueueCount ? ` · 대기열 ${item.steeringQueueCount}` : '';
          const pinLabel = item.hasCustomTabTitle ? ` · 고정: ${item.customTabTitle}` : '';
          sub.setAttribute('data-role', 'relative-time');
          sub.setAttribute('data-mode', 'dashboard');
          sub.setAttribute('data-ts', String(item.lastUpdateAt || 0));
          sub.setAttribute('data-prefix', `${item.siteName || item.platform || '미확인'} · ${item.host || getHostLabel(item.url) || 'URL 없음'} · `);
          sub.setAttribute('data-suffix', `${queueLabel}${pinLabel}`);
          sub.textContent = `${item.siteName || item.platform || '미확인'} · ${item.host || getHostLabel(item.url) || 'URL 없음'} · ${formatAgo(item.lastUpdateAt)}${queueLabel}${pinLabel}`;
          left.appendChild(title);
          left.appendChild(sub);
          const state = document.createElement('span');
          state.className = `state-chip ${statusClass(item.status)}`;
          state.textContent = statusLabel(item.status);
          top.appendChild(left);
          top.appendChild(state);
          row.appendChild(top);
          const actions = document.createElement('div');
          actions.className = 'dash-actions';
          const openBtn = document.createElement('button');
          openBtn.className = 'btn primary';
          openBtn.type = 'button';
          openBtn.textContent = '탭 열기';
          openBtn.addEventListener('click', () => focusTab(item.tabId, item.windowId));
          const forceBtn = document.createElement('button');
          forceBtn.className = 'btn';
          forceBtn.type = 'button';
          forceBtn.textContent = '강제 확인';
          forceBtn.addEventListener('click', async () => {
            const res = await pSendTabMessage(item.tabId, { action: 'force_check', reason: 'popup_dashboard' });
            setHint(res?.ok ? '강제 확인 요청 전송' : '강제 확인 요청 실패', !res?.ok);
          });
          const sendBtn = document.createElement('button');
          sendBtn.className = 'btn';
          sendBtn.type = 'button';
          sendBtn.textContent = '이 탭 전송';
          sendBtn.addEventListener('click', async () => {
            const ok = await sendSteeringToTab(item.tabId, getDraftValue(cfg), { successText: '이 탭에 대기 추가됨' });
            if (ok) refreshRuntimeDashboard(cfg, true);
          });
          const clearBtn = document.createElement('button');
          clearBtn.className = 'btn';
          clearBtn.type = 'button';
          clearBtn.textContent = '대기열 비우기';
          clearBtn.addEventListener('click', async () => {
            const ok = await clearSteeringQueueForTab(item.tabId);
            if (ok) refreshRuntimeDashboard(cfg, true);
          });
          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn';
          copyBtn.type = 'button';
          copyBtn.textContent = '링크 복사';
          copyBtn.addEventListener('click', () => copyTextToClipboard(item.url, '탭 링크 복사됨'));
          const pinBtn = document.createElement('button');
          pinBtn.className = 'btn';
          pinBtn.type = 'button';
          pinBtn.textContent = item.hasCustomTabTitle ? '이름 해제' : '기본 이름 고정';
          pinBtn.addEventListener('click', async () => {
            if (item.hasCustomTabTitle) {
              const ok = await clearCustomTitleForTabId(item.tabId);
              if (ok) {
                await refreshRuntimeDashboard(cfg, true, { force: true });
                if ($('title-manager-sheet')?.classList.contains('active')) renderTitleManager(cfg);
              }
              return;
            }
            const fallbackTitle = normalizeCustomTabTitleValue(item.siteName || item.platform || item.host || item.title || `탭 ${item.tabId}`);
            const ok = await setCustomTitleForTabId(item.tabId, fallbackTitle);
            if (ok) {
              await refreshRuntimeDashboard(cfg, true, { force: true });
              if ($('title-manager-sheet')?.classList.contains('active')) renderTitleManager(cfg);
            }
          });
          actions.appendChild(openBtn);
          actions.appendChild(forceBtn);
          actions.appendChild(sendBtn);
          actions.appendChild(clearBtn);
          actions.appendChild(copyBtn);
          actions.appendChild(pinBtn);
          row.appendChild(actions);
          frag.appendChild(row);
        });
        container.appendChild(frag);
      }
    }
  }
  const visibleSummary = getVisibleDashboardSummary(visibleItems);
  const statsSignature = JSON.stringify({
    visibleSummary,
    totalOrange: runtimeSnapshot.items.filter((item) => item.status === 'ORANGE').length,
    totalGreen: runtimeSnapshot.items.filter((item) => item.status === 'GREEN').length,
    totalQueue: runtimeSnapshot.items.reduce((sum, item) => sum + Math.max(0, Number(item.steeringQueueCount) || 0), 0),
    snoozeUntil: runtimeSnapshot.snoozeUntil,
    quietHoursActive: runtimeSnapshot.quietHoursActive,
    suppressionReason: runtimeSnapshot.suppressionReason,
    quietHoursEnabled: !!cfg.quietHoursEnabled,
    quietHoursStart: cfg.quietHoursStart,
    quietHoursEnd: cfg.quietHoursEnd,
    dndMode: !!cfg.dndMode,
  });
  if (lastDashboardStatsSignature !== statsSignature) {
    lastDashboardStatsSignature = statsSignature;
    const bulkStatus = $('dashboard-bulk-status');
    if (bulkStatus) bulkStatus.textContent = `현재 필터 기준 ${visibleSummary.total}개 · 진행중 ${visibleSummary.orange} · 완료 ${visibleSummary.green} · 대기열 ${visibleSummary.queued}`;
    const visibleCount = $('dashboard-visible-count');
    if (visibleCount) visibleCount.textContent = `표시 ${visibleItems.length}`;
    const orangeCount = $('dashboard-orange-count');
    if (orangeCount) orangeCount.textContent = `진행중 ${runtimeSnapshot.items.filter((item) => item.status === 'ORANGE').length}`;
    const greenCount = $('dashboard-green-count');
    if (greenCount) greenCount.textContent = `완료 ${runtimeSnapshot.items.filter((item) => item.status === 'GREEN').length}`;
    const queueCount = $('dashboard-queue-count');
    if (queueCount) queueCount.textContent = `대기열 ${runtimeSnapshot.items.reduce((sum, item) => sum + Math.max(0, Number(item.steeringQueueCount) || 0), 0)}`;
    const snoozeStatus = $('snooze-status');
    if (snoozeStatus) snoozeStatus.textContent = getRuntimeSuppressionLabel(cfg);
    const quietStatus = $('quiet-hours-status');
    if (quietStatus) {
      quietStatus.textContent = cfg.quietHoursEnabled
        ? `${getQuietHoursLabel(cfg)} · ${isQuietHoursActiveLocal(cfg) ? '지금 적용 중' : '대기 중'}`
        : '사용 안 함';
    }
  }
  if (cfg.completionHistoryEnabled) {
    if (lastHistorySignature !== historySignature) {
      lastHistorySignature = historySignature;
      renderHistory(runtimeSnapshot.history);
    }
  } else {
    lastHistorySignature = '';
    const historyContainer = $('completion-history');
    if (historyContainer) historyContainer.innerHTML = '';
  }
  refreshRelativeTimeLabels(true);
  refreshSummary(cfg);
}
async function refreshRuntimeDashboard(cfg, silent = false, options = {}) {
  if (options?.fromAutoPoll && cfg?.dashboardAutoRefreshEnabled === false) {
    return Promise.resolve({ ok: true, skipped: true, reason: 'auto_refresh_disabled' });
  }
  if (dashboardRefreshInFlight) return dashboardRefreshInFlight;
  dashboardRefreshInFlight = (async () => {
    try {
      const force = !!options.force;
      let shouldFetchFull = force;
      let meta = null;
      if (!shouldFetchFull) {
        meta = await requestDashboardMeta();
        if (!meta?.ok) {
          shouldFetchFull = true;
        } else if (meta.version !== lastDashboardVersionSeen) {
          shouldFetchFull = true;
        } else if ((Date.now() - lastDashboardFetchedAt) >= DASHBOARD_META_FORCE_REFRESH_MS) {
          shouldFetchFull = true;
        }
      }
      if (!shouldFetchFull) {
        refreshRelativeTimeLabels();
        return { ok: true, skipped: true, version: meta?.version || lastDashboardVersionSeen };
      }
      const data = await requestDashboard();
      renderDashboardData(data, cfg);
      if (!silent && !data?.ok) setHint('실시간 상태를 일부 불러오지 못함', true);
      return data;
    } finally {
      dashboardRefreshInFlight = null;
    }
  })();
  return dashboardRefreshInFlight;
}
function renderTemplates(cfg) {
  const draft = $('template-draft');
  if (draft && draft.value !== cfg.steeringRecentDraft) draft.value = cfg.steeringRecentDraft || '';
  const container = $('templates-list');
  if (!container) return;
  const normalized = normalizeTemplateList(cfg.steeringTemplates);
  if (JSON.stringify(normalized) !== JSON.stringify(cfg.steeringTemplates || [])) cfg.steeringTemplates = normalized;
  container.innerHTML = '';
  const templates = normalized;
  if (!templates.length) {
    const empty = document.createElement('div');
    empty.className = 'desc';
    empty.textContent = '저장된 대기 템플릿이 없습니다.';
    container.appendChild(empty);
    return;
  }
  templates.forEach((template, index) => {
    const row = document.createElement('div');
    row.className = 'template-row';
    row.title = getTemplateTooltip(template);
    const top = document.createElement('div');
    top.className = 'template-top';
    const left = document.createElement('div');
    left.className = 'template-left';
    const title = document.createElement('div');
    title.className = 'template-title';
    title.textContent = template.name || `템플릿 ${index + 1}`;
    const sub = document.createElement('div');
    sub.className = 'template-sub';
    sub.textContent = getTemplatePreview(template);
    left.appendChild(title);
    left.appendChild(sub);
    if (template.tooltip) {
      const note = document.createElement('div');
      note.className = 'template-note';
      note.textContent = `툴팁: ${truncateText(template.tooltip, 90)}`;
      left.appendChild(note);
    }
    const promptLine = document.createElement('div');
    promptLine.className = 'template-prompt';
    promptLine.textContent = truncateText(template.text, 120);
    left.appendChild(promptLine);
    top.appendChild(left);
    row.appendChild(top);
    const actions = document.createElement('div');
    actions.className = 'template-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.type = 'button';
    editBtn.textContent = '수정';
    editBtn.addEventListener('click', () => {
      setTemplateEditorState(template);
      cfg.steeringRecentDraft = template.text;
      saveConfig(cfg, () => {
        renderTemplates(cfg);
        setHint('템플릿 수정 모드로 불러옴');
      });
    });
    const fillBtn = document.createElement('button');
    fillBtn.className = 'btn';
    fillBtn.type = 'button';
    fillBtn.textContent = '입력칸 채우기';
    fillBtn.addEventListener('click', () => {
      cfg.steeringRecentDraft = template.text;
      saveConfig(cfg, () => {
        const editor = $('template-draft');
        if (editor) editor.value = template.text;
        setHint('입력칸에 템플릿 채움');
      });
    });
    const sendBtn = document.createElement('button');
    sendBtn.className = 'btn primary';
    sendBtn.type = 'button';
    sendBtn.textContent = '현재 탭 전송';
    sendBtn.addEventListener('click', async () => {
      const ok = await sendSteeringToActiveTab(template.text);
      if (ok) refreshRuntimeDashboard(cfg, true);
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.type = 'button';
    delBtn.textContent = '삭제';
    delBtn.addEventListener('click', () => {
      cfg.steeringTemplates = normalizeTemplateList((cfg.steeringTemplates || []).filter((item) => String(item?.id || '') !== template.id));
      if (String($('template-editing-id')?.value || '') === template.id) setTemplateEditorState(null);
      saveConfig(cfg, () => {
        renderTemplates(cfg);
        refreshSummary(cfg);
        setHint('템플릿 삭제됨');
      });
    });
    actions.appendChild(editBtn);
    actions.appendChild(fillBtn);
    actions.appendChild(sendBtn);
    actions.appendChild(delBtn);
    row.appendChild(actions);
    container.appendChild(row);
  });
}
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportSettings() {
  chrome.storage.local.get(null, (all) => {
    downloadJson(`ready_ai_settings_${Date.now()}.json`, all || {});
    setHint('설정 내보내기 완료');
  });
}
async function importSettingsFile(cfg) {
  const file = $('import-settings-file')?.files?.[0];
  if (!file) {
    setHint('가져올 JSON 파일을 먼저 골라줘', true);
    return;
  }
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setHint('JSON 형식이 올바르지 않음', true);
      return;
    }
    chrome.storage.local.set(parsed, () => {
      if (chrome.runtime.lastError) {
        setHint('설정 가져오기 실패', true);
        return;
      }
      loadConfig((newCfg) => {
        Object.keys(cfg).forEach((key) => delete cfg[key]);
        Object.assign(cfg, newCfg);
        renderBuiltinSites(cfg);
        renderCustomSites(cfg);
        renderTemplates(cfg);
        refreshRuntimeDashboard(cfg, true);
        refreshSummary(cfg);
        if (cfg.dashboardAutoRefreshEnabled) startDashboardPolling(cfg); else stopDashboardPolling();
        setHint('설정 가져오기 완료');
      });
    });
  } catch (_) {
    setHint('설정 파일 읽기 또는 해석 실패', true);
  } finally {
    const input = $('import-settings-file');
    if (input) input.value = '';
  }
}
function setSnoozeUntil(ts, cfg) {
  chrome.storage.local.set({ notificationSnoozeUntil: ts }, () => {
    runtimeSnapshot.snoozeUntil = ts;
    refreshSummary(cfg);
    const snoozeStatus = $('snooze-status');
    if (snoozeStatus) {
      snoozeStatus.textContent = ts > Date.now()
        ? `현재 ${formatDateTime(ts)}까지 알림 중지`
        : '현재 알림 중지 없음';
    }
    setHint(ts > Date.now() ? '알림 잠시 끄기 적용됨' : '알림 잠시 끄기 해제됨');
  });
}
function wireActions(cfg) {
  const dndToggle = $('dnd-toggle');
  if (dndToggle) {
    dndToggle.checked = !!cfg.dndMode;
    dndToggle.addEventListener('change', () => {
      cfg.dndMode = dndToggle.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  const quickDndToggle = $('quick-dnd-toggle');
  if (quickDndToggle) {
    quickDndToggle.checked = !!cfg.dndMode;
    quickDndToggle.addEventListener('change', () => {
      cfg.dndMode = !!quickDndToggle.checked;
      if (dndToggle) dndToggle.checked = cfg.dndMode;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        refreshRuntimeDashboard(cfg, true);
        setHint('저장됨');
      });
    });
  }
  const badgeToggle = $('badge-toggle');
  if (badgeToggle) {
    badgeToggle.checked = !!cfg.badgeEnabled;
    badgeToggle.addEventListener('change', () => {
      cfg.badgeEnabled = !!badgeToggle.checked;
      if ($('advanced-badge-enabled')) $('advanced-badge-enabled').checked = cfg.badgeEnabled;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  const steeringToggle = $('steering-toggle');
  const steeringTheme = $('steering-theme');
  const steeringAdvancedToggle = $('steering-advanced-toggle');
  const steeringNewChatCount = $('steering-new-chat-count');
  if (steeringToggle) {
    steeringToggle.checked = !!cfg.steeringEnabled;
    steeringToggle.addEventListener('change', () => {
      cfg.steeringEnabled = !!steeringToggle.checked;
      if ($('advanced-steering-enabled')) $('advanced-steering-enabled').checked = cfg.steeringEnabled;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  const quickSteeringToggle = $('quick-steering-toggle');
  if (quickSteeringToggle) {
    quickSteeringToggle.checked = !!cfg.steeringEnabled;
    quickSteeringToggle.addEventListener('change', () => {
      cfg.steeringEnabled = !!quickSteeringToggle.checked;
      if (steeringToggle) steeringToggle.checked = cfg.steeringEnabled;
      if ($('advanced-steering-enabled')) $('advanced-steering-enabled').checked = cfg.steeringEnabled;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (steeringTheme) {
    steeringTheme.value = String(cfg.steeringTheme || 'dark').trim().toLowerCase() === 'light' ? 'light' : 'dark';
    steeringTheme.addEventListener('change', () => {
      cfg.steeringTheme = steeringTheme.value === 'light' ? 'light' : 'dark';
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (steeringAdvancedToggle) {
    steeringAdvancedToggle.checked = !!cfg.steeringAdvancedEnabled;
    steeringAdvancedToggle.addEventListener('change', () => {
      cfg.steeringAdvancedEnabled = !!steeringAdvancedToggle.checked;
      if ($('advanced-steering-advanced-enabled')) $('advanced-steering-advanced-enabled').checked = cfg.steeringAdvancedEnabled;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (steeringNewChatCount) {
    steeringNewChatCount.value = String(normalizeSteeringNewChatTabCount(cfg.steeringNewChatTabCount));
    steeringNewChatCount.addEventListener('change', () => {
      cfg.steeringNewChatTabCount = normalizeSteeringNewChatTabCount(steeringNewChatCount.value);
      steeringNewChatCount.value = String(cfg.steeringNewChatTabCount);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  const bindAdvancedToggle = (id, key, options = {}) => {
    const el = $(id);
    if (!el) return;
    el.checked = !!cfg[key];
    el.addEventListener('change', () => {
      cfg[key] = !!el.checked;
      if (options.syncMainBadgeToggle && $('badge-toggle')) $('badge-toggle').checked = !!cfg[key];
      if (options.syncMainSteeringToggle && $('steering-toggle')) $('steering-toggle').checked = !!cfg[key];
      if (options.syncQuickSteeringToggle && $('quick-steering-toggle')) $('quick-steering-toggle').checked = !!cfg[key];
      if (options.syncMainSteeringAdvancedToggle && $('steering-advanced-toggle')) $('steering-advanced-toggle').checked = !!cfg[key];
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        refreshRuntimeDashboard(cfg, true);
        if (key === 'dashboardAutoRefreshEnabled') {
          if (cfg.dashboardAutoRefreshEnabled) startDashboardPolling(cfg);
          else stopDashboardPolling();
        }
        setHint('저장됨');
      });
    });
  };
  bindAdvancedToggle('advanced-steering-enabled', 'steeringEnabled', { syncMainSteeringToggle: true, syncQuickSteeringToggle: true });
  bindAdvancedToggle('advanced-steering-launcher-visible', 'steeringLauncherVisible');
  bindAdvancedToggle('advanced-steering-auto-focus', 'steeringAutoFocusInput');
  bindAdvancedToggle('advanced-steering-close-after-send', 'steeringCloseAfterSend');
  bindAdvancedToggle('advanced-steering-count-visible', 'steeringQueueCountVisible');
  bindAdvancedToggle('advanced-steering-advanced-enabled', 'steeringAdvancedEnabled', { syncMainSteeringAdvancedToggle: true });
  bindAdvancedToggle('advanced-badge-enabled', 'badgeEnabled', { syncMainBadgeToggle: true });
  bindAdvancedToggle('advanced-badge-count-enabled', 'badgeCountEnabled');
  bindAdvancedToggle('advanced-title-badge-enabled', 'titleBadgeEnabled');
  bindAdvancedToggle('advanced-title-badge-count-enabled', 'titleBadgeCountEnabled');
  bindAdvancedToggle('advanced-history-enabled', 'completionHistoryEnabled');
  bindAdvancedToggle('advanced-dashboard-auto-refresh', 'dashboardAutoRefreshEnabled');
  const probeToggle = $('gemini-probe-toggle');
  const probePeriod = $('gemini-probe-period');
  const probeIdleToggle = $('gemini-probe-idle-toggle');
  const probeIdleSec = $('gemini-probe-idle-sec');
  const probeMinOrangeSec = $('gemini-probe-min-orange-sec');
  if (probeToggle) {
    probeToggle.checked = !!cfg.geminiProbeEnabled;
    probeToggle.addEventListener('change', () => {
      cfg.geminiProbeEnabled = !!probeToggle.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (probePeriod) {
    probePeriod.value = String(cfg.geminiProbePeriodMin ?? 1);
    probePeriod.addEventListener('change', () => {
      cfg.geminiProbePeriodMin = clampNumber(probePeriod.value, 1, 1, 60);
      probePeriod.value = String(cfg.geminiProbePeriodMin);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (probeIdleToggle) {
    probeIdleToggle.checked = !!cfg.geminiProbeOnlyIdle;
    probeIdleToggle.addEventListener('change', () => {
      cfg.geminiProbeOnlyIdle = !!probeIdleToggle.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (probeIdleSec) {
    probeIdleSec.value = String(cfg.geminiProbeIdleSec ?? 60);
    probeIdleSec.addEventListener('change', () => {
      cfg.geminiProbeIdleSec = clampInt(probeIdleSec.value, 60, 15, 3600);
      probeIdleSec.value = String(cfg.geminiProbeIdleSec);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  if (probeMinOrangeSec) {
    probeMinOrangeSec.value = String(cfg.geminiProbeMinOrangeSec ?? 12);
    probeMinOrangeSec.addEventListener('change', () => {
      cfg.geminiProbeMinOrangeSec = clampInt(probeMinOrangeSec.value, 12, 3, 600);
      probeMinOrangeSec.value = String(cfg.geminiProbeMinOrangeSec);
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  wireSoundSection(cfg, 'individual');
  wireSoundSection(cfg, 'batch');
  $('add-custom')?.addEventListener('click', () => {
    const sitesApi = getSitesApi();
    if (!sitesApi) return;
    const name = String($('custom-name').value || '').trim();
    const rawPatterns = $('custom-patterns').value;
    const patterns = sitesApi.normalizePatterns(rawPatterns);
    const detection = String($('custom-detection').value || 'generic_stop').trim();
    if (!name) {
      setHint('이름을 입력해줘', true);
      return;
    }
    if (!patterns.length) {
      setHint('URL 패턴을 1개 이상 입력해줘', true);
      return;
    }
    const bad = patterns.find((p) => !sitesApi.isProbablyValidMatchPattern(p));
    if (bad) {
      setHint(`URL 패턴 형식이 이상함: ${bad}`, true);
      return;
    }
    const id = sitesApi.makeCustomId();
    cfg.customSites = [...(cfg.customSites || []), { id, name, patterns, detection, enabled: true }];
    saveConfig(cfg, () => {
      $('custom-name').value = '';
      $('custom-patterns').value = '';
      $('custom-detection').value = 'generic_stop';
      renderCustomSites(cfg);
      refreshSummary(cfg);
      setHint('추가됨');
    });
  });
  $('fill-current-pattern')?.addEventListener('click', () => fillPatternFromCurrentTab());
  $('reset-defaults')?.addEventListener('click', () => {
    chrome.storage.local.clear(() => {
      setHint('전체 설정 초기화됨');
      setTimeout(() => window.location.reload(), 200);
    });
  });
const draft = $('template-draft');
const templateName = $('template-name');
const templateTooltip = $('template-tooltip');
setTemplateEditorState(null);
if (draft) {
  draft.value = cfg.steeringRecentDraft || '';
  draft.addEventListener('input', () => {
    cfg.steeringRecentDraft = draft.value;
  });
  draft.addEventListener('change', () => {
    cfg.steeringRecentDraft = draft.value;
    saveConfig(cfg, () => {});
  });
}
templateName?.addEventListener('input', () => {
  if (templateName.value.length > MAX_TEMPLATE_NAME_LENGTH) templateName.value = templateName.value.slice(0, MAX_TEMPLATE_NAME_LENGTH);
});
templateTooltip?.addEventListener('input', () => {
  if (templateTooltip.value.length > MAX_TEMPLATE_TOOLTIP_LENGTH) templateTooltip.value = templateTooltip.value.slice(0, MAX_TEMPLATE_TOOLTIP_LENGTH);
});
$('clear-template-draft')?.addEventListener('click', () => {
  cfg.steeringRecentDraft = '';
  setTemplateEditorState(null);
  saveConfig(cfg, () => setHint('입력칸 비움'));
});
$('cancel-template-edit')?.addEventListener('click', () => {
  setTemplateEditorState(null);
  setHint('템플릿 수정 취소');
});
$('save-template')?.addEventListener('click', () => {
  const payload = readTemplateEditor();
  if (!payload.text) {
    setHint('저장할 문구를 먼저 입력해줘', true);
    return;
  }
  const current = normalizeTemplateList(cfg.steeringTemplates);
  const nextTemplate = {
    id: payload.id || buildTemplateId(),
    name: payload.name || `템플릿 ${current.length + 1}`,
    text: payload.text,
    tooltip: payload.tooltip,
  };
  const next = [];
  let updated = false;
  current.forEach((item) => {
    if (item.id === nextTemplate.id) {
      next.push(nextTemplate);
      updated = true;
    } else {
      next.push(item);
    }
  });
  if (!updated) next.unshift(nextTemplate);
  cfg.steeringTemplates = normalizeTemplateList(next).slice(0, MAX_TEMPLATE_COUNT);
  cfg.steeringRecentDraft = payload.text;
  saveConfig(cfg, () => {
    setTemplateEditorState(null);
    renderTemplates(cfg);
    refreshSummary(cfg);
    setHint(updated ? '템플릿 수정됨' : '템플릿 저장됨');
  });
});
  $('send-template-now')?.addEventListener('click', async () => {
    const value = String(draft?.value || '').trim();
    if (!value) {
      setHint('전송할 문구를 먼저 입력해줘', true);
      return;
    }
    cfg.steeringRecentDraft = value;
    saveConfig(cfg, async () => {
      const ok = await sendSteeringToActiveTab(value);
      if (ok) refreshRuntimeDashboard(cfg, true);
    });
  });
  $('send-template-completed')?.addEventListener('click', async () => {
    const value = getDraftValue(cfg);
    if (!value) {
      setHint('전송할 문구를 먼저 입력해줘', true);
      return;
    }
    cfg.steeringRecentDraft = value;
    saveConfig(cfg, async () => {
      await refreshRuntimeDashboard(cfg, true);
      const targets = runtimeSnapshot.items.filter((item) => item.status === 'GREEN');
      const result = await sendSteeringToItems(targets, value, '완료 탭 전송');
      if (result.ok) refreshRuntimeDashboard(cfg, true);
    });
  });
  $('send-template-orange')?.addEventListener('click', async () => {
    const value = getDraftValue(cfg);
    if (!value) {
      setHint('전송할 문구를 먼저 입력해줘', true);
      return;
    }
    cfg.steeringRecentDraft = value;
    saveConfig(cfg, async () => {
      await refreshRuntimeDashboard(cfg, true);
      const targets = runtimeSnapshot.items.filter((item) => item.status === 'ORANGE');
      const result = await sendSteeringToItems(targets, value, '진행중 탭 전송');
      if (result.ok) refreshRuntimeDashboard(cfg, true);
    });
  });
  $('send-template-tracked')?.addEventListener('click', async () => {
    const value = getDraftValue(cfg);
    if (!value) {
      setHint('전송할 문구를 먼저 입력해줘', true);
      return;
    }
    cfg.steeringRecentDraft = value;
    saveConfig(cfg, async () => {
      await refreshRuntimeDashboard(cfg, true);
      const result = await sendSteeringToItems(runtimeSnapshot.items, value, '추적 탭 전송');
      if (result.ok) refreshRuntimeDashboard(cfg, true);
    });
  });
  $('refresh-dashboard')?.addEventListener('click', () => refreshRuntimeDashboard(cfg));
  $('focus-next-green')?.addEventListener('click', async () => {
    const ok = await focusNextGreenTab();
    if (ok) refreshRuntimeDashboard(cfg, true);
  });
  const filterButtons = {
    'dashboard-filter-all': 'ALL',
    'dashboard-filter-orange': 'ORANGE',
    'dashboard-filter-green': 'GREEN',
    'dashboard-filter-queued': 'QUEUED',
  };
  Object.entries(filterButtons).forEach(([id, value]) => {
    $(id)?.addEventListener('click', () => {
      dashboardView.filter = value;
      updateDashboardViewUi();
      renderDashboardData(runtimeSnapshot, cfg);
    });
  });
  let dashboardSearchTimer = null;
  $('dashboard-search')?.addEventListener('input', () => {
    const nextValue = String($('dashboard-search')?.value || '');
    if (dashboardSearchTimer) clearTimeout(dashboardSearchTimer);
    dashboardSearchTimer = setTimeout(() => {
      dashboardView.search = nextValue;
      renderDashboardData(runtimeSnapshot, cfg);
    }, DASHBOARD_SEARCH_DEBOUNCE_MS);
  });
  $('dashboard-sort')?.addEventListener('change', () => {
    dashboardView.sort = String($('dashboard-sort')?.value || 'status');
    renderDashboardData(runtimeSnapshot, cfg);
  });
  $('dashboard-send-visible')?.addEventListener('click', async () => {
    const value = getDraftValue(cfg);
    if (!value) {
      setHint('전송할 문구를 먼저 입력해줘', true);
      return;
    }
    await refreshRuntimeDashboard(cfg, true);
    const visible = getVisibleDashboardItems();
    const result = await sendSteeringToItems(visible, value, '표시 탭 전송');
    if (result.ok) refreshRuntimeDashboard(cfg, true);
  });
  $('dashboard-clear-visible')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true);
    const targets = getVisibleDashboardItems().filter((item) => Math.max(0, Number(item.steeringQueueCount) || 0) > 0);
    if (!targets.length) {
      setHint('비울 대기열이 없음', true);
      return;
    }
    let okCount = 0;
    for (const item of targets) {
      const ok = await clearSteeringQueueForTab(item.tabId);
      if (ok) okCount += 1;
    }
    setHint(`표시 탭 대기열 비움: ${okCount}/${targets.length}`);
    refreshRuntimeDashboard(cfg, true);
  });
  $('dashboard-copy-visible-links')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true);
    const visible = getVisibleDashboardItems();
    if (!visible.length) {
      setHint('복사할 표시 탭이 없음', true);
      return;
    }
    copyTextToClipboard(getVisibleDashboardLinksText(visible), '표시 탭 링크 복사됨');
  });
  $('dashboard-export-snapshot')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true);
    const visible = getVisibleDashboardItems();
    downloadJson(`ready_ai_dashboard_snapshot_${Date.now()}.json`, {
      exportedAt: Date.now(),
      filter: dashboardView.filter,
      sort: dashboardView.sort,
      search: dashboardView.search,
      visibleSummary: getVisibleDashboardSummary(visible),
      items: visible,
    });
    setHint('대시보드 스냅샷 내보내기 완료');
  });
  $('apply-preset-default')?.addEventListener('click', () => {
    applyQuickPreset(cfg, 'default');
    saveConfig(cfg, () => {
      renderTemplates(cfg);
      refreshSummary(cfg);
      refreshRuntimeDashboard(cfg, true);
      setHint('기본 프리셋 적용');
    });
  });
  $('apply-preset-focus')?.addEventListener('click', () => {
    applyQuickPreset(cfg, 'focus');
    saveConfig(cfg, () => {
      renderTemplates(cfg);
      refreshSummary(cfg);
      refreshRuntimeDashboard(cfg, true);
      setHint('집중 프리셋 적용');
    });
  });
  $('apply-preset-loud')?.addEventListener('click', () => {
    applyQuickPreset(cfg, 'loud');
    saveConfig(cfg, () => {
      renderTemplates(cfg);
      refreshSummary(cfg);
      refreshRuntimeDashboard(cfg, true);
      setHint('강한 알림 프리셋 적용');
    });
  });
  const quietToggle = $('quiet-hours-toggle');
  const quietStart = $('quiet-hours-start');
  const quietEnd = $('quiet-hours-end');
  if (quietToggle) {
    quietToggle.checked = !!cfg.quietHoursEnabled;
    quietToggle.addEventListener('change', () => {
      cfg.quietHoursEnabled = !!quietToggle.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        refreshRuntimeDashboard(cfg, true);
        setHint('저장됨');
      });
    });
  }
  const quickQuietToggle = $('quick-quiet-toggle');
  if (quickQuietToggle) {
    quickQuietToggle.checked = !!cfg.quietHoursEnabled;
    quickQuietToggle.addEventListener('change', () => {
      cfg.quietHoursEnabled = !!quickQuietToggle.checked;
      if (quietToggle) quietToggle.checked = cfg.quietHoursEnabled;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        refreshRuntimeDashboard(cfg, true);
        setHint('저장됨');
      });
    });
  }
  if (quietStart) {
    quietStart.value = normalizeClockTime(cfg.quietHoursStart, '23:00');
    quietStart.addEventListener('change', () => {
      cfg.quietHoursStart = normalizeClockTime(quietStart.value, '23:00');
      quietStart.value = cfg.quietHoursStart;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        refreshRuntimeDashboard(cfg, true);
        setHint('저장됨');
      });
    });
  }
  if (quietEnd) {
    quietEnd.value = normalizeClockTime(cfg.quietHoursEnd, '08:00');
    quietEnd.addEventListener('change', () => {
      cfg.quietHoursEnd = normalizeClockTime(quietEnd.value, '08:00');
      quietEnd.value = cfg.quietHoursEnd;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        refreshRuntimeDashboard(cfg, true);
        setHint('저장됨');
      });
    });
  }
  $('force-check-active')?.addEventListener('click', async () => {
    const tabs = await pQueryTabs({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) {
      setHint('현재 활성 탭을 찾지 못함', true);
      return;
    }
    const res = await pSendTabMessage(tab.id, { action: 'force_check', reason: 'popup_active' });
    setHint(res?.ok ? '현재 탭 강제 확인 요청 전송' : '현재 탭 강제 확인 실패', !res?.ok);
  });
  $('snooze-15m')?.addEventListener('click', () => setSnoozeUntil(Date.now() + 15 * 60 * 1000, cfg));
  $('snooze-1h')?.addEventListener('click', () => setSnoozeUntil(Date.now() + 60 * 60 * 1000, cfg));
  $('snooze-clear')?.addEventListener('click', () => setSnoozeUntil(0, cfg));
  $('export-settings')?.addEventListener('click', () => exportSettings());
  $('import-settings')?.addEventListener('click', () => importSettingsFile(cfg));
  $('export-history')?.addEventListener('click', () => {
    downloadJson(`ready_ai_history_${Date.now()}.json`, runtimeSnapshot.history || []);
    setHint('완료 이력 내보내기 완료');
  });
  $('clear-history')?.addEventListener('click', () => {
    chrome.storage.local.set({ completionHistory: [] }, () => {
      runtimeSnapshot.history = [];
      lastHistorySignature = '';
      renderHistory([]);
      refreshSummary(cfg);
      setHint('완료 이력 비움');
    });
  });
  $('active-tab-title-save')?.addEventListener('click', async () => {
    const activeTab = await getActiveBrowserTab();
    if (!activeTab?.id) {
      setHint('현재 탭을 찾지 못함', true);
      return;
    }
    const ok = await setCustomTitleForTabId(activeTab.id, $('active-tab-title-input')?.value || '');
    if (ok) {
      await refreshRuntimeDashboard(cfg, true, { force: true });
      renderTitleManager(cfg);
    }
  });
  $('active-tab-title-clear')?.addEventListener('click', async () => {
    const activeTab = await getActiveBrowserTab();
    if (!activeTab?.id) {
      setHint('현재 탭을 찾지 못함', true);
      return;
    }
    const ok = await clearCustomTitleForTabId(activeTab.id);
    if (ok) {
      await refreshRuntimeDashboard(cfg, true, { force: true });
      renderTitleManager(cfg);
    }
  });
  $('active-tab-title-refresh')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true, { force: true });
    renderTitleManager(cfg);
    setHint('현재 탭 이름 정보 새로 불러옴');
  });
  document.querySelectorAll('[data-active-title-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $('active-tab-title-input');
      if (input) input.value = normalizeCustomTabTitleValue(btn.getAttribute('data-active-title-preset') || '');
    });
  });
  $('bulk-title-apply-visible')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true, { force: true });
    const base = $('bulk-title-base')?.value || '';
    const numberingEnabled = !!$('bulk-title-numbering')?.checked;
    const startNumber = clampInt($('bulk-title-start')?.value, 1, 1, 9999);
    const result = await applyBulkTitleToItems(getVisibleDashboardItems(), base, { numberingEnabled, startNumber });
    if (result.ok) {
      setHint(`표시 탭 이름 적용: ${result.count}/${result.total}`);
      await refreshRuntimeDashboard(cfg, true, { force: true });
      if ($('title-manager-sheet')?.classList.contains('active')) renderTitleManager(cfg);
    }
  });
  $('bulk-title-apply-orange')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true, { force: true });
    const base = $('bulk-title-base')?.value || '';
    const numberingEnabled = !!$('bulk-title-numbering')?.checked;
    const startNumber = clampInt($('bulk-title-start')?.value, 1, 1, 9999);
    const targets = runtimeSnapshot.items.filter((item) => item.status === 'ORANGE');
    const result = await applyBulkTitleToItems(targets, base, { numberingEnabled, startNumber });
    if (result.ok) {
      setHint(`진행중 탭 이름 적용: ${result.count}/${result.total}`);
      await refreshRuntimeDashboard(cfg, true, { force: true });
      if ($('title-manager-sheet')?.classList.contains('active')) renderTitleManager(cfg);
    }
  });
  $('bulk-title-apply-green')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true, { force: true });
    const base = $('bulk-title-base')?.value || '';
    const numberingEnabled = !!$('bulk-title-numbering')?.checked;
    const startNumber = clampInt($('bulk-title-start')?.value, 1, 1, 9999);
    const targets = runtimeSnapshot.items.filter((item) => item.status === 'GREEN');
    const result = await applyBulkTitleToItems(targets, base, { numberingEnabled, startNumber });
    if (result.ok) {
      setHint(`완료 탭 이름 적용: ${result.count}/${result.total}`);
      await refreshRuntimeDashboard(cfg, true, { force: true });
      if ($('title-manager-sheet')?.classList.contains('active')) renderTitleManager(cfg);
    }
  });
  $('bulk-title-clear-visible')?.addEventListener('click', async () => {
    await refreshRuntimeDashboard(cfg, true, { force: true });
    const result = await clearBulkTitleForItems(getVisibleDashboardItems().filter((item) => item.hasCustomTabTitle));
    if (result.ok) {
      setHint(`표시 탭 이름 해제: ${result.count}/${result.total}`);
      await refreshRuntimeDashboard(cfg, true, { force: true });
      if ($('title-manager-sheet')?.classList.contains('active')) renderTitleManager(cfg);
    }
  });
}
function getDashboardPollMs() {
  if (document.hidden) return 12000;
  if (runtimeSnapshot.items.some((item) => item.status === 'ORANGE')) return 2200;
  if (runtimeSnapshot.items.length) return 4500;
  return 9000;
}
function stopDashboardPolling() {
  if (dashboardTimer) {
    clearTimeout(dashboardTimer);
    dashboardTimer = null;
  }
}
function startDashboardPolling(cfg) {
  stopDashboardPolling();
  if (cfg?.dashboardAutoRefreshEnabled === false) return;
  const scheduleNext = async () => {
    dashboardTimer = setTimeout(async () => {
      dashboardTimer = null;
      if (!document.hidden) {
        await refreshRuntimeDashboard(cfg, true, { fromAutoPoll: true });
      }
      startDashboardPolling(cfg);
    }, getDashboardPollMs());
  };
  scheduleNext();
}
document.addEventListener('DOMContentLoaded', () => {
  renderDetectionOptions();
  wireSheetNavigation();
  loadConfig((cfg) => {
    currentPopupConfig = cfg;
    setHint('');
    renderBuiltinSites(cfg);
    renderCustomSites(cfg);
    renderTemplates(cfg);
    wireActions(cfg);
    refreshSummary(cfg);
    refreshRuntimeDashboard(cfg, true, { force: true }).then(() => renderTitleManager(cfg)).catch(() => {});
    startDashboardPolling(cfg);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopDashboardPolling();
        return;
      }
      refreshRuntimeDashboard(cfg, true, { force: true });
      startDashboardPolling(cfg);
    });
  });
});
window.addEventListener('beforeunload', () => {
  stopDashboardPolling();
  flushPendingConfigSave();
});
