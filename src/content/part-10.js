var STEERING_UI_MARKUP_TEMPLATE = `
    <div class="dock" data-theme="dark">
      <div class="launcher-row" id="ready-ai-steering-launcher-row">
        <button class="launcher" type="button" id="ready-ai-steering-launcher">
          <span class="dot"></span>
          <span class="launcher-text">
            <span class="launcher-title-row">
              <strong id="ready-ai-steering-launcher-title">후속 지시 열기</strong>
              <span class="launcher-count" id="ready-ai-steering-launcher-count">대기 : 0</span>
            </span>
            <small id="ready-ai-steering-launcher-sub">항상 열어둘 수 있는 후속 지시 패널</small>
          </span>
        </button>
      </div>
      <div class="card" id="ready-ai-steering-card">
        <div class="top">
          <div class="top-main">
            <div class="title-row">
              <div class="title" id="ready-ai-steering-title"></div>
              <div class="meta" id="ready-ai-steering-meta">대기 : 0</div>
            </div>
          </div>
          <button class="icon-btn" type="button" id="ready-ai-steering-close" aria-label="접기">×</button>
        </div>
        <div class="title-edit-card">
          <div class="title-edit-head">
            <span class="title-edit-label"><span class="title-label-badge" aria-hidden="true">⚪</span><span>크롬 탭 이름변경</span></span>
          </div>
          <div class="title-edit">
            <input class="title-input" id="ready-ai-steering-tab-title-input" type="text" maxlength="80" placeholder="변경할 크롬 탭 이름 입력" />
            <button class="title-btn" type="button" id="ready-ai-steering-tab-title-save">이름 변경</button>
            <button class="title-btn subtle" type="button" id="ready-ai-steering-tab-title-clear">해제</button>
          </div>
          <div class="title-meta" id="ready-ai-steering-tab-title-meta">크롬 탭 이름 자동</div>
        </div>
        <textarea class="input" id="ready-ai-steering-input" placeholder="후속 지시 입력 · 이미지 드래그 가능"></textarea>
        <div class="drop-shield" id="ready-ai-steering-drop-shield" hidden>여기에 놓으면 이미지 첨부</div>
        <div class="template-wrap" id="ready-ai-steering-template-wrap">
          <div class="template-head">
            <div class="template-label">대기 템플릿</div>
            <div class="template-sub" id="ready-ai-steering-template-meta">버튼 클릭 시 바로 대기열에 추가</div>
          </div>
          <div class="template-list" id="ready-ai-steering-template-list"></div>
        </div>
        <div class="attachment-wrap" id="ready-ai-steering-attachment-wrap">
          <div class="attachment-top">
            <div class="attachment-meta-line" id="ready-ai-steering-attachment-meta">이미지를 드래그앤드롭하여 추가</div>
            <div class="attachment-actions">
              <button class="attachment-btn" type="button" id="ready-ai-steering-add-image">이미지 추가</button>
              <button class="attachment-btn" type="button" id="ready-ai-steering-clear-images">이미지 비우기</button>
            </div>
          </div>
          <input class="file-input" id="ready-ai-steering-image-file" type="file" accept="image/*" multiple />
          <div class="attachment-list" id="ready-ai-steering-attachment-list"></div>
        </div>
        <div class="actions">
          <button class="btn" type="button" id="ready-ai-steering-primary">Enter</button>
          <button class="btn secondary" type="button" id="ready-ai-steering-send-now">지금전송</button>
          <button class="btn subtle" type="button" id="ready-ai-steering-clear">전체비우기</button>
        </div>
        <div class="status" id="ready-ai-steering-status"></div>
        <div class="advanced-card" id="ready-ai-steering-advanced-card">
          <div class="advanced-toggle-row">
            <div class="advanced-copy">
              <div class="advanced-title">후속 지시 고급설정</div>
              <div class="advanced-sub">ON이면 새 ChatGPT 채팅 탭으로 분산 전송</div>
            </div>
            <label class="advanced-switch" title="후속 지시 고급설정 켜기/끄기">
              <input type="checkbox" id="ready-ai-steering-advanced-toggle" />
              <span></span>
            </label>
          </div>
          <div class="advanced-body" id="ready-ai-steering-advanced-body">
            <div class="advanced-field-row">
              <label for="ready-ai-steering-new-chat-count">새 채팅 탭 수</label>
              <input id="ready-ai-steering-new-chat-count" type="number" min="1" max="8" step="1" value="3" inputmode="numeric" />
              <button class="advanced-btn" type="button" id="ready-ai-steering-new-chat-send">새 채팅으로 보내기</button>
            </div>
            <div class="advanced-hint">기본 Enter도 고급설정 ON에서는 현재 대화가 아니라 새 채팅 탭으로 보냅니다. 이미지는 현재 대화 전송만 지원합니다.</div>
          </div>
        </div>
      </div>
      <div class="attachment-preview" id="ready-ai-steering-attachment-preview" hidden>
        <div class="attachment-preview-card">
          <div class="attachment-preview-head">
            <div class="attachment-preview-title">이미지 미리보기</div>
            <button class="attachment-preview-close" type="button" id="ready-ai-steering-attachment-preview-close" aria-label="닫기">×</button>
          </div>
          <div class="attachment-preview-body">
            <button class="attachment-preview-nav" type="button" id="ready-ai-steering-attachment-preview-prev">‹</button>
            <img class="attachment-preview-image" id="ready-ai-steering-attachment-preview-image" alt="preview" />
            <button class="attachment-preview-nav" type="button" id="ready-ai-steering-attachment-preview-next">›</button>
          </div>
          <div class="attachment-preview-meta" id="ready-ai-steering-attachment-preview-meta"></div>
        </div>
      </div>
      <div class="queue-wrap" id="ready-ai-steering-queue-wrap">
        <div class="queue-head">
          <div class="queue-label">대기 목록</div>
          <div class="queue-head-actions">
            <button class="queue-head-btn" type="button" id="ready-ai-steering-run-next">다음 전송</button>
            <button class="queue-head-btn danger" type="button" id="ready-ai-steering-clear-queue">모두 삭제</button>
          </div>
        </div>
        <div class="queue-list" id="ready-ai-steering-queue"></div>
      </div>
    </div>
`;
function reuseExistingSteeringUi() {
  if (!steeringHost || !steeringRoot || !steeringRefs) return null;
  if (!steeringHost.isConnected) {
    try { (document.body || document.documentElement).appendChild(steeringHost); } catch (_) {}
  }
  restoreSteeringDraftToInput();
  applySteeringTheme();
  positionSteeringUi();
  renderSteeringQueue();
  renderSteeringTemplates();
  renderSteeringAttachments();
  syncSteeringAttachmentPreview();
  return steeringRefs;
}
function createSteeringUiHost() {
  steeringHost = document.createElement('div');
  steeringHost.id = 'ready-ai-steering-host';
  steeringHost.style.position = 'fixed';
  steeringHost.style.right = '18px';
  steeringHost.style.bottom = '140px';
  steeringHost.style.left = 'auto';
  steeringHost.style.transform = 'none';
  steeringHost.style.zIndex = '2147483647';
  steeringHost.style.display = 'none';
  steeringRoot = steeringHost.attachShadow({ mode: 'open' });
  steeringRoot.innerHTML = STEERING_UI_STYLE_TEMPLATE_A + STEERING_UI_STYLE_TEMPLATE_B + STEERING_UI_MARKUP_TEMPLATE;
}
function buildSteeringRefs() {
  steeringRefs = {
    title: steeringRoot.getElementById('ready-ai-steering-title'),
    meta: steeringRoot.getElementById('ready-ai-steering-meta'),
    launcherCount: steeringRoot.getElementById('ready-ai-steering-launcher-count'),
    launcherRow: steeringRoot.getElementById('ready-ai-steering-launcher-row'),
    launcher: steeringRoot.getElementById('ready-ai-steering-launcher'),
    launcherTitle: steeringRoot.getElementById('ready-ai-steering-launcher-title'),
    launcherSub: steeringRoot.getElementById('ready-ai-steering-launcher-sub'),
    card: steeringRoot.getElementById('ready-ai-steering-card'),
    input: steeringRoot.getElementById('ready-ai-steering-input'),
    dropShield: steeringRoot.getElementById('ready-ai-steering-drop-shield'),
    templateWrap: steeringRoot.getElementById('ready-ai-steering-template-wrap'),
    templateMeta: steeringRoot.getElementById('ready-ai-steering-template-meta'),
    templateList: steeringRoot.getElementById('ready-ai-steering-template-list'),
    attachmentWrap: steeringRoot.getElementById('ready-ai-steering-attachment-wrap'),
    attachmentMeta: steeringRoot.getElementById('ready-ai-steering-attachment-meta'),
    attachmentList: steeringRoot.getElementById('ready-ai-steering-attachment-list'),
    addImage: steeringRoot.getElementById('ready-ai-steering-add-image'),
    clearAttachments: steeringRoot.getElementById('ready-ai-steering-clear-images'),
    fileInput: steeringRoot.getElementById('ready-ai-steering-image-file'),
    attachmentPreview: steeringRoot.getElementById('ready-ai-steering-attachment-preview'),
    attachmentPreviewImage: steeringRoot.getElementById('ready-ai-steering-attachment-preview-image'),
    attachmentPreviewMeta: steeringRoot.getElementById('ready-ai-steering-attachment-preview-meta'),
    attachmentPreviewClose: steeringRoot.getElementById('ready-ai-steering-attachment-preview-close'),
    attachmentPreviewPrev: steeringRoot.getElementById('ready-ai-steering-attachment-preview-prev'),
    attachmentPreviewNext: steeringRoot.getElementById('ready-ai-steering-attachment-preview-next'),
    tabTitleInput: steeringRoot.getElementById('ready-ai-steering-tab-title-input'),
    tabTitleSave: steeringRoot.getElementById('ready-ai-steering-tab-title-save'),
    tabTitleClear: steeringRoot.getElementById('ready-ai-steering-tab-title-clear'),
    tabTitlePresets: Array.from(steeringRoot.querySelectorAll('[data-preset-title]')),
    tabTitleMeta: steeringRoot.getElementById('ready-ai-steering-tab-title-meta'),
    advancedCard: steeringRoot.getElementById('ready-ai-steering-advanced-card'),
    advancedToggle: steeringRoot.getElementById('ready-ai-steering-advanced-toggle'),
    advancedBody: steeringRoot.getElementById('ready-ai-steering-advanced-body'),
    newChatCount: steeringRoot.getElementById('ready-ai-steering-new-chat-count'),
    newChatSend: steeringRoot.getElementById('ready-ai-steering-new-chat-send'),
    primary: steeringRoot.getElementById('ready-ai-steering-primary'),
    sendNow: steeringRoot.getElementById('ready-ai-steering-send-now'),
    clear: steeringRoot.getElementById('ready-ai-steering-clear'),
    queueWrap: steeringRoot.getElementById('ready-ai-steering-queue-wrap'),
    queue: steeringRoot.getElementById('ready-ai-steering-queue'),
    runNext: steeringRoot.getElementById('ready-ai-steering-run-next'),
    clearQueue: steeringRoot.getElementById('ready-ai-steering-clear-queue'),
    close: steeringRoot.getElementById('ready-ai-steering-close'),
    status: steeringRoot.getElementById('ready-ai-steering-status'),
  };
  return steeringRefs;
}
function bindSteeringUiEvents() {
  const consume = (handler) => (event) => {
    try { event.preventDefault(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
    handler?.(event);
  };
  steeringRefs.launcher.addEventListener('click', consume(() => {
    steeringPanelOpen = !steeringPanelOpen;
    updateSteeringUi();
    if (steeringPanelOpen && steeringAutoFocusInput) {
      try { steeringRefs.input.focus(); } catch (_) {}
    }
  }));
  steeringRefs.close.addEventListener('click', consume(() => {
    steeringPanelOpen = false;
    updateSteeringUi();
  }));
  steeringRefs.tabTitleSave?.addEventListener('click', consume(() => {
    saveCustomTabTitleFromInput();
  }));
  steeringRefs.addImage?.addEventListener('click', consume(() => {
    try { steeringRefs.fileInput?.click(); } catch (_) {}
  }));
  steeringRefs.clearAttachments?.addEventListener('click', consume(() => {
    clearSteeringDraftAttachments();
    setSteeringStatus('이미지를 모두 비웠습니다.');
    updateSteeringUi();
  }));
  steeringRefs.fileInput?.addEventListener('change', async (event) => {
    const files = Array.from(event?.target?.files || []);
    await addSteeringAttachments(files);
  });
  steeringRefs.tabTitleClear?.addEventListener('click', consume(() => {
    clearCustomTabTitleOverride();
  }));
  steeringRefs.tabTitlePresets?.forEach((btn) => {
    btn.addEventListener('click', consume(() => {
      const rawPreset = String(btn.getAttribute('data-preset-title') || '').trim();
      const preset = rawPreset === '최근' ? normalizeCustomTabTitle(lastCustomTabTitle || customTabTitle || '') : rawPreset;
      if (!preset) {
        setSteeringStatus('최근 변경 이름이 없습니다.', true);
        return;
      }
      if (steeringRefs.tabTitleInput) steeringRefs.tabTitleInput.value = preset;
      saveCustomTabTitleFromInput();
    }));
  });
  steeringRefs.tabTitleInput?.addEventListener('keydown', (event) => {
    try { event.stopPropagation(); } catch (_) {}
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      try { event.preventDefault(); } catch (_) {}
      try { steeringRefs.tabTitleInput.value = customTabTitle || ''; } catch (_) {}
      return;
    }
    if (event.key !== 'Enter') return;
    try { event.preventDefault(); } catch (_) {}
    saveCustomTabTitleFromInput();
  });
  steeringRefs.advancedToggle?.addEventListener('change', consume(() => {
    setSteeringAdvancedEnabled(!!steeringRefs.advancedToggle.checked);
  }));
  steeringRefs.newChatCount?.addEventListener('change', consume(() => {
    setSteeringNewChatTabCountValue(steeringRefs.newChatCount.value);
  }));
  steeringRefs.newChatCount?.addEventListener('keydown', (event) => {
    try { event.stopPropagation(); } catch (_) {}
    if (event.isComposing || event.key !== 'Enter') return;
    try { event.preventDefault(); } catch (_) {}
    setSteeringNewChatTabCountValue(steeringRefs.newChatCount.value);
  });
  steeringRefs.newChatSend?.addEventListener('click', consume(() => {
    submitSteeringInputToNewChats();
  }));
  steeringRefs.primary.addEventListener('click', consume(() => {
    submitSteeringInput();
  }));
  steeringRefs.sendNow.addEventListener('click', consume(async () => {
    const refs = ensureSteeringUi();
    const text = String(refs?.input?.value || '').trim();
    const images = cloneSteeringImagesForQueue();
    if (text || images.length) {
      enqueueSteeringPrompt(text, { images });
      setSteeringDraftText('');
      try { refs.input.value = ''; } catch (_) {}
      clearSteeringDraftAttachments();
    }
    const ok = await processSteeringQueue({ source: 'manual' });
    if (!ok && !steeringQueue.length) setSteeringStatus('전송할 대기가 없습니다.', true);
  }));
  steeringRefs.clear.addEventListener('click', consume(() => {
    clearSteeringQueue(true);
  }));
  steeringRefs.runNext.addEventListener('click', consume(async () => {
    const ok = await processSteeringQueue({ source: 'manual' });
    if (!ok) setSteeringStatus(steeringQueue.length ? '지금은 전송할 수 없습니다.' : '전송할 대기가 없습니다.', true);
  }));
  steeringRefs.clearQueue.addEventListener('click', consume(() => {
    clearSteeringQueue(true);
  }));
  steeringRefs.attachmentPreviewClose?.addEventListener('click', consume(() => {
    closeSteeringAttachmentPreview();
  }));
  steeringRefs.attachmentPreviewPrev?.addEventListener('click', consume(() => {
    stepSteeringAttachmentPreview(-1);
  }));
  steeringRefs.attachmentPreviewNext?.addEventListener('click', consume(() => {
    stepSteeringAttachmentPreview(1);
  }));
  steeringRefs.attachmentPreview?.addEventListener('click', (event) => {
    if (event.target !== steeringRefs.attachmentPreview) return;
    try { event.preventDefault(); } catch (_) {}
    closeSteeringAttachmentPreview();
  });
  steeringRoot.addEventListener('keydown', (event) => {
    if (!steeringPreviewAttachmentId) return;
    if (event.key === 'Escape') {
      try { event.preventDefault(); } catch (_) {}
      closeSteeringAttachmentPreview();
      return;
    }
    if (event.key === 'ArrowLeft') {
      try { event.preventDefault(); } catch (_) {}
      stepSteeringAttachmentPreview(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      try { event.preventDefault(); } catch (_) {}
      stepSteeringAttachmentPreview(1);
    }
  });
  const stopSteeringDragEvent = (event) => {
    try { event.preventDefault(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
    try { event.stopImmediatePropagation?.(); } catch (_) {}
  };
  const handleSteeringAttachmentDragEnter = (event) => {
    stopSteeringDragEvent(event);
    setSteeringDragActive(true);
  };
  const handleSteeringAttachmentDragOver = (event) => {
    stopSteeringDragEvent(event);
    setSteeringDragActive(true);
  };
  const handleSteeringAttachmentDragLeave = (event) => {
    stopSteeringDragEvent(event);
    setSteeringDragActive(false);
  };
  const handleSteeringAttachmentDrop = async (event) => {
    stopSteeringDragEvent(event);
    setSteeringDragActive(false);
    armSteeringDropPointerGuard();
    const files = extractImageFilesFromTransfer(event.dataTransfer);
    await addSteeringAttachments(files);
  };
  [steeringRefs.card, steeringRefs.attachmentWrap, steeringRefs.input, steeringRefs.dropShield].forEach((target) => {
    target?.addEventListener('dragenter', handleSteeringAttachmentDragEnter, true);
    target?.addEventListener('dragover', handleSteeringAttachmentDragOver, true);
    target?.addEventListener('dragleave', handleSteeringAttachmentDragLeave, true);
    target?.addEventListener('drop', handleSteeringAttachmentDrop, true);
  });
  steeringRefs.input.addEventListener('paste', async (event) => {
    const files = extractImageFilesFromTransfer(event.clipboardData);
    if (!files.length) return;
    try { event.preventDefault(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
    await addSteeringAttachments(files);
  });
  steeringRefs.input.addEventListener('input', () => {
    syncSteeringDraftFromInput();
    updateSteeringUi();
  });
  steeringRefs.input.addEventListener('keydown', (event) => {
    try { event.stopPropagation(); } catch (_) {}
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      try { event.preventDefault(); } catch (_) {}
      steeringPanelOpen = false;
      updateSteeringUi();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    try { event.preventDefault(); } catch (_) {}
    submitSteeringInput();
  });
}
