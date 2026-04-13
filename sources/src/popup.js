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
function loadConfig(cb) {
  const sitesApi = getSitesApi();
  const enabledKey = sitesApi?.STORAGE_KEYS?.ENABLED_SITES || 'enabledSites';
  const customKey = sitesApi?.STORAGE_KEYS?.CUSTOM_SITES || 'customSites';
  chrome.storage.local.get([
    'dndMode',
    'badgeEnabled',
    enabledKey,
    customKey,
    'geminiProbeEnabled',
    'geminiProbePeriodMin',
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
      enabledSites,
      customSites,
      geminiProbeEnabled: (typeof res.geminiProbeEnabled === 'boolean') ? res.geminiProbeEnabled : true,
      geminiProbePeriodMin: (res.geminiProbePeriodMin != null) ? res.geminiProbePeriodMin : 1,
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
    });
  });
}
function saveConfig(cfg, cb) {
  const sitesApi = getSitesApi();
  const enabledKey = sitesApi?.STORAGE_KEYS?.ENABLED_SITES || 'enabledSites';
  const customKey = sitesApi?.STORAGE_KEYS?.CUSTOM_SITES || 'customSites';
  chrome.storage.local.set(
    {
      dndMode: !!cfg.dndMode,
      badgeEnabled: !!cfg.badgeEnabled,
      [enabledKey]: cfg.enabledSites,
      [customKey]: cfg.customSites,
      geminiProbeEnabled: !!cfg.geminiProbeEnabled,
      geminiProbePeriodMin: cfg.geminiProbePeriodMin,
      geminiProbeIdleSec: cfg.geminiProbeIdleSec,
      geminiProbeMinOrangeSec: cfg.geminiProbeMinOrangeSec,
      geminiProbeOnlyIdle: true,
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
    },
    () => cb?.()
  );
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
  for (const m of sitesApi.DETECTION_MODES) {
    const opt = document.createElement('option');
    opt.value = m.key;
    opt.textContent = m.label;
    select.appendChild(opt);
  }
  select.value = 'generic_stop';
}
function updateSummaryText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}
function refreshSummary(cfg) {
  const sitesApi = getSitesApi();
  const builtinSites = Array.isArray(sitesApi?.BUILTIN_SITES) ? sitesApi.BUILTIN_SITES : [];
  const builtinEnabledCount = builtinSites.filter((s) => !!cfg.enabledSites?.[s.key]).length;
  const customSites = Array.isArray(cfg.customSites) ? cfg.customSites : [];
  const customEnabledCount = customSites.filter((s) => !!s.enabled).length;
  updateSummaryText('summary-dnd-badge', cfg.dndMode ? '켜짐' : '꺼짐');
  updateSummaryText('summary-dnd-chip', cfg.dndMode ? '완료 팝업 숨김' : '완료 팝업 표시');
  updateSummaryText('summary-gemini-chip-1', `주기 ${cfg.geminiProbePeriodMin ?? 1}분`);
  updateSummaryText('summary-gemini-chip-2', `유휴 ${cfg.geminiProbeIdleSec ?? 60}초`);
  updateSummaryText('summary-gemini-chip-3', `강제확인 ${cfg.geminiProbeMinOrangeSec ?? 12}초`);
  updateSummaryText('summary-alert-badge', cfg.individualCompletionNotificationEnabled || cfg.batchCompletionNotificationEnabled ? '활성' : '꺼짐');
  updateSummaryText('summary-alert-chip-1', `개별 ${soundPresetLabel(cfg.individualCompletionSound)}`);
  updateSummaryText('summary-alert-chip-2', `일괄 ${cfg.batchCompletionThreshold}개↑`);
  updateSummaryText('summary-alert-chip-3', `볼륨 ${Math.max(volumeToPercent(cfg.individualCompletionVolume), volumeToPercent(cfg.batchCompletionVolume))}%`);
  updateSummaryText('summary-builtin-badge', `${builtinEnabledCount}/${builtinSites.length} 활성`);
  updateSummaryText('summary-builtin-chip', `기본 사이트 ${builtinEnabledCount}개 사용 중`);
  updateSummaryText('summary-custom-badge', `${customEnabledCount}/${customSites.length} 활성`);
  updateSummaryText('summary-custom-chip', `직접 추가 ${customSites.length}개 등록`);
  updateSummaryText('summary-steering-badge', cfg.steeringEnabled ? '켜짐' : '꺼짐');
  updateSummaryText('summary-steering-chip-1', cfg.steeringTheme === 'light' ? '라이트 패널' : '다크 패널');
  updateSummaryText('summary-steering-chip-2', '상시 런처');
}
function openSheet(sheetId) {
  document.querySelectorAll('.sheet.active').forEach((el) => el.classList.remove('active'));
  const target = $(sheetId);
  if (target) {
    target.classList.add('active');
    const scroller = target.querySelector('.sheet-scroll');
    if (scroller) scroller.scrollTop = 0;
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
    } else {
      if (soundKey === SOUND_PRESETS.custom && !cfg[map.customDataKey]) {
        setHint('사용자 지정 파일을 먼저 넣어줘', true);
      } else {
        setHint('알림음 재생 실패', true);
      }
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
function wireActions(cfg) {
  const dndToggle = $('dnd-toggle');
  dndToggle.checked = !!cfg.dndMode;
  dndToggle.addEventListener('change', () => {
    cfg.dndMode = dndToggle.checked;
    saveConfig(cfg, () => {
      refreshSummary(cfg);
      setHint('저장됨');
    });
  });
  const badgeToggle = $('badge-toggle');
  if (badgeToggle) {
    badgeToggle.checked = !!cfg.badgeEnabled;
    badgeToggle.addEventListener('change', () => {
      cfg.badgeEnabled = !!badgeToggle.checked;
      saveConfig(cfg, () => {
        refreshSummary(cfg);
        setHint('저장됨');
      });
    });
  }
  const steeringToggle = $('steering-toggle');
  const steeringTheme = $('steering-theme');
  if (steeringToggle) {
    steeringToggle.checked = !!cfg.steeringEnabled;
    steeringToggle.addEventListener('change', () => {
      cfg.steeringEnabled = !!steeringToggle.checked;
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
  $('add-custom').addEventListener('click', () => {
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
  $('reset-defaults').addEventListener('click', () => {
    const sitesApi = getSitesApi();
    if (!sitesApi) return;
    chrome.storage.local.clear(() => {
      loadConfig((newCfg) => {
        renderBuiltinSites(newCfg);
        renderCustomSites(newCfg);
        refreshSummary(newCfg);
        setHint('전체 설정 초기화됨');
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', () => {
  renderDetectionOptions();
  wireSheetNavigation();
  loadConfig((cfg) => {
    setHint('');
    renderBuiltinSites(cfg);
    renderCustomSites(cfg);
    wireActions(cfg);
    refreshSummary(cfg);
  });
});