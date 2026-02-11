// 상태 관리 변수
let tabStates = {}; // { tabId: { status: 'IDLE' | 'GENERATING' | 'COMPLETED_UNREAD' | 'COMPLETED_READ', platform: '' } }
let settings = { dndMode: false };

// 초기 설정 로드
chrome.storage.local.get(['dndMode'], (res) => {
  if (res.dndMode) settings.dndMode = res.dndMode;
});

// 설정 변경 감지 (Popup에서 변경 시)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.dndMode) settings.dndMode = changes.dndMode.newValue;
});

// 아이콘 업데이트 함수
function updateIcon(tabId) {
  const state = tabStates[tabId]?.status || 'IDLE';
  let iconPath = 'assets/bell_profile.png'; // 기본/IDLE/READ
  let badgeText = '';
  let badgeColor = '#000';

  switch (state) {
    case 'GENERATING':
      iconPath = 'assets/bell_pending.png'; // 주황 (진행중)
      badgeText = '...';
      badgeColor = '#FFA500';
      break;
    case 'COMPLETED_UNREAD':
      iconPath = 'assets/bell_unread.png'; // 노랑 (미확인)
      badgeText = '!';
      badgeColor = '#FFD700';
      break;
    case 'COMPLETED_READ':
      iconPath = 'assets/bell_profile.png'; // 녹색/확인됨 (기본으로 복귀)
      badgeText = 'OK';
      badgeColor = '#32CD32';
      break;
  }

  // 아이콘 및 배지 적용
  chrome.action.setIcon({ path: iconPath, tabId: tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: badgeText, tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tabId });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (message.action === "status_update") {
    const prevState = tabStates[tabId]?.status || 'IDLE';
    const newState = message.isGenerating ? 'GENERATING' : 'IDLE';

    // 1. 생성 시작 (IDLE -> GENERATING)
    if (prevState === 'IDLE' && newState === 'GENERATING') {
      tabStates[tabId] = { status: 'GENERATING', platform: message.platform };
      updateIcon(tabId);
    }
    // 2. 생성 완료 (GENERATING -> IDLE)
    else if (prevState === 'GENERATING' && newState === 'IDLE') {
      // 현재 탭을 보고 있는지 확인
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const isActiveTab = tabs.length > 0 && tabs[0].id === tabId;
        
        if (isActiveTab) {
          tabStates[tabId] = { status: 'COMPLETED_READ', platform: message.platform };
        } else {
          tabStates[tabId] = { status: 'COMPLETED_UNREAD', platform: message.platform };
          // 방해 금지 모드가 아닐 때만 알림
          if (!settings.dndMode) sendNotification(message.platform);
        }
        updateIcon(tabId);
      });
    }
  }
});

function sendNotification(platform) {
  let title = "AI 답변 완료";
  if (platform === 'chatgpt') title = "ChatGPT 답변 완료";
  else if (platform === 'gemini') title = "Gemini 답변 완료";
  else if (platform === 'aistudio') title = "AI Studio 답변 완료";

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'assets/bell_notice.png',
    title: title,
    message: "작업이 완료되었습니다. 확인하려면 클릭하세요.",
    priority: 2
  });
}

// 알림 클릭 시 해당 탭으로 이동
chrome.notifications.onClicked.addListener(() => {
  const unreadTabId = Object.keys(tabStates).find(id => tabStates[id].status === 'COMPLETED_UNREAD');
  if (unreadTabId) {
    const tId = parseInt(unreadTabId);
    chrome.tabs.update(tId, { active: true });
    chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
    tabStates[tId].status = 'COMPLETED_READ';
    updateIcon(tId);
  }
});

// 탭 활성화(클릭) 시 읽음 처리
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  if (tabStates[tabId]?.status === 'COMPLETED_UNREAD') {
    tabStates[tabId].status = 'COMPLETED_READ';
    updateIcon(tabId);
  }
});

// 탭 닫힘 정리
chrome.tabs.onRemoved.addListener((tabId) => { delete tabStates[tabId]; });
