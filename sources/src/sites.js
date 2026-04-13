(function (global) {
  const root = global.ReadyAi = global.ReadyAi || {};
  const STORAGE_KEYS = Object.freeze({
    ENABLED_SITES: 'enabledSites',
    CUSTOM_SITES: 'customSites',
  });
  const DETECTION_MODES = Object.freeze([
    { key: 'chatgpt', label: 'ChatGPT 전용' },
    { key: 'gemini', label: 'Gemini 전용' },
    { key: 'aistudio', label: 'AI Studio 전용' },
    { key: 'claude', label: 'Claude 전용' },
    { key: 'generic_stop', label: '범용 Stop/중지 감지' },
  ]);
  const BUILTIN_SITES = Object.freeze([
    {
      key: 'chatgpt',
      name: 'ChatGPT',
      patterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      detection: 'chatgpt',
    },
    {
      key: 'gemini',
      name: 'Gemini',
      patterns: ['https://gemini.google.com/*'],
      detection: 'gemini',
    },
    {
      key: 'aistudio',
      name: 'AI Studio',
      patterns: ['https://aistudio.google.com/*', 'https://makersuite.google.com/*'],
      detection: 'aistudio',
    },
    {
      key: 'claude',
      name: 'Claude',
      patterns: ['https://claude.ai/*'],
      detection: 'claude',
    },
    {
      key: 'perplexity',
      name: 'Perplexity',
      patterns: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'],
      detection: 'generic_stop',
    },
    {
      key: 'copilot',
      name: 'Copilot',
      patterns: ['https://copilot.microsoft.com/*'],
      detection: 'generic_stop',
    },
  ]);
  function normalizePatterns(input) {
    if (Array.isArray(input)) {
      return input
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    }
    return String(input || '')
      .split(/\r?\n/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  function isProbablyValidMatchPattern(pattern) {
    const p = String(pattern || '').trim();
    if (!p) return false;
    if (p === '<all_urls>') return true;
    return /^(\*|https?|file|ftp):\/\//i.test(p);
  }
  function escapeRegExp(value) {
    return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  function matchPatternToRegExp(pattern) {
    const p = String(pattern || '').trim();
    if (!isProbablyValidMatchPattern(p)) return null;
    if (p === '<all_urls>') return /^https?:\/\//i;
    const m = p.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/i);
    if (!m) return null;
    let [, scheme, host, path] = m;
    const schemePart = scheme === '*' ? 'https?' : escapeRegExp(scheme.toLowerCase());
    let hostPart = host || '';
    if (scheme.toLowerCase() === 'file') {
      hostPart = '';
    } else if (hostPart === '*') {
      hostPart = '[^/]+';
    } else if (hostPart.startsWith('*.')) {
      hostPart = '(?:[^/]+\\.)*' + escapeRegExp(hostPart.slice(2));
    } else {
      hostPart = escapeRegExp(hostPart).replace(/\\\*/g, '.*');
    }
    const pathPart = escapeRegExp(path).replace(/\\\*/g, '.*');
    const hostExpr = scheme.toLowerCase() === 'file' ? '' : hostPart;
    return new RegExp('^' + schemePart + ':\\/\\/' + hostExpr + pathPart + '$', 'i');
  }
  function matchesUrl(url, patterns) {
    const target = String(url || '').trim();
    if (!target) return false;
    const list = normalizePatterns(patterns);
    return list.some((pattern) => {
      try {
        const rx = matchPatternToRegExp(pattern);
        return !!(rx && rx.test(target));
      } catch (_) {
        return false;
      }
    });
  }
  function ensureEnabledSitesObject(raw) {
    const base = {};
    for (const site of BUILTIN_SITES) base[site.key] = true;
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        base[key] = !!value;
      }
    }
    return base;
  }
  function normalizeCustomSites(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((site, idx) => {
        const id = String(site?.id || makeCustomId(idx)).trim();
        const name = String(site?.name || `Custom ${idx + 1}`).trim();
        const detection = DETECTION_MODES.some((m) => m.key === site?.detection)
          ? site.detection
          : 'generic_stop';
        const patterns = normalizePatterns(site?.patterns);
        if (!patterns.length) return null;
        return {
          id,
          key: id,
          name,
          patterns,
          detection,
          enabled: site?.enabled !== false,
        };
      })
      .filter(Boolean);
  }
  function makeCustomId(seed) {
    const suffix = typeof seed === 'number'
      ? String(seed + 1)
      : Math.random().toString(36).slice(2, 10);
    return 'custom_' + suffix;
  }
  function resolveSiteFromConfig(url, enabledSites, customSites) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) return null;
    const normalizedEnabled = ensureEnabledSitesObject(enabledSites);
    const normalizedCustom = normalizeCustomSites(customSites);
    for (const site of normalizedCustom) {
      if (!site.enabled) continue;
      if (matchesUrl(targetUrl, site.patterns)) {
        return {
          key: site.key || site.id,
          id: site.id,
          name: site.name,
          patterns: site.patterns.slice(),
          detection: site.detection || 'generic_stop',
          builtin: false,
        };
      }
    }
    for (const site of BUILTIN_SITES) {
      if (!normalizedEnabled[site.key]) continue;
      if (matchesUrl(targetUrl, site.patterns)) {
        return {
          key: site.key,
          name: site.name,
          patterns: site.patterns.slice(),
          detection: site.detection,
          builtin: true,
        };
      }
    }
    return null;
  }
  root.sites = Object.freeze({
    STORAGE_KEYS,
    DETECTION_MODES,
    BUILTIN_SITES,
    normalizePatterns,
    isProbablyValidMatchPattern,
    ensureEnabledSitesObject,
    normalizeCustomSites,
    makeCustomId,
    resolveSiteFromConfig,
  });
})(globalThis);