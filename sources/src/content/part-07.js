function createFileListFromFiles(files) {
  const dt = new DataTransfer();
  for (const file of files) {
    try { dt.items.add(file); } catch (_) {}
  }
  return dt.files;
}
function findAttachmentRevealButton(composer) {
  const scopes = [getComposerSubmitForm(composer), composer?.parentElement, composer?.closest?.('[data-testid], [role="group"], [role="presentation"], form, section, main, article, div') || null, document];
  let best = null;
  let bestScore = -999;
  for (const scope of scopes) {
    if (!scope || typeof scope.querySelectorAll !== 'function') continue;
    const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'));
    for (const btn of buttons) {
      if (!btn || !isVisible(btn) || !isEnabledButtonLike(btn)) continue;
      const hay = `${btn.getAttribute?.('aria-label') || ''} ${btn.getAttribute?.('title') || ''} ${btn.getAttribute?.('data-testid') || ''} ${btn.textContent || ''}`.toLowerCase();
      if (!/(attach|upload|image|photo|gallery|file|첨부|업로드|이미지|사진)/.test(hay)) continue;
      if (/(send|전송|stop|중지|cancel|abort|voice|mic)/.test(hay)) continue;
      let score = 0;
      if (/(attach|첨부)/.test(hay)) score += 4;
      if (/(upload|업로드|image|photo|gallery|이미지|사진)/.test(hay)) score += 3;
      if (/(plus|add|추가)/.test(hay)) score += 1;
      if (score > bestScore) {
        best = btn;
        bestScore = score;
      }
    }
    if (best && bestScore >= 4) return best;
  }
  return bestScore >= 4 ? best : null;
}
async function attachSteeringImagesViaFileInput(composer, imageItems) {
  if (!Array.isArray(imageItems) || !imageItems.length) return { ok: true, attachedCount: 0, message: '' };
  let input = findNearbyFileInput(composer);
  if (!input) {
    const revealButton = findAttachmentRevealButton(composer);
    if (revealButton) {
      try { revealButton.click(); } catch (_) {}
      await waitForSteeringTick(180);
      input = findNearbyFileInput(composer);
    }
  }
  if (!input) {
    return { ok: false, attachedCount: 0, message: '이 사이트에서 이미지 업로드 입력을 찾지 못했습니다.' };
  }
  const files = imageItems.map((item) => item?.file).filter(Boolean);
  if (!files.length) return { ok: true, attachedCount: 0, message: '' };
  const usableFiles = input.multiple ? files : files.slice(0, 1);
  let fileList;
  try { fileList = createFileListFromFiles(usableFiles); } catch (_) { fileList = null; }
  if (!fileList || !fileList.length) {
    return { ok: false, attachedCount: 0, message: '이미지 파일 목록을 만들지 못했습니다.' };
  }
  try { input.files = fileList; } catch (_) {
    return { ok: false, attachedCount: 0, message: '이미지를 업로드 입력에 넣지 못했습니다.' };
  }
  try { input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch (_) {}
  try { input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch (_) {}
  await waitForSteeringTick(220);
  return {
    ok: true,
    attachedCount: usableFiles.length,
    message: usableFiles.length < files.length ? `이미지 ${usableFiles.length}개만 업로드했습니다.` : `이미지 ${usableFiles.length}개 업로드 준비됨`,
  };
}
function getSteeringAttachmentUploadScope(composer) {
  const form = getComposerSubmitForm(composer);
  if (form && isVisible(form)) return form;
  try {
    const scope = composer?.closest?.('[data-testid], [role="group"], [role="presentation"], form, section, main, article, div');
    if (scope && isVisible(scope)) return scope;
  } catch (_) {}
  return document;
}
function hasSteeringPendingUploadIndicator(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return false;
  const indicatorSelectors = [
    '[role="progressbar"]',
    'progress',
    '[aria-busy="true"]',
    '[data-testid*="upload"]',
    '[data-testid*="progress"]',
    '[class*="uploading"]',
    '[class*="progress"]',
    '[class*="spinner"]',
    '[class*="loading"]',
  ];
  for (const selector of indicatorSelectors) {
    const nodes = Array.from(scope.querySelectorAll(selector));
    if (nodes.some((node) => isVisible(node))) return true;
  }
  const textSelectors = ['[role="status"]', '[role="alert"]', '[aria-live]', 'button', 'span', 'div'];
  const pendingTextRe = /(uploading|processing|preparing|analyzing|rendering|업로드 중|처리 중|준비 중|분석 중|렌더링 중)/i;
  const nodes = Array.from(scope.querySelectorAll(textSelectors.join(','))).slice(0, 180);
  for (const node of nodes) {
    if (!isVisible(node)) continue;
    const hay = `${node.getAttribute?.('aria-label') || ''} ${node.getAttribute?.('title') || ''} ${node.textContent || ''}`.trim();
    if (!hay) continue;
    if (pendingTextRe.test(hay)) return true;
  }
  return false;
}
function getSteeringAttachmentUploadState(composer) {
  const scope = getSteeringAttachmentUploadScope(composer);
  const sendButton = getActiveSendButton() || findNearbySendButton(composer) || findNearbySendButtonAnyState(composer);
  const sendFound = !!sendButton;
  const sendEnabled = !!(sendButton && isEnabledButtonLike(sendButton));
  const pending = hasSteeringPendingUploadIndicator(scope);
  return { scope, sendButton, sendFound, sendEnabled, pending };
}
async function waitForSteeringAttachmentUploadReady(composer, options = {}) {
  const timeout = Math.max(2500, Number(options.timeout) || 18000);
  const minWait = Math.max(320, Number(options.minWait) || 520);
  const settleWindow = Math.max(360, Number(options.settleWindow) || 620);
  const startedAt = Date.now();
  let lastBusyAt = startedAt;
  let sawPending = false;
  let sawDisabledSend = false;
  while (Date.now() - startedAt <= timeout) {
    try { maybeRescanShadowRoots(); } catch (_) {}
    const state = getSteeringAttachmentUploadState(composer);
    if (state.pending) {
      sawPending = true;
      lastBusyAt = Date.now();
    }
    if (state.sendFound && !state.sendEnabled) {
      sawDisabledSend = true;
      lastBusyAt = Date.now();
    }
    const elapsed = Date.now() - startedAt;
    const settledFor = Date.now() - lastBusyAt;
    const ready = elapsed >= minWait && settledFor >= settleWindow && !state.pending && (!state.sendFound || state.sendEnabled);
    if (ready) {
      return {
        ok: true,
        waitedMs: elapsed,
        sawPending,
        sawDisabledSend,
      };
    }
    await waitForSteeringTick((state.pending || (state.sendFound && !state.sendEnabled)) ? 150 : 110);
  }
  return {
    ok: false,
    retryable: true,
    message: sawPending || sawDisabledSend ? '이미지 업로드가 아직 끝나지 않았습니다.' : '이미지 업로드 완료 상태를 확인하지 못했습니다.',
    waitedMs: Date.now() - startedAt,
    sawPending,
    sawDisabledSend,
  };
}
async function sendSteeringPromptText(text, options = {}) {
  const composer = getActiveComposer();
  if (!composer) {
    return { ok: false, sent: false, message: '현재 페이지에서 입력창을 찾지 못했습니다.' };
  }
  const images = Array.isArray(options.images) ? options.images.filter((item) => item?.file) : [];
  if (images.length) {
    const attached = await attachSteeringImagesViaFileInput(composer, images);
    if (!attached.ok) {
      return { ok: false, sent: false, retryable: false, message: attached.message || '이미지를 업로드하지 못했습니다.' };
    }
    const uploadReady = await waitForSteeringAttachmentUploadReady(composer, { imageCount: images.length });
    if (!uploadReady.ok) {
      return {
        ok: false,
        sent: false,
        retryable: !!uploadReady.retryable,
        message: uploadReady.message || '이미지 업로드가 끝날 때까지 기다리는 중입니다.',
      };
    }
  }
  suppressComposerAcknowledge(1700);
  const mergedText = mergeSteeringText(getCurrentComposerText(composer), text);
  if (mergedText) {
    const filled = setControlValue(composer, mergedText);
    if (!filled) {
      return { ok: false, sent: false, message: '입력창에 지시를 넣지 못했습니다.' };
    }
    await waitForSteeringTick(90);
  } else if (!images.length) {
    return { ok: false, sent: false, message: '보낼 내용이 없습니다.' };
  } else {
    await waitForSteeringTick(180);
  }
  const attempts = [
    () => {
      const btn = getActiveSendButton();
      if (!btn) return false;
      try { btn.click(); return true; } catch (_) { return false; }
    },
    () => {
      const btn = findNearbySendButton(composer);
      if (!btn) return false;
      try { btn.click(); return true; } catch (_) { return false; }
    },
    () => requestSubmitComposer(composer),
    () => dispatchSubmitKey(composer),
    () => dispatchSubmitKey(composer, { ctrlKey: true }),
    () => dispatchSubmitKey(composer, { metaKey: true }),
  ];
  for (const attempt of attempts) {
    const sent = await tryTriggerComposerSend(composer, attempt);
    if (sent) {
      return { ok: true, sent: true, message: '전송했습니다.' };
    }
  }
  return { ok: false, sent: false, message: '전송 경로를 모두 시도했지만 전송하지 못했습니다.' };
}
async function processSteeringQueue(options = {}) {
  if (!monitoring || !steeringEnabled) return false;
  if (!steeringQueue.length) return false;
  if (!canAutoSendSteeringNow()) return false;
  const current = steeringQueue[0];
  if (!current?.text && !getSteeringItemAttachmentCount(current)) {
    current.retryCount = 0;
    steeringQueue = steeringQueue.slice(1);
    syncSteeringQueueEditState();
    updateSteeringUi();
    return false;
  }
  steeringProcessing = true;
  updateSteeringUi();
  try {
    const result = await sendSteeringPromptText(current.text, { images: current.images || [] });
    if (!result.ok || !result.sent) {
      if (result.retryable) {
        current.retryCount = Math.max(0, Number(current.retryCount) || 0) + 1;
        if (current.retryCount <= 6) {
          setSteeringStatus(`이미지 업로드 대기 중 · 재시도 ${current.retryCount}`);
          scheduleSteeringQueueProcessing(Math.min(4200, 900 + current.retryCount * 550));
        } else {
          setSteeringStatus(result.message || '이미지 업로드가 오래 걸리고 있습니다. 업로드가 끝난 뒤 다시 전송해 주세요.', true);
        }
      } else {
        setSteeringStatus(result.message || '전송하지 못했습니다.', true);
      }
      updateSteeringUi();
      return false;
    }
    steeringQueue = steeringQueue.slice(1);
    syncSteeringQueueEditState();
    clearSteeringCompletionOffer();
    steeringAwaitingTurnCompletion = true;
    steeringObservedGenerationSinceSend = false;
    armSteeringAwaitingResponseStart();
    armSteeringSendLock();
    setSteeringStatus(options.source === 'auto' ? '자동 전송했습니다.' : '전송했습니다.');
    setSteeringDraftText('');
    try { if (steeringRefs?.input) steeringRefs.input.value = ''; } catch (_) {}
    if (steeringCloseAfterSend) steeringPanelOpen = false;
    updateSteeringUi();
    return true;
  } finally {
    steeringProcessing = false;
    updateSteeringUi();
  }
}
function submitSteeringInput() {
  const refs = ensureSteeringUi();
  const text = String(refs?.input?.value || '').trim();
  const images = cloneSteeringImagesForQueue();
  if (!text && !images.length) {
    setSteeringStatus('후속 지시나 이미지를 준비해주세요.', true);
    try { refs?.input?.focus(); } catch (_) {}
    return;
  }
  enqueueSteeringPrompt(text, { images });
  setSteeringDraftText('');
  try { refs.input.value = ''; } catch (_) {}
  clearSteeringDraftAttachments();
  const canSendNow = canAutoSendSteeringNow();
  setSteeringStatus(canSendNow ? '전송 준비 중' : `${getSteeringQueueCountLabel()}`);
  updateSteeringUi();
  if (!canSendNow) return;
  scheduleSteeringQueueProcessing(0);
}
['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'].forEach((type) => {
  try { document.addEventListener(type, suppressFollowupPointerAfterSteeringDrop, true); } catch (_) {}
});

