let isGenerating = false;
let checkInterval = null;
let completionStatus = 'idle'; // 'idle', 'generating', 'completed'

// 사이트별 "생성 중지" 버튼을 식별하는 셀렉터
const SELECTORS = {
  chatgpt: ['[data-testid="stop-button"]'],
  gemini: ['[aria-label="답변 중지"]', '[aria-label="Stop response"]', '.stop-button'],
  aistudio: ['[aria-label="Cancel"]', '[aria-label="Stop"]', 'button[aria-label="Run"][disabled]']
};

function getPlatform() {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  if (host.includes('aistudio.google.com')) return 'aistudio';
  return null;
}

// 탭 제목(Title)에 배지(이모지) 달기 - 아이콘 바로 옆에 표시됨
function updateTitleBadge() {
  // 1. 현재 제목 가져오기
  const currentTitle = document.title;
  
  // 2. 제목 앞의 🟠, 🟢 및 공백을 모두 제거하여 순수 제목 추출
  // (정규식: 줄 시작(^)에 있는 🟠나 🟢와 공백(\s?)이 하나 이상(+) 있는 경우)
  const cleanTitle = currentTitle.replace(/^([🟠🟢]\s?)+/, "");

  // 3. 상태에 따른 목표 제목 생성
  let targetTitle = cleanTitle;
  if (isGenerating) {
    targetTitle = "🟠 " + cleanTitle;
  } else if (completionStatus === 'completed') {
    targetTitle = "🟢 " + cleanTitle;
  }

  // 4. 현재 제목이 목표와 다를 때만 변경 (이 비교가 무한 루프를 막아줌)
  if (currentTitle !== targetTitle) {
    document.title = targetTitle;
  }
}

function checkStatus() {
  const platform = getPlatform();
  if (!platform) return;

  // 해당 플랫폼의 중지 버튼 후보 중 하나라도 존재하는지 확인
  const selectors = SELECTORS[platform];
  const stopButton = selectors.some(sel => document.querySelector(sel));
  
  const currentlyGenerating = stopButton;

  // 상태가 변했을 때만 처리
  if (isGenerating !== currentlyGenerating) {
    isGenerating = currentlyGenerating;
    
    // 상태 저장
    if (isGenerating) {
      completionStatus = 'generating';
    } else {
      // 생성하다가 멈췄고, 현재 보고 있는 탭이 아니면 완료 상태
      // (보고 있는 탭이면 바로 idle로 처리하여 뱃지 제거)
      if (document.hasFocus()) {
        completionStatus = 'idle';
      } else {
        completionStatus = 'completed';
      }
    }

    // 1. 백그라운드로 알림 전송 (기존 유지)
    chrome.runtime.sendMessage({ 
      action: "status_update", 
      platform: platform,
      isGenerating: isGenerating
    });
  }
  
  // 루프마다 배지 상태 강제 동기화 (사이트가 제목을 바꿔도 다시 덮어씀)
  updateTitleBadge();
}

// 탭 클릭(활성화) 시 배지 제거
window.addEventListener('focus', () => {
  // 생성 중이 아닐 때만 뱃지 제거
  if (!isGenerating) {
    completionStatus = 'idle';
    updateTitleBadge();
  }
});

// DOM 변화를 감지하여 체크 실행 (성능을 위해 1초에 한 번씩만 체크하도록 할 수도 있음)
// 여기서는 MutationObserver를 사용하여 실시간 반응성을 높입니다.
const observer = new MutationObserver(() => {
  checkStatus();
});

// 감시 시작
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// 초기 로드 시 상태 확인
checkStatus();
console.log("AI 답변 감시자가 시작되었습니다.");
