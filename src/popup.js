function $(id) {
  return document.getElementById(id);
}

function setHint(text, isError = false) {
  const el = $('status-hint');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#b00000' : '#888';
}

function getSitesApi() {
  return window?.ReadyAi?.sites;
}

function loadConfig(cb) {
  const sitesApi = getSitesApi();
  const enabledKey = sitesApi?.STORAGE_KEYS?.ENABLED_SITES || 'enabledSites';
  const customKey = sitesApi?.STORAGE_KEYS?.CUSTOM_SITES || 'customSites';

  chrome.storage.local.get([
    'dndMode',
    enabledKey,
    customKey,
    // Gemini auto probe
    'geminiProbeEnabled',
    'geminiProbePeriodMin',
    'geminiProbeIdleSec',
    'geminiProbeMinOrangeSec',
  ], (res) => {
    const enabledSites = sitesApi?.ensureEnabledSitesObject
      ? sitesApi.ensureEnabledSitesObject(res?.[enabledKey])
      : (res?.[enabledKey] || {});
    const customSites = sitesApi?.normalizeCustomSites
      ? sitesApi.normalizeCustomSites(res?.[customKey])
      : (res?.[customKey] || []);
    cb({
      dndMode: !!res.dndMode,
      enabledSites,
      customSites,
      // defaults are mirrored with background.js
      geminiProbeEnabled: (typeof res.geminiProbeEnabled === 'boolean') ? res.geminiProbeEnabled : true,
      geminiProbePeriodMin: (res.geminiProbePeriodMin != null) ? res.geminiProbePeriodMin : 1,
      geminiProbeIdleSec: (res.geminiProbeIdleSec != null) ? res.geminiProbeIdleSec : 60,
      geminiProbeMinOrangeSec: (res.geminiProbeMinOrangeSec != null) ? res.geminiProbeMinOrangeSec : 12,
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
      [enabledKey]: cfg.enabledSites,
      [customKey]: cfg.customSites,
      // Gemini auto probe
      geminiProbeEnabled: !!cfg.geminiProbeEnabled,
      geminiProbePeriodMin: cfg.geminiProbePeriodMin,
      geminiProbeIdleSec: cfg.geminiProbeIdleSec,
      geminiProbeMinOrangeSec: cfg.geminiProbeMinOrangeSec,
      // 고정: '유휴일 때만' (탭 전환이 거슬릴 수 있으니 기본 설계 자체를 안전하게)
      geminiProbeOnlyIdle: true,
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
      saveConfig(cfg, () => setHint('저장됨'));
    });
    switchWrap.appendChild(input);
    switchWrap.appendChild(slider);

    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = '삭제';
    del.addEventListener('click', () => {
      cfg.customSites = cfg.customSites.filter((x) => x.id !== s.id);
      saveConfig(cfg, () => {
        setHint('삭제됨');
        renderCustomSites(cfg);
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

function wireActions(cfg) {
  const dndToggle = $('dnd-toggle');
  dndToggle.checked = !!cfg.dndMode;
  dndToggle.addEventListener('change', () => {
    cfg.dndMode = dndToggle.checked;
    saveConfig(cfg, () => setHint('저장됨'));
  });

  // ===== Gemini auto probe =====
  const probeToggle = $('gemini-probe-toggle');
  const probePeriod = $('gemini-probe-period');
  const probeIdleSec = $('gemini-probe-idle-sec');
  const probeMinOrangeSec = $('gemini-probe-min-orange-sec');

  if (probeToggle) {
    probeToggle.checked = !!cfg.geminiProbeEnabled;
    probeToggle.addEventListener('change', () => {
      cfg.geminiProbeEnabled = !!probeToggle.checked;
      saveConfig(cfg, () => setHint('저장됨'));
    });
  }
  if (probePeriod) {
    probePeriod.value = String(cfg.geminiProbePeriodMin ?? 1);
    probePeriod.addEventListener('change', () => {
      cfg.geminiProbePeriodMin = clampNumber(probePeriod.value, 1, 1, 60);
      probePeriod.value = String(cfg.geminiProbePeriodMin);
      saveConfig(cfg, () => setHint('저장됨'));
    });
  }
  if (probeIdleSec) {
    probeIdleSec.value = String(cfg.geminiProbeIdleSec ?? 60);
    probeIdleSec.addEventListener('change', () => {
      cfg.geminiProbeIdleSec = clampInt(probeIdleSec.value, 60, 15, 3600);
      probeIdleSec.value = String(cfg.geminiProbeIdleSec);
      saveConfig(cfg, () => setHint('저장됨'));
    });
  }
  if (probeMinOrangeSec) {
    probeMinOrangeSec.value = String(cfg.geminiProbeMinOrangeSec ?? 12);
    probeMinOrangeSec.addEventListener('change', () => {
      cfg.geminiProbeMinOrangeSec = clampInt(probeMinOrangeSec.value, 12, 3, 600);
      probeMinOrangeSec.value = String(cfg.geminiProbeMinOrangeSec);
      saveConfig(cfg, () => setHint('저장됨'));
    });
  }

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
      setHint('추가됨');
      renderCustomSites(cfg);
    });
  });

  $('reset-defaults').addEventListener('click', () => {
    const sitesApi = getSitesApi();
    if (!sitesApi) return;
    cfg.enabledSites = sitesApi.defaultEnabledSites();
    cfg.customSites = [];
    saveConfig(cfg, () => {
      setHint('기본값으로 복구됨');
      renderBuiltinSites(cfg);
      renderCustomSites(cfg);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderDetectionOptions();
  loadConfig((cfg) => {
    setHint('');
    renderBuiltinSites(cfg);
    renderCustomSites(cfg);
    wireActions(cfg);
  });
});
