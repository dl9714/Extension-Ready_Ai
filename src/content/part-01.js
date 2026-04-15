// NOTE:
// - content script는 <all_urls>에 주입된다.
// - 하지만 실제 감시는 "등록/활성"된 사이트에서만 실행한다.
var activeSite = null; // { key, name, detection }
var monitoring = false;
var isGenerating = false;
var checkInterval = null;
var completionStatus = 'idle'; // 'idle' | 'completed'
// 최초 1회는 무조건 background로 상태를 보내서
// "아무 질문 없음" 상태(흰색 뱃지)도 탭에 즉시 반영되게 한다.
var hasSentInitialState = false;
// iframe(특히 AI Studio) 대응
// - UI가 cross-origin iframe 안에 들어가면 top frame은 "생성중" 요소를 못 본다.
// - all_frames=true 로 모든 프레임에 content script를 주입하고,
//   프레임 URL이 사이트 패턴에 안 맞더라도 "탭 URL" 기준으로 감시를 켤 수 있게 한다.
var IS_TOP_FRAME = (() => {
  try { return window.top === window; } catch (_) { return true; }
})();
// 탭 타이틀 뱃지(이모지)
var TITLE_BADGE = {
  WHITE: '⚪',  // 대기/읽음/아무 질문 없음
  ORANGE: '🟠', // 생성중
  GREEN: '🟢',  // 완료(아직 클릭/스크롤로 확인 전)
};
var TITLE_BADGE_PREFIX_RE = /^(?:[⚪🟠🟢](?:\[?\d+\+?\]?|\s*(?:\d+\+?)?)?\s*)+/;
function getTitleBadgeCountGlyph() {
  if (!titleBadgeCountEnabled) return '';
  if (!steeringQueue.length) return '';
  return `${getSteeringQueueCountText()}`;
}
// background(frame 합산) 쪽에서 stale frame을 안 남기기 위해
// content는 주기적으로(기본 5s) 상태를 heartbeat로 보내준다.
var HEARTBEAT_MS = 5000;
var _lastHeartbeatAt = 0;
// ===== 백그라운드 탭에서도 완료 감지(특히 Gemini) =====
// - Gemini는 DOM 변경이 childList가 아니라 attributes/style로만 일어나는 경우가 있어
//   MutationObserver(childList)만으로는 "중지 버튼 사라짐"을 못 잡고 🟠가 유지될 수 있음.
// - 따라서 attributes 감시 + 주기 폴링(setInterval)을 같이 사용한다.
var CHECK_INTERVAL_ACTIVE_MS = 1200;
var CHECK_INTERVAL_VISIBLE_IDLE_MS = 1800;
var CHECK_INTERVAL_HIDDEN_ACTIVE_MS = 2000;
var CHECK_INTERVAL_HIDDEN_IDLE_MS = 5500;
var MIN_CHECK_GAP_MS = 250;
var _checkScheduled = false;
var _lastCheckAt = 0;
var _currentPollingMs = 0;
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
function getDesiredPollingMs() {
  if (!monitoring) return 0;
  if (document.hidden) return isGenerating ? CHECK_INTERVAL_HIDDEN_ACTIVE_MS : CHECK_INTERVAL_HIDDEN_IDLE_MS;
  if (isGenerating) return CHECK_INTERVAL_ACTIVE_MS;
  return CHECK_INTERVAL_VISIBLE_IDLE_MS;
}
function ensurePolling(force = false) {
  if (!monitoring) return;
  const desiredMs = getDesiredPollingMs();
  if (!force && checkInterval && _currentPollingMs === desiredMs) return;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  _currentPollingMs = 0;
  _currentPollingMs = desiredMs;
  checkInterval = window.setInterval(() => {
    scheduleCheck();
  }, desiredMs);
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
var _deepRoots = new Set(); // Document | ShadowRoot
var _deepObservers = new Map(); // root -> MutationObserver
var _lastShadowRescanAt = 0;
var SHADOW_RESCAN_MS = 4000;
var SHADOW_RESCAN_HIDDEN_IDLE_MS = 12000;
var _deepEnabled = false;
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
  if (!_deepEnabled) return;
  const now = Date.now();
  const minGap = (document.hidden && !isGenerating) ? SHADOW_RESCAN_HIDDEN_IDLE_MS : SHADOW_RESCAN_MS;
  if (now - _lastShadowRescanAt < minGap) return;
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
function getCleanDocumentTitleText(rawTitle = document.title) {
  return String(rawTitle || '').replace(TITLE_BADGE_PREFIX_RE, '').trimStart();
}
function normalizeCustomTabTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, CUSTOM_TAB_TITLE_MAX_LENGTH);
}
function hasCustomTabTitle() {
  return !!normalizeCustomTabTitle(customTabTitle);
}
function getDesiredBaseTitle(currentCleanTitle = '') {
  if (hasCustomTabTitle()) return normalizeCustomTabTitle(customTabTitle);
  const native = normalizeCustomTabTitle(nativePageTitle);
  const clean = normalizeCustomTabTitle(currentCleanTitle);
  return native || clean || activeSite?.name || 'AI';
}
function computeDesiredDocumentTitle(currentRawTitle = document.title) {
  const cleanTitle = getCleanDocumentTitleText(currentRawTitle);
  if (!titleSyncMuted && !hasCustomTabTitle()) {
    const normalizedClean = normalizeCustomTabTitle(cleanTitle);
    const rememberedCustom = normalizeCustomTabTitle(lastCustomTabTitle);
    if (!normalizedClean || normalizedClean !== rememberedCustom) {
      nativePageTitle = cleanTitle || nativePageTitle || activeSite?.name || 'AI';
      if (normalizedClean && normalizedClean !== rememberedCustom) lastCustomTabTitle = '';
    }
  }
  const baseTitle = getDesiredBaseTitle(cleanTitle);
  if (!titleBadgeEnabled) return baseTitle;
  let badge = TITLE_BADGE.WHITE;
  if (isGenerating) badge = TITLE_BADGE.ORANGE;
  else if (completionStatus === 'completed') badge = TITLE_BADGE.GREEN;
  const countGlyph = getTitleBadgeCountGlyph();
  return `${badge}${countGlyph} ${baseTitle}`.trim();
}
