function cloneSteeringImagesForQueue() {
  return steeringAttachments.map((item) => ({
    name: item.name,
    size: item.size,
    type: item.type,
    file: item.file,
  }));
}
function renderSteeringAttachments() {
  if (!steeringRefs?.attachmentWrap || !steeringRefs?.attachmentList || !steeringRefs?.attachmentMeta) return;
  const list = steeringAttachments.slice();
  const totalBytes = list.reduce((sum, item) => sum + Math.max(0, Number(item?.size) || 0), 0);
  const metaText = list.length ? `이미지 ${list.length}/${STEERING_IMAGE_LIMIT} · 총 ${formatSteeringBytes(totalBytes)}` : '이미지를 드래그앤드롭하여 추가';
  const nextDisplay = (steeringPanelOpen || list.length) ? 'flex' : 'none';
  const signature = JSON.stringify({
    open: !!steeringPanelOpen,
    list: list.map((item) => [item.id, item.name, item.size, item.width, item.height, !!item.optimized, !!item.previewUrl]),
  });
  steeringRefs.attachmentWrap.style.display = nextDisplay;
  if (steeringRefs.attachmentMeta.textContent !== metaText) steeringRefs.attachmentMeta.textContent = metaText;
  if (steeringRefs.clearAttachments) steeringRefs.clearAttachments.disabled = !list.length;
  if (steeringAttachmentRenderSignature === signature) return;
  steeringAttachmentRenderSignature = signature;
  steeringRefs.attachmentList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (const item of list) {
    const chip = document.createElement('div');
    chip.className = 'attachment-item';
    const thumb = document.createElement(item.previewUrl ? 'img' : 'div');
    thumb.className = 'attachment-thumb';
    if (item.previewUrl) {
      thumb.src = item.previewUrl;
      thumb.alt = item.name;
      thumb.loading = 'lazy';
      try { thumb.decoding = 'async'; } catch (_) {}
    } else {
      thumb.textContent = 'IMG';
    }
    thumb.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      openSteeringAttachmentPreview(item.id);
    });
    const meta = document.createElement('div');
    meta.className = 'attachment-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'attachment-name';
    nameEl.textContent = item.name;
    const subEl = document.createElement('div');
    subEl.className = 'attachment-sub';
    subEl.textContent = getSteeringAttachmentMetaText(item);
    meta.appendChild(nameEl);
    meta.appendChild(subEl);
    const actionWrap = document.createElement('div');
    actionWrap.className = 'attachment-row-actions';
    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'attachment-mini-btn';
    moveUpBtn.textContent = '↑';
    moveUpBtn.title = '앞으로 이동';
    moveUpBtn.disabled = list[0]?.id === item.id;
    moveUpBtn.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      moveSteeringAttachment(item.id, -1);
    });
    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'attachment-mini-btn';
    moveDownBtn.textContent = '↓';
    moveDownBtn.title = '뒤로 이동';
    moveDownBtn.disabled = list[list.length - 1]?.id === item.id;
    moveDownBtn.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      moveSteeringAttachment(item.id, 1);
    });
    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'attachment-mini-btn';
    previewBtn.textContent = '보기';
    previewBtn.title = '크게 보기';
    previewBtn.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      openSteeringAttachmentPreview(item.id);
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'attachment-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', '이미지 제거');
    removeBtn.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      removeSteeringAttachment(item.id);
    });
    actionWrap.appendChild(moveUpBtn);
    actionWrap.appendChild(moveDownBtn);
    actionWrap.appendChild(previewBtn);
    actionWrap.appendChild(removeBtn);
    chip.appendChild(thumb);
    chip.appendChild(meta);
    chip.appendChild(actionWrap);
    fragment.appendChild(chip);
  }
  steeringRefs.attachmentList.appendChild(fragment);
}
function renderSteeringQueue() {
  if (!steeringRefs?.queueWrap || !steeringRefs?.queue) return;
  syncSteeringQueueEditState();
  const nextDisplay = (steeringPanelOpen && steeringQueue.length) ? 'flex' : 'none';
  const signature = JSON.stringify({
    open: !!steeringPanelOpen,
    editingId: steeringQueueEditingId,
    editingText: steeringQueueEditingId == null ? '' : String(steeringQueueEditingText || ''),
    queue: steeringQueue.map((item) => [item?.id, String(item?.text || '').trim(), getSteeringItemAttachmentCount(item)]),
  });
  steeringRefs.queueWrap.style.display = nextDisplay;
  if (steeringQueueRenderSignature === signature) return;
  steeringQueueRenderSignature = signature;
  steeringRefs.queue.innerHTML = '';
  if (!steeringQueue.length) return;
  const fragment = document.createDocumentFragment();
  steeringQueue.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.addEventListener('dblclick', (event) => {
      const target = event?.target;
      if (target?.closest?.('button, input')) return;
      beginSteeringQueueEdit(item.id);
    });
    const isEditing = item?.id === steeringQueueEditingId;
    if (isEditing) row.classList.add('editing');
    row.setAttribute('data-queue-id', String(item?.id || ''));
    const order = document.createElement('span');
    order.className = 'queue-order';
    order.textContent = String(index + 1);
    const body = document.createElement('div');
    body.className = 'queue-body';
    const textEl = document.createElement('div');
    textEl.className = 'queue-text';
    textEl.textContent = getSteeringItemSummary(item);
    textEl.title = '더블클릭해서 수정';
    textEl.addEventListener('dblclick', () => {
      beginSteeringQueueEdit(item.id);
    });
    body.appendChild(textEl);
    if (isEditing) {
      const editWrap = document.createElement('div');
      editWrap.className = 'queue-edit-wrap';
      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.className = 'queue-edit-input';
      editInput.value = String(steeringQueueEditingText || '');
      editInput.placeholder = getSteeringItemAttachmentCount(item) ? '텍스트 없이 이미지 대기만 둘 수 있습니다.' : '대기 문구 수정';
      editInput.setAttribute('aria-label', '대기 수정');
      editInput.addEventListener('input', () => {
        syncSteeringQueueEditDraft(editInput.value || '');
      });
      editInput.addEventListener('keydown', (event) => {
        try { event.stopPropagation(); } catch (_) {}
        if (event.isComposing) return;
        if (event.key === 'Escape') {
          try { event.preventDefault(); } catch (_) {}
          cancelSteeringQueueEdit();
          return;
        }
        if (event.key !== 'Enter') return;
        try { event.preventDefault(); } catch (_) {}
        commitSteeringQueueEdit();
      });
      editWrap.appendChild(editInput);
      if (getSteeringItemAttachmentCount(item)) {
        const helper = document.createElement('div');
        helper.className = 'queue-edit-meta';
        helper.textContent = `첨부 이미지 ${getSteeringItemAttachmentCount(item)}개 유지`;
        editWrap.appendChild(helper);
      }
      body.appendChild(editWrap);
      window.setTimeout(() => {
        try {
          if (steeringQueueEditingId !== item.id) return;
          editInput.focus();
          editInput.setSelectionRange(editInput.value.length, editInput.value.length);
        } catch (_) {}
      }, 0);
    }
    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    const makeActionBtn = (label, title, handler, extraClass = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `queue-action ${extraClass}`.trim();
      btn.textContent = label;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', (event) => {
        try { event.preventDefault(); } catch (_) {}
        try { event.stopPropagation(); } catch (_) {}
        handler?.();
      });
      return btn;
    };
    actions.appendChild(makeActionBtn('↑', '위로 이동', () => moveSteeringQueueItem(item.id, -1), isEditing ? 'hidden' : ''));
    actions.appendChild(makeActionBtn('↓', '아래로 이동', () => moveSteeringQueueItem(item.id, 1), isEditing ? 'hidden' : ''));
    if (isEditing) {
      actions.appendChild(makeActionBtn('저장', '수정 저장', () => commitSteeringQueueEdit(), 'solid'));
      actions.appendChild(makeActionBtn('취소', '수정 취소', () => cancelSteeringQueueEdit(), 'muted'));
    }
    actions.appendChild(makeActionBtn('×', '대기 삭제', () => {
      steeringQueue = steeringQueue.filter((queued) => queued.id !== item.id);
      syncSteeringQueueEditState();
      setSteeringStatus(steeringQueue.length ? `${getSteeringQueueCountLabel()}` : '대기를 비웠습니다.');
      updateSteeringUi();
    }, 'danger'));
    row.appendChild(order);
    row.appendChild(body);
    row.appendChild(actions);
    fragment.appendChild(row);
  });
  steeringRefs.queue.appendChild(fragment);
}
function enqueueSteeringPrompt(text, options = {}) {
  const value = String(text || '').trim();
  const images = Array.isArray(options.images) ? options.images.filter((item) => item?.file) : [];
  if (!value && !images.length) return null;
  const item = {
    id: steeringQueueSeq++,
    text: value,
    images,
    createdAt: Date.now(),
    retryCount: 0,
  };
  steeringQueue = [...steeringQueue, item];
  return item;
}
function clearSteeringQueue(showStatus = true) {
  steeringQueue = [];
  cancelSteeringQueueEdit({ silent: true });
  setSteeringDraftText('');
  clearSteeringDraftAttachments();
  try {
    if (steeringRefs?.input) steeringRefs.input.value = '';
  } catch (_) {}
  if (showStatus) setSteeringStatus('대기를 모두 비웠습니다.');
  updateSteeringUi();
}
function moveSteeringQueueItem(itemId, direction) {
  const index = steeringQueue.findIndex((item) => item?.id === itemId);
  if (index < 0) return false;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= steeringQueue.length) return false;
  const list = steeringQueue.slice();
  const [picked] = list.splice(index, 1);
  list.splice(nextIndex, 0, picked);
  steeringQueue = list;
  syncSteeringQueueEditState();
  updateSteeringUi();
  return true;
}
function scheduleSteeringQueueProcessing(delay = STEERING_AUTO_SEND_DELAY_MS) {
  clearSteeringAutoSendTimer();
  if (!monitoring || !steeringEnabled) return;
  if (!steeringQueue.length) return;
  if (!canAutoSendSteeringNow()) return;
  steeringAutoSendTimer = setTimeout(() => {
    steeringAutoSendTimer = null;
    processSteeringQueue({ source: 'auto' });
  }, Math.max(0, delay));
}
function getFileInputSelectors(siteKey) {
  if (siteKey === 'chatgpt') {
    return ['input[type="file"][accept*="image"]', 'form input[type="file"]', 'input[type="file"]'];
  }
  if (siteKey === 'gemini' || siteKey === 'aistudio' || siteKey === 'claude') {
    return ['input[type="file"][accept*="image"]', 'input[type="file"]'];
  }
  return ['input[type="file"][accept*="image"]', 'input[type="file"]'];
}
function scoreFileInputCandidate(el, composer) {
  if (!el || String(el.tagName || '').toLowerCase() !== 'input') return -999;
  if (String(el.type || '').toLowerCase() !== 'file') return -999;
  if (el.disabled) return -999;
  let score = 0;
  const accept = String(el.getAttribute?.('accept') || '').toLowerCase();
  const cls = String(el.className || '').toLowerCase();
  const name = String(el.getAttribute?.('name') || '').toLowerCase();
  const aria = String(el.getAttribute?.('aria-label') || '').toLowerCase();
  const hay = `${accept} ${cls} ${name} ${aria}`;
  if (!accept || accept.includes('image') || accept.includes('*/*')) score += 6;
  if (hay.includes('attach') || hay.includes('upload') || hay.includes('image') || hay.includes('photo') || hay.includes('첨부') || hay.includes('이미지')) score += 3;
  if (el.multiple) score += 1;
  const form = getComposerSubmitForm(composer);
  try { if (form && form.contains(el)) score += 5; } catch (_) {}
  try {
    const wrap = composer?.closest?.('[data-testid], [role="group"], [role="presentation"], form, section, main, article, div');
    if (wrap && wrap.contains(el)) score += 3;
  } catch (_) {}
  try {
    const cr = composer?.getBoundingClientRect?.();
    const ir = el.getBoundingClientRect?.();
    if (cr && ir && ir.width >= 0 && ir.height >= 0) {
      const dx = Math.abs(ir.left - cr.left) + Math.abs(ir.right - cr.right);
      const dy = Math.abs(ir.top - cr.bottom);
      if (dx < 600) score += 1;
      if (dy < 300) score += 1;
    }
  } catch (_) {}
  return score;
}
function findNearbyFileInput(composer) {
  const selectors = getFileInputSelectors(getSiteKey());
  let best = null;
  let bestScore = -999;
  for (const selector of selectors) {
    const candidates = qsa(selector);
    for (const input of candidates) {
      const score = scoreFileInputCandidate(input, composer);
      if (score > bestScore) {
        best = input;
        bestScore = score;
      }
    }
  }
  return bestScore >= 4 ? best : null;
}
