// NOTE:
// - content script는 <all_urls>에 주입된다.
// - 하지만 실제 감시는 "등록/활성"된 사이트에서만 실행한다.
let activeSite = null; // { key, name, detection }
let monitoring = false;
let isGenerating = false;
let checkInterval = null;
let completionStatus = 'idle'; // 'idle' | 'completed'
// 최초 1회는 무조건 background로 상태를 보내서
// "아무 질문 없음" 상태(흰색 뱃지)도 탭에 즉시 반영되게 한다.
let hasSentInitialState = false;
// iframe(특히 AI Studio) 대응
// - UI가 cross-origin iframe 안에 들어가면 top frame은 "생성중" 요소를 못 본다.
// - all_frames=true 로 모든 프레임에 content script를 주입하고,
//   프레임 URL이 사이트 패턴에 안 맞더라도 "탭 URL" 기준으로 감시를 켤 수 있게 한다.
const IS_TOP_FRAME = (() => {
  try { return window.top === window; } catch (_) { return true; }
})();
// 탭 타이틀 뱃지(이모지)
const TITLE_BADGE = {
  WHITE: '⚪',  // 대기/읽음/아무 질문 없음
  ORANGE: '🟠', // 생성중
  GREEN: '🟢',  // 완료(아직 클릭/스크롤로 확인 전)
};
// background(frame 합산) 쪽에서 stale frame을 안 남기기 위해
// content는 주기적으로(기본 5s) 상태를 heartbeat로 보내준다.
const HEARTBEAT_MS = 5000;
let _lastHeartbeatAt = 0;
// ===== 백그라운드 탭에서도 완료 감지(특히 Gemini) =====
// - Gemini는 DOM 변경이 childList가 아니라 attributes/style로만 일어나는 경우가 있어
//   MutationObserver(childList)만으로는 "중지 버튼 사라짐"을 못 잡고 🟠가 유지될 수 있음.
// - 따라서 attributes 감시 + 주기 폴링(setInterval)을 같이 사용한다.
const CHECK_INTERVAL_MS = 1200;
const MIN_CHECK_GAP_MS = 250;
let _checkScheduled = false;
let _lastCheckAt = 0;
function scheduleCheck() {
  if (!monitoring) return;
  if (_checkScheduled) return;
  _checkScheduled = true;
  const now = Date.now();
  const delay = Math.max(0, MIN_CHECK_GAP_MS - (now - _lastCheckAt));
  setTimeout(() => {
    _checkScheduled = false;
    _lastCheckAt = Date.now();
    try {
      checkStatus();
    } catch (e) {
      // content script가 죽어버리면 이후 상태 갱신이 모두 멈추므로 예외는 삼킴
      // (필요하면 아래 라인 주석 해제)
      // console.debug('[Ready_Ai] checkStatus failed', e);
    }
  }, delay);
}
function ensurePolling() {
  if (!monitoring) return;
  if (checkInterval) return;
  checkInterval = window.setInterval(() => {
    scheduleCheck();
  }, CHECK_INTERVAL_MS);
}
// 단순 셀렉터 제거 -> 아래 checkStatus 함수 내에서 로직으로 처리
// 요소가 실제로 화면에 보이는지 확인하는 헬퍼 함수
// ==========================
// DOM 탐색/감시 유틸
// ==========================
// Gemini는 완료 후에도 Stop 버튼이 DOM에 남아있되
// opacity/visibility/disabled만 바뀌는 경우가 있어서
// 단순 offsetWidth/offsetHeight만으로는 "보임" 판정이 틀릴 수 있다.
function isVisible(elem) {
  if (!elem) return false;
  // hidden 속성
  if (elem.hasAttribute && elem.hasAttribute('hidden')) return false;
  // computed style 기반
  let style;
  try {
    style = window.getComputedStyle(elem);
  } catch (_) {
    // getComputedStyle이 실패하면 최소한의 DOM 기반 판정만 수행
    return !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length);
  }
  if (!style) return false;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (parseFloat(style.opacity || '1') === 0) return false;
  // 레이아웃/렌더 사각형
  const rect = elem.getBoundingClientRect ? elem.getBoundingClientRect() : null;
  if (rect && (rect.width <= 0 || rect.height <= 0)) return false;
  // 마지막 안전장치
  return !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length);
}
function isEnabledButtonLike(elem) {
  if (!elem) return false;
  // disabled / aria-disabled / role=button/버튼류 공통 케이스
  if (elem.disabled === true) return false;
  const ariaDisabled = elem.getAttribute ? elem.getAttribute('aria-disabled') : null;
  if (ariaDisabled && ariaDisabled.toLowerCase() === 'true') return false;
  return true;
}
// ===== Shadow DOM(오픈) 대응 =====
// - Gemini UI는 open shadowRoot 아래에 주요 버튼이 들어가는 경우가 있어
//   document.querySelectorAll만으로는 Stop 버튼 변화를 놓칠 수 있다.
// - 따라서 "알려진 root들(document + open shadow roots)" 에 대해
//   (1) deep query
//   (2) deep mutation observe
// 를 함께 사용한다.
const _deepRoots = new Set(); // Document | ShadowRoot
const _deepObservers = new Map(); // root -> MutationObserver
let _lastShadowRescanAt = 0;
const SHADOW_RESCAN_MS = 4000;
let _deepEnabled = false;
function addDeepRoot(root) {
  if (!root) return;
  if (_deepRoots.has(root)) return;
  _deepRoots.add(root);
  attachObserver(root);
  // 방금 추가된 shadowRoot 내부에도 또 다른 shadowRoot가 있을 수 있으므로
  // 1회 스캔해서 깊은 구조를 초기에 잡아둔다.
  try {
    scanTreeForShadowRoots(root);
  } catch (_) {}
}
function shutdownDeepRoots() {
  // stopMonitoring()에서 호출해서, 사이트 이동/비활성 시 리소스 정리
  try {
    for (const obs of _deepObservers.values()) {
      try { obs.disconnect(); } catch (_) {}
    }
  } catch (_) {}
  _deepObservers.clear();
  _deepRoots.clear();
  _lastShadowRescanAt = 0;
}
function setDeepEnabled(on) {
  const next = !!on;
  if (next === _deepEnabled) return;
  _deepEnabled = next;
  if (_deepEnabled) {
    try { initDeepRoots(); } catch (_) {}
  } else {
    try { shutdownDeepRoots(); } catch (_) {}
  }
}
function attachObserver(root) {
  if (!root) return;
  if (_deepObservers.has(root)) return;
  const obs = new MutationObserver((mutationList) => {
    // 새로 생긴 shadowRoot를 추가로 등록
    for (const m of mutationList) {
      if (m.addedNodes && m.addedNodes.length) {
        for (const n of m.addedNodes) {
          scanTreeForShadowRoots(n);
        }
      }
    }
    scheduleCheck();
  });
  // Document/ShadowRoot 모두 observe 가능
  try {
    const target = root === document ? document.body : root;
    if (!target) return;
    obs.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      // Gemini는 style/class/aria-label 변경만으로 UI가 바뀌기도 함
      attributeFilter: ['aria-label', 'style', 'class', 'hidden', 'disabled', 'aria-disabled']
    });
    _deepObservers.set(root, obs);
  } catch (_) {
    // observe 실패 시(특정 root가 더 이상 유효하지 않은 경우 등) 무시
  }
}
function scanTreeForShadowRoots(rootNode) {
  if (!rootNode) return;
  // Document를 넘겨도 안전하게 처리
  let start = rootNode;
  if (start === document) start = document.documentElement;
  if (!start) return;
  const stack = [];
  // (1) Element 자신도 검사 대상
  if (start.nodeType === Node.ELEMENT_NODE) stack.push(start);
  // (2) ShadowRoot/DocumentFragment 같은 경우에는 하위 element부터 탐색
  //     (shadowRoot는 children을 제공하는 경우가 많지만, 안전하게 childNodes도 처리)
  const seedChildren = start.children || start.childNodes;
  if (seedChildren && seedChildren.length) {
    for (let i = 0; i < seedChildren.length; i++) {
      const n = seedChildren[i];
      if (n && n.nodeType === Node.ELEMENT_NODE) stack.push(n);
    }
  }
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
    if (el.shadowRoot) addDeepRoot(el.shadowRoot);
    const kids = el.children;
    if (kids && kids.length) {
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }
}
function maybeRescanShadowRoots() {
  const now = Date.now();
  if (now - _lastShadowRescanAt < SHADOW_RESCAN_MS) return;
  _lastShadowRescanAt = now;
  try {
    scanTreeForShadowRoots(document.documentElement);
  } catch (_) {}
}
function initDeepRoots() {
  addDeepRoot(document);
  // 최초 1회: 문서 전체에서 open shadowRoot 수집
  try {
    scanTreeForShadowRoots(document.documentElement);
  } catch (_) {}
}
function deepQuerySelectorAll(selector) {
  const out = [];
  for (const root of _deepRoots) {
    try {
      out.push(...Array.from(root.querySelectorAll(selector)));
    } catch (_) {}
  }
  return out;
}
// monitoring 종료/재시작 시 observer 누수 방지
function resetDeepRoots() {
  try {
    for (const obs of _deepObservers.values()) {
      try { obs.disconnect(); } catch (_) {}
    }
  } catch (_) {}
  _deepObservers.clear();
  _deepRoots.clear();
  _lastShadowRescanAt = 0;
}
// selector를 document + (open) shadow roots까지 포함해서 찾는다.
// (monitoring 시작 시 initDeepRoots()가 호출되어야 의미가 있다)
function qsa(selector) {
  // deep roots가 활성화되어 있으면(오픈 shadowRoot 포함) 우선 사용
  try {
    const deep = deepQuerySelectorAll(selector);
    if (deep && deep.length) return deep;
  } catch (_) {}
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch (_) {
    return [];
  }
}
function normalizeIconName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}
function getSiteKey() {
  return activeSite?.key || null;
}
// 탭 제목(Title)에 배지(이모지) 달기 - 아이콘 바로 옆에 표시됨
function updateTitleBadge() {
  if (!monitoring) return;
  if (!IS_TOP_FRAME) return;
  // 1. 현재 제목 가져오기
  const currentTitle = document.title;
  // 2. 제목 앞의 ⚪/🟠/🟢 배지 및 공백을 모두 제거하여 순수 제목 추출
  // (정규식: 줄 시작(^)에 있는 배지 이모지와 공백(\s?)이 하나 이상(+) 있는 경우)
  const cleanTitle = currentTitle.replace(/^([⚪🟠🟢]\s?)+/, "");
  // 3. 상태에 따른 목표 제목 생성
  let badge = TITLE_BADGE.WHITE;
  if (isGenerating) badge = TITLE_BADGE.ORANGE;
  else if (completionStatus === 'completed') badge = TITLE_BADGE.GREEN;
  const targetTitle = `${badge} ${cleanTitle}`;
  // 4. 현재 제목이 목표와 다를 때만 변경 (이 비교가 무한 루프를 막아줌)
  if (currentTitle !== targetTitle) {
    document.title = targetTitle;
  }
}
function clearTitleBadge() {
  if (!IS_TOP_FRAME) return;
  const currentTitle = document.title;
  const cleanTitle = currentTitle.replace(/^([⚪🟠🟢]\s?)+/, "");
  if (cleanTitle !== currentTitle) document.title = cleanTitle;
}
const STEERING_QUICK_ACTIONS = [
  '이어서 진행해줘',
  '핵심만 다시 정리해줘',
  '실행 단계로 바꿔줘',
  '반대 관점도 추가해줘',
];
let steeringHost = null;
let steeringRoot = null;
let steeringRefs = null;
let steeringOfferToken = 0;
let steeringClosedToken = 0;
let steeringPanelOpen = false;
const STEERING_STORAGE_KEYS = Object.freeze({
  ENABLED: 'steeringEnabled',
  THEME: 'steeringTheme',
});
const STEERING_THEME = Object.freeze({
  DARK: 'dark',
  LIGHT: 'light',
});
let steeringEnabled = true;
let steeringTheme = STEERING_THEME.DARK;
let steeringRecentPrompts = [];
const MAX_STEERING_RECENT = 4;
function normalizeSteeringTheme(value) {
  return String(value || '').trim().toLowerCase() === STEERING_THEME.LIGHT ? STEERING_THEME.LIGHT : STEERING_THEME.DARK;
}
function loadSteeringPrefs(cb) {
  try {
    chrome.storage.local.get([STEERING_STORAGE_KEYS.ENABLED, STEERING_STORAGE_KEYS.THEME], (res) => {
      steeringEnabled = typeof res?.[STEERING_STORAGE_KEYS.ENABLED] === 'boolean' ? !!res[STEERING_STORAGE_KEYS.ENABLED] : true;
      steeringTheme = normalizeSteeringTheme(res?.[STEERING_STORAGE_KEYS.THEME]);
      cb?.();
    });
  } catch (_) {
    steeringEnabled = true;
    steeringTheme = STEERING_THEME.DARK;
    cb?.();
  }
}
function pushRecentSteeringPrompt(text) {
  const value = String(text || '').trim();
  if (!value) return;
  steeringRecentPrompts = [value, ...steeringRecentPrompts.filter((item) => item !== value)].slice(0, MAX_STEERING_RECENT);
}
function getSteeringLauncherText() {
  return hasActiveSteeringOffer() ? '답변 완료 · 후속 지시 열기' : '스티어링 열기';
}
function getSteeringLauncherSubText() {
  return hasActiveSteeringOffer() ? '여러 지시를 이어서 넣을 수 있어요' : '항상 열어둘 수 있는 후속 지시 패널';
}
function applySteeringTheme() {
  if (!steeringHost || !steeringRoot) return;
  steeringHost.dataset.theme = steeringTheme;
  const dock = steeringRoot.querySelector('.dock');
  if (dock) dock.setAttribute('data-theme', steeringTheme);
}
function positionSteeringUi() {
  if (!steeringHost) return;
  const composer = getActiveComposer();
  const margin = 18;
  steeringHost.style.left = 'auto';
  steeringHost.style.transform = 'none';
  steeringHost.style.right = `${margin}px`;
  if (composer && composer.getBoundingClientRect) {
    const rect = composer.getBoundingClientRect();
    const composerTop = Number.isFinite(rect.top) ? rect.top : window.innerHeight;
    const desiredBottom = Math.max(88, Math.round(window.innerHeight - composerTop + 12));
    steeringHost.style.bottom = `${desiredBottom}px`;
  } else {
    steeringHost.style.bottom = '96px';
  }
}
function renderSteeringRecent() {
  if (!steeringRefs?.recent) return;
  steeringRefs.recent.innerHTML = '';
  if (!steeringRecentPrompts.length) {
    steeringRefs.recent.style.display = 'none';
    return;
  }
  steeringRefs.recent.style.display = 'flex';
  for (const label of steeringRecentPrompts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-chip';
    btn.textContent = label.length > 28 ? `${label.slice(0, 28)}…` : label;
    btn.title = label;
    btn.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      const current = String(steeringRefs?.input?.value || '').trim();
      steeringRefs.input.value = current ? `${current}
${label}` : label;
      steeringPanelOpen = true;
      updateSteeringUi();
      try { steeringRefs.input.focus(); } catch (_) {}
    });
    steeringRefs.recent.appendChild(btn);
  }
}
window.addEventListener('resize', () => {
  positionSteeringUi();
});
function getSteeringStateLabel() {
  const name = activeSite?.name || 'AI';
  return `${name} 답변 완료 · 추가 진행 스티어링`;
}
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
  return `${existing}\n\n${next}`;
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
function findVisibleActionButton(selectors) {
  const blockWords = /(stop|중지|취소|cancel|abort)/i;
  for (const selector of selectors) {
    const candidates = qsa(selector);
    for (const el of candidates) {
      if (!el || !isVisible(el) || !isEnabledButtonLike(el)) continue;
      const aria = (el.getAttribute?.('aria-label') || '').trim();
      const title = (el.getAttribute?.('title') || '').trim();
      const tooltip = (el.getAttribute?.('mattooltip') || '').trim();
      const txt = (el.innerText || el.textContent || '').trim();
      const hay = `${aria} ${title} ${tooltip} ${txt}`.trim();
      if (blockWords.test(hay)) continue;
      return el;
    }
  }
  return null;
}
function getComposerSelectors(siteKey) {
  if (siteKey === 'chatgpt') {
    return [
      '#prompt-textarea',
      'textarea[data-testid="prompt-textarea"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="메시지"]',
      '[data-testid="prompt-textarea"]',
      'div[contenteditable="true"][data-testid="prompt-textarea"]',
      'form textarea',
    ];
  }
  if (siteKey === 'gemini') {
    return [
      'rich-textarea textarea',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="메시지"]',
      'div[contenteditable="true"][aria-label*="prompt"]',
      'textarea[aria-label*="prompt"]',
      'textarea[aria-label*="메시지"]',
      'form textarea',
    ];
  }
  if (siteKey === 'claude') {
    return [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][enterkeyhint="send"]',
      'div[contenteditable="true"][role="textbox"]',
      'form textarea',
      'textarea',
    ];
  }
  if (siteKey === 'aistudio') {
    return [
      'form textarea',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ];
  }
  return [
    'form textarea:not([disabled]):not([readonly])',
    'textarea:not([disabled]):not([readonly])',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'input[type="text"]:not([disabled]):not([readonly])',
  ];
}
function getSendButtonSelectors(siteKey) {
  if (siteKey === 'chatgpt') {
    return [
      '[data-testid="send-button"]',
      'button[aria-label*="Send message"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="전송"]',
      'form button[type="submit"]',
    ];
  }
  if (siteKey === 'gemini') {
    return [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[aria-label*="전송"]',
      'button[mattooltip*="Send"]',
      'button[mattooltip*="전송"]',
      'form button[type="submit"]',
    ];
  }
  if (siteKey === 'claude') {
    return [
      'button[aria-label*="Send"]',
      'button[aria-label*="send"]',
      'button[data-testid*="send"]',
      'form button[type="submit"]',
    ];
  }
  return [
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="전송"]',
    'form button[type="submit"]',
    'button[type="submit"]',
  ];
}
function getActiveComposer() {
  return findVisibleEditable(getComposerSelectors(getSiteKey()));
}
function getActiveSendButton() {
  return findVisibleActionButton(getSendButtonSelectors(getSiteKey()));
}
function dispatchTextEvents(el) {
  if (!el) return;
  const inputEventInit = { bubbles: true, cancelable: true, data: null, inputType: 'insertText' };
  try { el.dispatchEvent(new InputEvent('input', inputEventInit)); } catch (_) {
    try { el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch (_) {}
  }
  try { el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch (_) {}
}
function dispatchSubmitKey(el) {
  if (!el) return false;
  const eventInit = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', which: 13, keyCode: 13 };
  try {
    const down = new KeyboardEvent('keydown', eventInit);
    const accepted = el.dispatchEvent(down);
    const up = new KeyboardEvent('keyup', eventInit);
    el.dispatchEvent(up);
    return accepted !== false;
  } catch (_) {
    return false;
  }
}
function setControlValue(el, value) {
  if (!el) return false;
  const nextValue = String(value || '');
  const tagName = String(el.tagName || '').toLowerCase();
  const isTextControl = tagName === 'textarea' || (tagName === 'input' && /^(text|search|url|email)$/i.test(el.type || 'text'));
  try { el.focus({ preventScroll: false }); } catch (_) {}
  if (isTextControl) {
    try {
      const proto = tagName === 'textarea'
        ? window.HTMLTextAreaElement?.prototype
        : window.HTMLInputElement?.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, nextValue);
      else el.value = nextValue;
      dispatchTextEvents(el);
      try {
        const len = nextValue.length;
        if (typeof el.setSelectionRange === 'function') el.setSelectionRange(len, len);
      } catch (_) {}
      return true;
    } catch (_) {}
  }
  if (el.isContentEditable) {
    try {
      const selection = window.getSelection?.();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges?.();
      selection?.addRange?.(range);
      try { document.execCommand('selectAll', false, null); } catch (_) {}
      const inserted = document.execCommand('insertText', false, nextValue);
      if (!inserted || String(el.innerText || '').trim() !== nextValue.trim()) {
        el.textContent = '';
        const textNode = document.createTextNode(nextValue);
        el.appendChild(textNode);
      }
      dispatchTextEvents(el);
      return true;
    } catch (_) {
      try {
        el.textContent = nextValue;
        dispatchTextEvents(el);
        return true;
      } catch (_) {}
    }
  }
  return false;
}
function setSteeringStatus(text, isError = false) {
  if (!steeringRefs?.status) return;
  steeringRefs.status.textContent = text || '';
  steeringRefs.status.dataset.state = isError ? 'error' : 'ok';
}
function hideSteeringUi() {
  if (!steeringHost) return;
  steeringHost.style.display = 'none';
}
function hasActiveSteeringOffer() {
  return !isGenerating && steeringOfferToken > 0 && steeringClosedToken !== steeringOfferToken;
}
function ensureSteeringUi() {
  if (steeringHost && steeringRoot && steeringRefs) {
    applySteeringTheme();
    positionSteeringUi();
    renderSteeringRecent();
    return steeringRefs;
  }
  steeringHost = document.createElement('div');
  steeringHost.id = 'ready-ai-steering-host';
  steeringHost.style.position = 'fixed';
  steeringHost.style.right = '18px';
  steeringHost.style.bottom = '96px';
  steeringHost.style.left = 'auto';
  steeringHost.style.transform = 'none';
  steeringHost.style.zIndex = '2147483647';
  steeringHost.style.display = 'none';
  steeringRoot = steeringHost.attachShadow({ mode: 'open' });
  steeringRoot.innerHTML = `
    <style>
      :host { all: initial; }
      .dock {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        font-family: Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
        color: #e5e7eb;
      }
      .dock[data-theme="light"] {
        color: #0f172a;
      }
      .launcher {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(17, 24, 39, 0.94);
        color: #f8fafc;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.35);
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        max-width: min(340px, calc(100vw - 28px));
      }
      .launcher .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
        flex: 0 0 auto;
      }
      .launcher-text {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-width: 0;
      }
      .launcher strong {
        font-size: 12px;
        line-height: 1.25;
      }
      .launcher small {
        font-size: 11px;
        color: rgba(226, 232, 240, 0.9);
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 260px;
      }
      .dock[data-theme="light"] .launcher {
        background: rgba(255, 255, 255, 0.97);
        color: #111827;
        border-color: rgba(99, 102, 241, 0.18);
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.14);
      }
      .dock[data-theme="light"] .launcher small {
        color: #475569;
      }
      .card {
        width: min(460px, calc(100vw - 28px));
        border-radius: 18px;
        border: 1px solid rgba(71, 85, 105, 0.42);
        background: rgba(17, 24, 39, 0.98);
        box-shadow: 0 18px 50px rgba(2, 6, 23, 0.45);
        backdrop-filter: blur(14px);
        padding: 14px;
        color: #e5e7eb;
      }
      .dock[data-theme="light"] .card {
        border-color: rgba(113, 130, 168, 0.22);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.2);
        color: #0f172a;
      }
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 800;
        color: #a5b4fc;
        margin-bottom: 5px;
      }
      .dock[data-theme="light"] .eyebrow {
        color: #4338ca;
      }
      .eyebrow::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
      }
      .title {
        font-size: 13px;
        font-weight: 800;
        line-height: 1.35;
        margin: 0;
      }
      .sub {
        margin-top: 4px;
        font-size: 11px;
        line-height: 1.5;
        color: #94a3b8;
      }
      .dock[data-theme="light"] .sub {
        color: #667085;
      }
      .icon-btn {
        border: 0;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 4px;
      }
      .quick-row, .recent-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 12px 0 10px 0;
      }
      .recent-label {
        width: 100%;
        font-size: 10px;
        color: #94a3b8;
        margin-bottom: 2px;
      }
      .dock[data-theme="light"] .recent-label {
        color: #64748b;
      }
      .chip, .history-chip {
        border: 1px solid rgba(99, 102, 241, 0.2);
        background: rgba(99, 102, 241, 0.12);
        color: #c7d2fe;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        max-width: 100%;
      }
      .dock[data-theme="light"] .chip,
      .dock[data-theme="light"] .history-chip {
        background: rgba(99, 102, 241, 0.07);
        color: #3730a3;
      }
      .input {
        width: 100%;
        min-height: 88px;
        resize: vertical;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 14px;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
        outline: none;
        background: rgba(2, 6, 23, 0.36);
        color: #f8fafc;
      }
      .dock[data-theme="light"] .input {
        background: rgba(248, 250, 252, 0.95);
        color: #111827;
      }
      .input:focus {
        border-color: rgba(99, 102, 241, 0.5);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
      }
      .actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .btn {
        flex: 1;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(255, 255, 255, 0.04);
        padding: 9px 10px;
        font-size: 12px;
        font-weight: 800;
        cursor: pointer;
        color: #e2e8f0;
      }
      .dock[data-theme="light"] .btn {
        background: #ffffff;
        color: #334155;
        border-color: rgba(148, 163, 184, 0.35);
      }
      .btn.primary {
        border-color: rgba(99, 102, 241, 0.36);
        background: linear-gradient(180deg, rgba(99,102,241,0.24), rgba(99,102,241,0.12));
        color: #eef2ff;
      }
      .dock[data-theme="light"] .btn.primary {
        background: linear-gradient(180deg, rgba(99,102,241,0.14), rgba(99,102,241,0.05));
        color: #312e81;
      }
      .status {
        min-height: 16px;
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.4;
        color: #94a3b8;
      }
      .dock[data-theme="light"] .status {
        color: #64748b;
      }
      .status[data-state="error"] {
        color: #f87171;
      }
    </style>
    <div class="dock" data-theme="dark">
      <button class="launcher" type="button" id="ready-ai-steering-launcher">
        <span class="dot"></span>
        <span class="launcher-text">
          <strong id="ready-ai-steering-launcher-title">스티어링 열기</strong>
          <small id="ready-ai-steering-launcher-sub">항상 열어둘 수 있는 후속 지시 패널</small>
        </span>
      </button>
      <div class="card" id="ready-ai-steering-card">
        <div class="top">
          <div>
            <div class="eyebrow">Ready_Ai Steering</div>
            <div class="title" id="ready-ai-steering-title"></div>
            <div class="sub">기본 입력창과 겹치지 않게 따로 뜨고, 후속 지시를 여러 개 이어서 넣을 수 있습니다.</div>
          </div>
          <button class="icon-btn" type="button" id="ready-ai-steering-close" aria-label="접기">×</button>
        </div>
        <div class="quick-row" id="ready-ai-steering-quick"></div>
        <div class="recent-row" id="ready-ai-steering-recent-wrap">
          <div class="recent-label">최근 스티어링</div>
          <div class="recent-row" id="ready-ai-steering-recent"></div>
        </div>
        <textarea class="input" id="ready-ai-steering-input" placeholder="추가 지시를 입력하세요. Enter로 입력창 채우기, Ctrl+Enter로 바로 전송"></textarea>
        <div class="actions">
          <button class="btn" type="button" id="ready-ai-steering-focus">입력창 채우기</button>
          <button class="btn primary" type="button" id="ready-ai-steering-send">바로 전송</button>
        </div>
        <div class="status" id="ready-ai-steering-status"></div>
      </div>
    </div>
  `;
  steeringRefs = {
    title: steeringRoot.getElementById('ready-ai-steering-title'),
    launcher: steeringRoot.getElementById('ready-ai-steering-launcher'),
    launcherTitle: steeringRoot.getElementById('ready-ai-steering-launcher-title'),
    launcherSub: steeringRoot.getElementById('ready-ai-steering-launcher-sub'),
    card: steeringRoot.getElementById('ready-ai-steering-card'),
    input: steeringRoot.getElementById('ready-ai-steering-input'),
    quick: steeringRoot.getElementById('ready-ai-steering-quick'),
    recentWrap: steeringRoot.getElementById('ready-ai-steering-recent-wrap'),
    recent: steeringRoot.getElementById('ready-ai-steering-recent'),
    close: steeringRoot.getElementById('ready-ai-steering-close'),
    focus: steeringRoot.getElementById('ready-ai-steering-focus'),
    send: steeringRoot.getElementById('ready-ai-steering-send'),
    status: steeringRoot.getElementById('ready-ai-steering-status'),
  };
  const consume = (handler) => (event) => {
    try { event.preventDefault(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
    handler?.(event);
  };
  steeringRefs.quick.innerHTML = '';
  for (const label of STEERING_QUICK_ACTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = label;
    btn.addEventListener('click', consume(() => {
      const current = String(steeringRefs.input.value || '').trim();
      steeringRefs.input.value = current ? `${current}
${label}` : label;
      steeringPanelOpen = true;
      steeringRefs.input.focus();
      setSteeringStatus('');
      updateSteeringUi();
    }));
    steeringRefs.quick.appendChild(btn);
  }
  steeringRefs.launcher.addEventListener('click', consume(() => {
    steeringPanelOpen = !steeringPanelOpen;
    updateSteeringUi();
    if (steeringPanelOpen) {
      try { steeringRefs.input.focus(); } catch (_) {}
    }
  }));
  steeringRefs.close.addEventListener('click', consume(() => {
    steeringPanelOpen = false;
    updateSteeringUi();
  }));
  steeringRefs.focus.addEventListener('click', consume(() => {
    commitSteeringPrompt({ sendNow: false });
  }));
  steeringRefs.send.addEventListener('click', consume(() => {
    commitSteeringPrompt({ sendNow: true });
  }));
  steeringRefs.input.addEventListener('keydown', (event) => {
    try { event.stopPropagation(); } catch (_) {}
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      try { event.preventDefault(); } catch (_) {}
      steeringPanelOpen = false;
      updateSteeringUi();
      return;
    }
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    try { event.preventDefault(); } catch (_) {}
    commitSteeringPrompt({ sendNow: !!(event.ctrlKey || event.metaKey) });
  });
  try { (document.body || document.documentElement).appendChild(steeringHost); } catch (_) {}
  applySteeringTheme();
  positionSteeringUi();
  renderSteeringRecent();
  return steeringRefs;
}
function acknowledgeCompletion() {
  if (!monitoring) return;
  if (isGenerating) return;
  if (completionStatus !== 'completed') return;
  completionStatus = 'idle';
  updateTitleBadge();
  chrome.runtime.sendMessage({
    action: 'user_activity',
    platform: getSiteKey(),
    siteName: activeSite?.name,
  });
}
function commitSteeringPrompt(options = {}) {
  const refs = ensureSteeringUi();
  const text = String(refs?.input?.value || '').trim();
  pushRecentSteeringPrompt(text);
  if (!text) {
    setSteeringStatus('추가 지시를 먼저 입력해주세요.', true);
    try { refs?.input?.focus(); } catch (_) {}
    return;
  }
  const composer = getActiveComposer();
  if (!composer) {
    setSteeringStatus('현재 페이지에서 입력창을 찾지 못했습니다.', true);
    return;
  }
  const mergedText = mergeSteeringText(getCurrentComposerText(composer), text);
  const ok = setControlValue(composer, mergedText);
  if (!ok) {
    setSteeringStatus('입력창에 지시를 넣지 못했습니다.', true);
    return;
  }
  acknowledgeCompletion();
  let sent = false;
  if (options.sendNow) {
    const sendButton = getActiveSendButton();
    if (sendButton) {
      try { sendButton.click(); sent = true; } catch (_) {}
    }
    if (!sent) sent = dispatchSubmitKey(composer);
    if (sent) {
      steeringClosedToken = steeringOfferToken;
      steeringPanelOpen = false;
      setSteeringStatus('바로 전송했습니다.');
      try { refs.input.value = ''; } catch (_) {}
      renderSteeringRecent();
      updateSteeringUi();
      return;
    }
    setSteeringStatus('입력창까지 채웠습니다. 전송은 직접 눌러주세요.');
  } else {
    setSteeringStatus('입력창을 채우고 포커스를 옮겼습니다.');
  }
  try { composer.focus({ preventScroll: false }); } catch (_) {}
  steeringClosedToken = steeringOfferToken;
  steeringPanelOpen = false;
  try { refs.input.value = ''; } catch (_) {}
  renderSteeringRecent();
  updateSteeringUi();
}
function updateSteeringUi() {
  if (!monitoring || !steeringEnabled) {
    hideSteeringUi();
    return;
  }
  const refs = ensureSteeringUi();
  if (!refs) return;
  refs.title.textContent = getSteeringStateLabel();
  refs.launcherTitle.textContent = getSteeringLauncherText();
  refs.launcherSub.textContent = getSteeringLauncherSubText();
  refs.launcher.style.display = 'inline-flex';
  refs.card.style.display = steeringPanelOpen ? 'block' : 'none';
  refs.recentWrap.style.display = steeringRecentPrompts.length ? 'block' : 'none';
  if (!steeringPanelOpen) setSteeringStatus('');
  applySteeringTheme();
  positionSteeringUi();
  renderSteeringRecent();
  steeringHost.style.display = 'block';
}
// =========================
// Generating detection rules
// =========================
// Generating detection rules
// =========================
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
    // - 생성 시작: ⚪ -> 🟠
    // - 생성 완료: 🟠 -> 🟢 (탭이 포커스인지 여부와 무관하게 무조건 🟢)
    // - 🟢 상태는 "클릭/스크롤"로만 ⚪로 돌아간다.
    if (isGenerating) {
      completionStatus = 'idle';
      steeringPanelOpen = false;
      steeringClosedToken = steeringOfferToken;
    } else {
      completionStatus = 'completed';
      steeringOfferToken += 1;
      steeringClosedToken = 0;
      steeringPanelOpen = true;
    }
    shouldSend = true;
  } else if (!hasSentInitialState) {
    // 초기 1회는 무조건 상태 전송(흰색 뱃지 표시용)
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
// 사용자 상호작용(클릭/스크롤) 시 🟢 -> ⚪ 전환 (요구사항)
function markAsAcknowledged(event) {
  if (isSteeringTarget(event?.target)) return;
  acknowledgeCompletion();
}
// =========================
// Monitor lifecycle (start/stop) - registered sites only
// =========================
let _observer = null;
let _handlersBound = false;
function bindHandlersOnce() {
  if (_handlersBound) return;
  _handlersBound = true;
  // 이벤트 리스너 등록
  // - focus/keydown으로는 절대 지우지 않는다.
  // - "클릭" 또는 "스크롤(휠/스크롤 이벤트)"로만 🟢 -> ⚪
  document.addEventListener('click', markAsAcknowledged, true);
  document.addEventListener('scroll', markAsAcknowledged, true);
  document.addEventListener('wheel', markAsAcknowledged, { passive: true, capture: true });
  // 탭 활성/비활성 전환 시에도 상태 재평가(백그라운드 완료 감지 보강)
  document.addEventListener('visibilitychange', scheduleCheck);
}
// shadow DOM deep-scan / deep-observe는 Gemini 완료 감지 보강용이 핵심이라
// 기본은 Gemini에서만 켠다.
function shouldEnableDeepForSite(site) {
  const mode = site?.detection || site?.key || '';
  return mode === 'gemini' || site?.key === 'gemini';
}
function startMonitoring(site) {
  if (monitoring && activeSite?.key === site?.key) return;
  stopMonitoring();
  activeSite = site;
  monitoring = true;
  isGenerating = false;
  completionStatus = 'idle';
  hasSentInitialState = false;
  steeringOfferToken = 0;
  steeringClosedToken = 0;
  steeringPanelOpen = false;
  bindHandlersOnce();
  // 오픈 shadowRoot deep query/observe 활성화
  try { initDeepRoots(); } catch (_) {}
  bindHandlersOnce();
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
    updateSteeringUi();
    scheduleCheck();
  });
}
function stopMonitoring() {
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
  clearTitleBadge();
  steeringOfferToken = 0;
  steeringClosedToken = 0;
  steeringPanelOpen = false;
  hideSteeringUi();
}
let _bootRetryCount = 0;
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
  });
} catch (_) {}