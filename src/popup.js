document.addEventListener('DOMContentLoaded', () => {
  const dndToggle = document.getElementById('dnd-toggle');

  // 저장된 설정 불러오기
  chrome.storage.local.get(['dndMode'], (result) => {
    dndToggle.checked = result.dndMode || false;
  });

  // 설정 변경 시 저장
  dndToggle.addEventListener('change', () => {
    chrome.storage.local.set({ dndMode: dndToggle.checked });
  });
});
