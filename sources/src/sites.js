// Ready_Ai - Site registry (built-in + custom)
//
// 목표:
// - 팝업에서 "여러 사이트 등록"을 가능하게 한다.
// - content script는 <all_urls>에 주입되지만, 실제로는 "등록/활성"된 사이트에서만
//   감시(폴링/MutationObserver/타이틀 뱃지)를 실행한다.
// - 등록한 사이트가 늘어나도, 여기만 건드리면 UI/감시 로직이 같이 확장되게 한다.

(function () {
  const STORAGE_KEYS = {
    DND_MODE: 'dndMode',
    ENABLED_SITES: 'enabledSites',
    CUSTOM_SITES: 'customSites',
  };

  // detection:
  // - chatgpt / gemini / aistudio / claude : 전용 규칙
  // - generic_stop : "Stop/중지/Cancel/취소" 버튼 가시성 기반 범용 규칙
  const DETECTION_MODES = [
    { key: 'chatgpt', label: 'ChatGPT 전용' },
    { key: 'gemini', label: 'Gemini 전용' },
    { key: 'aistudio', label: 'AI Studio 전용' },
    { key: 'claude', label: 'Claude 전용' },
    { key: 'generic_stop', label: '범용(Stop/중지 버튼)' },
  ];

  // "등록 가능한" 기본 사이트들
  // - 사용자가 팝업에서 on/off
  // - 추가로 "직접 추가"(customSites) 가능
  const BUILTIN_SITES = [
    {
      key: 'chatgpt',
      name: 'ChatGPT',
      patterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      detection: 'chatgpt',
      defaultEnabled: true,
    },
    {
      key: 'gemini',
      name: 'Gemini',
      patterns: ['https://gemini.google.com/*'],
      detection: 'gemini',
      defaultEnabled: true,
    },
    {
      key: 'aistudio',
      name: 'AI Studio',
      patterns: ['https://aistudio.google.com/*'],
      detection: 'aistudio',
      defaultEnabled: false,
    },
    {
      key: 'claude',
      name: 'Claude',
      patterns: ['https://claude.ai/*'],
      detection: 'claude',
      defaultEnabled: false,
    },
    // 자주 쓰는 곳들(범용 Stop 규칙)
    {
      key: 'perplexity',
      name: 'Perplexity',
      patterns: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'],
      detection: 'generic_stop',
      defaultEnabled: false,
    },
    {
      key: 'poe',
      name: 'Poe',
      patterns: ['https://poe.com/*'],
      detection: 'generic_stop',
      defaultEnabled: false,
    },
    {
      key: 'copilot',
      name: 'Copilot',
      patterns: ['https://copilot.microsoft.com/*'],
      detection: 'generic_stop',
      defaultEnabled: false,
    },
  ];

  // =============== Match Pattern Utils (Chrome match patterns) ===============
  const _patternRegexCache = new Map();

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Chrome match pattern -> RegExp
  // - <all_urls>
  // - scheme://host/path
  //   scheme: * | http | https
  //   host: * | *.domain.com | domain.com
  //   path: /* 와일드카드
  function matchPatternToRegex(pattern) {
    if (_patternRegexCache.has(pattern)) return _patternRegexCache.get(pattern);

    let re;
    if (pattern === '<all_urls>') {
      // content script는 http/https에서만 실제로 의미가 있으니 최소 범위로 제한
      re = /^https?:\/\//i;
      _patternRegexCache.set(pattern, re);
      return re;
    }

    const parts = pattern.split('://');
    if (parts.length !== 2) {
      // 실패 케이스는 항상 false 매칭
      re = /^$/;
      _patternRegexCache.set(pattern, re);
      return re;
    }
    const scheme = parts[0];
    const rest = parts[1];

    const slashIdx = rest.indexOf('/');
    const hostPart = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const pathPart = slashIdx >= 0 ? rest.slice(slashIdx) : '/*';

    const schemeRe = scheme === '*' ? 'https?' : escapeRegex(scheme);

    let hostRe;
    if (hostPart === '*') hostRe = '[^/]+?';
    else if (hostPart.startsWith('*.')) {
      const domain = hostPart.slice(2);
      hostRe = `(?:[^/]+?\\.)?${escapeRegex(domain)}`;
    } else hostRe = escapeRegex(hostPart);

    // path: '*' -> '.*'
    const pathEsc = escapeRegex(pathPart).replace(/\\\*/g, '.*');
    re = new RegExp(`^${schemeRe}://${hostRe}${pathEsc}$`, 'i');
    _patternRegexCache.set(pattern, re);
    return re;
  }

  function urlMatchesPattern(url, pattern) {
    try {
      const re = matchPatternToRegex(pattern);
      return re.test(url);
    } catch (_) {
      return false;
    }
  }

  function urlMatchesAny(url, patterns) {
    if (!patterns || !patterns.length) return false;
    return patterns.some((p) => urlMatchesPattern(url, p));
  }

  function normalizePatterns(rawText) {
    if (!rawText) return [];
    if (Array.isArray(rawText)) {
      return rawText
        .map((s) => String(s || '').trim())
        .filter(Boolean);
    }
    return String(rawText)
      .split(/\r?\n|,|;/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isProbablyValidMatchPattern(pattern) {
    if (!pattern) return false;
    if (pattern === '<all_urls>') return true;
    // 너무 빡세게 검증하면 사용자가 답답해하니, 최소한만 체크
    // - scheme://host/...
    // - path에 *가 섞일 수 있음
    const m = pattern.match(/^([*a-zA-Z]+):\/\/([^/]+)(\/.*)?$/);
    if (!m) return false;
    const scheme = m[1];
    if (!(scheme === '*' || scheme === 'http' || scheme === 'https')) return false;
    const host = m[2];
    if (!host || host.includes(' ')) return false;
    // host에 '*' 허용(*, *.domain)
    if (host !== '*' && host.includes('*') && !host.startsWith('*.')) return false;
    return true;
  }

  function defaultEnabledSites() {
    const enabled = {};
    for (const s of BUILTIN_SITES) enabled[s.key] = !!s.defaultEnabled;
    return enabled;
  }

  function ensureEnabledSitesObject(enabledSites) {
    const defaults = defaultEnabledSites();
    if (!enabledSites || typeof enabledSites !== 'object') return defaults;
    // 누락된 key만 기본값으로 채움(기존 설정 유지)
    for (const k of Object.keys(defaults)) {
      if (!(k in enabledSites)) enabledSites[k] = defaults[k];
    }
    return enabledSites;
  }

  // custom site shape:
  // {
  //   id: "custom_xxx",
  //   name: "내 사이트",
  //   patterns: ["https://example.com/*"],
  //   detection: "generic_stop",
  //   enabled: true
  // }
  function normalizeCustomSites(customSites) {
    if (!Array.isArray(customSites)) return [];
    return customSites
      .map((s) => {
        const id = String(s?.id || '').trim();
        const name = String(s?.name || '').trim() || 'Custom';
        const patterns = normalizePatterns(s?.patterns);
        const detection = String(s?.detection || 'generic_stop').trim();
        const enabled = !!s?.enabled;
        if (!id || !patterns.length) return null;
        return { id, name, patterns, detection, enabled };
      })
      .filter(Boolean);
  }

  function resolveSiteFromConfig(url, enabledSites, customSites) {
    const enabled = ensureEnabledSitesObject(enabledSites);
    const customs = normalizeCustomSites(customSites);

    // 1) custom 우선(사용자 명시)
    for (const c of customs) {
      if (!c.enabled) continue;
      if (urlMatchesAny(url, c.patterns)) {
        return {
          key: c.id,
          name: c.name,
          patterns: c.patterns,
          detection: c.detection || 'generic_stop',
          isCustom: true,
        };
      }
    }

    // 2) builtin
    for (const s of BUILTIN_SITES) {
      if (!enabled[s.key]) continue;
      if (urlMatchesAny(url, s.patterns)) {
        return {
          key: s.key,
          name: s.name,
          patterns: s.patterns,
          detection: s.detection,
          isCustom: false,
        };
      }
    }

    return null;
  }

  // 간단 UUID(충돌만 피하면 됨)
  function makeCustomId() {
    const rand = Math.random().toString(16).slice(2);
    return `custom_${Date.now().toString(16)}_${rand}`;
  }

  // Export to global
  window.ReadyAi = window.ReadyAi || {};
  window.ReadyAi.sites = {
    STORAGE_KEYS,
    DETECTION_MODES,
    BUILTIN_SITES,
    matchPatternToRegex,
    urlMatchesAny,
    normalizePatterns,
    isProbablyValidMatchPattern,
    defaultEnabledSites,
    ensureEnabledSitesObject,
    normalizeCustomSites,
    resolveSiteFromConfig,
    makeCustomId,
  };
})();
