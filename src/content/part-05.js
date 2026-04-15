async function tryTriggerComposerSend(composer, trigger) {
  if (!composer || typeof trigger !== 'function') return false;
  const beforeText = getCurrentComposerText(composer);
  let triggered = false;
  try { triggered = trigger() !== false; } catch (_) { triggered = false; }
  if (!triggered) return false;
  return await waitForSubmissionStart(composer, beforeText);
}
function setSteeringStatus(text, isError = false) {
  if (!steeringRefs?.status) return;
  steeringRefs.status.textContent = text || '';
  steeringRefs.status.dataset.state = isError ? 'error' : 'ok';
}
function hideSteeringUi() {
  if (steeringHost) steeringHost.style.display = 'none';
  syncSteeringQueueCount();
}
function getSteeringQueueCountValue() {
  return Math.max(0, Number(steeringQueue.length) || 0);
}
function getSteeringQueueCountText() {
  const count = getSteeringQueueCountValue();
  return count > 99 ? '99+' : String(count);
}
function getSteeringQueueCountLabel() {
  return `대기 : ${getSteeringQueueCountText()}`;
}
function syncSteeringQueueCount(force = false) {
  const count = Math.max(0, Number(steeringQueue.length) || 0);
  if (!force && steeringLastReportedQueueCount === count) return;
  steeringLastReportedQueueCount = count;
  try {
    chrome.runtime.sendMessage({
      action: 'steering_queue_update',
      platform: getSiteKey(),
      siteName: activeSite?.name,
      count,
    });
  } catch (_) {}
}
function formatSteeringBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  if (value >= 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${value}B`;
}
function isSteeringImageFile(file) {
  return !!file && typeof file === 'object' && /^image\//i.test(String(file.type || ''));
}
function makeSteeringAttachment(file, options = {}) {
  if (!isSteeringImageFile(file)) return null;
  const size = Math.max(0, Number(file.size) || 0);
  if (size > STEERING_IMAGE_MAX_BYTES) return { invalid: true, reason: 'too_large', file };
  let previewUrl = '';
  try { previewUrl = URL.createObjectURL(file); } catch (_) {}
  return {
    id: steeringAttachmentSeq++,
    name: String(file.name || `image-${Date.now()}.png`),
    size,
    type: String(file.type || 'image/png'),
    file,
    previewUrl,
    width: Math.max(0, Number(options.width) || 0),
    height: Math.max(0, Number(options.height) || 0),
    optimized: !!options.optimized,
    originalSize: Math.max(0, Number(options.originalSize) || 0),
  };
}
function getSteeringImageExtensionForType(type) {
  const raw = String(type || '').toLowerCase();
  if (raw.includes('png')) return 'png';
  if (raw.includes('webp')) return 'webp';
  if (raw.includes('gif')) return 'gif';
  return 'jpg';
}
function buildSteeringOptimizedFileName(name, type) {
  const raw = String(name || '').trim() || `image-${Date.now()}`;
  const nextExt = getSteeringImageExtensionForType(type);
  const stem = raw.replace(/\.[a-z0-9]{2,8}$/i, '') || `image-${Date.now()}`;
  return `${stem}.${nextExt}`;
}
function loadSteeringImageElement(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(null);
      return;
    }
    let objectUrl = '';
    try { objectUrl = URL.createObjectURL(file); } catch (_) {
      resolve(null);
      return;
    }
    const img = new Image();
    const done = (value) => {
      if (!value) {
        try { if (objectUrl) URL.revokeObjectURL(objectUrl); } catch (_) {}
      }
      resolve(value || null);
    };
    img.onload = () => {
      done({
        img,
        objectUrl,
        width: Math.max(0, Number(img.naturalWidth) || 0),
        height: Math.max(0, Number(img.naturalHeight) || 0),
      });
    };
    img.onerror = () => done(null);
    try { img.src = objectUrl; } catch (_) { done(null); }
  });
}
function canvasToBlobAsync(canvas, type, quality) {
  return new Promise((resolve) => {
    try { canvas.toBlob((blob) => resolve(blob || null), type, quality); } catch (_) { resolve(null); }
  });
}
async function optimizeSteeringImageFile(file) {
  if (!isSteeringImageFile(file)) {
    return { file, optimized: false, width: 0, height: 0, originalSize: Math.max(0, Number(file?.size) || 0) };
  }
  const loaded = await loadSteeringImageElement(file);
  const width = Math.max(0, Number(loaded?.width) || 0);
  const height = Math.max(0, Number(loaded?.height) || 0);
  const size = Math.max(0, Number(file.size) || 0);
  try {
    return { file, optimized: false, width, height, originalSize: size };
  } finally {
    try { if (loaded?.objectUrl) URL.revokeObjectURL(loaded.objectUrl); } catch (_) {}
  }
}
function getSteeringAttachmentMetaText(item) {
  const parts = [];
  const width = Math.max(0, Number(item?.width) || 0);
  const height = Math.max(0, Number(item?.height) || 0);
  if (width && height) parts.push(`${width}×${height}`);
  parts.push(formatSteeringBytes(item?.size));
  return parts.join(' · ');
}
function moveSteeringAttachment(attachmentId, direction) {
  const index = steeringAttachments.findIndex((item) => item?.id === attachmentId);
  if (index < 0) return false;
  const nextIndex = index + (direction < 0 ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= steeringAttachments.length) return false;
  const cloned = steeringAttachments.slice();
  const [picked] = cloned.splice(index, 1);
  cloned.splice(nextIndex, 0, picked);
  steeringAttachments = cloned;
  updateSteeringUi();
  return true;
}
function openSteeringAttachmentPreview(attachmentId) {
  steeringPreviewAttachmentId = attachmentId;
  syncSteeringAttachmentPreview();
}
function closeSteeringAttachmentPreview() {
  steeringPreviewAttachmentId = null;
  syncSteeringAttachmentPreview();
}
function stepSteeringAttachmentPreview(direction) {
  if (!steeringAttachments.length) {
    closeSteeringAttachmentPreview();
    return;
  }
  const currentIndex = steeringAttachments.findIndex((item) => item?.id === steeringPreviewAttachmentId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + (direction < 0 ? -1 : 1) + steeringAttachments.length) % steeringAttachments.length;
  steeringPreviewAttachmentId = steeringAttachments[nextIndex]?.id || null;
  syncSteeringAttachmentPreview();
}
function renderSteeringTemplates() {
  const refs = steeringRefs;
  if (!refs?.templateWrap || !refs?.templateList) return;
  const templates = normalizeSteeringTemplates(steeringTemplates);
  steeringTemplates = templates;
  refs.templateWrap.style.display = templates.length ? 'flex' : 'none';
  if (refs.templateMeta) refs.templateMeta.textContent = templates.length ? `등록 ${templates.length}개 · 툴팁 확인 가능` : '등록된 템플릿 없음';
  const signature = JSON.stringify(templates.map((item) => [item.id, item.name, item.text, item.tooltip]));
  if (signature === steeringTemplateRenderSignature) return;
  steeringTemplateRenderSignature = signature;
  refs.templateList.innerHTML = '';
  templates.forEach((template) => {
    const btn = document.createElement('button');
    btn.className = 'template-btn';
    btn.type = 'button';
    btn.textContent = template.name || '템플릿';
    const tooltip = getSteeringTemplateTooltip(template);
    btn.title = tooltip;
    btn.setAttribute('aria-label', tooltip || template.name || '템플릿');
    btn.addEventListener('click', (event) => {
      try { event.preventDefault(); } catch (_) {}
      try { event.stopPropagation(); } catch (_) {}
      enqueueSteeringPrompt(template.text);
      setSteeringStatus(`템플릿 대기 추가: ${template.name || truncateSteeringText(template.text, 18)}`);
      if (!steeringPanelOpen) steeringPanelOpen = true;
      updateSteeringUi();
    });
    refs.templateList.appendChild(btn);
  });
}
function syncSteeringAttachmentPreview() {
  const overlay = steeringRefs?.attachmentPreview;
  const imageEl = steeringRefs?.attachmentPreviewImage;
  const metaEl = steeringRefs?.attachmentPreviewMeta;
  const prevBtn = steeringRefs?.attachmentPreviewPrev;
  const nextBtn = steeringRefs?.attachmentPreviewNext;
  if (!overlay || !imageEl || !metaEl) return;
  const active = steeringAttachments.find((item) => item?.id === steeringPreviewAttachmentId) || null;
  const showNav = steeringAttachments.length > 1;
  const signature = active ? JSON.stringify([active.id, active.previewUrl || '', active.name || '', active.size || 0, active.width || 0, active.height || 0, !!active.optimized, showNav]) : 'hidden';
  if (steeringPreviewRenderSignature === signature) return;
  steeringPreviewRenderSignature = signature;
  if (!active) {
    overlay.hidden = true;
    if (imageEl.getAttribute('src')) imageEl.removeAttribute('src');
    imageEl.alt = 'attachment preview';
    if (metaEl.textContent) metaEl.textContent = '';
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    return;
  }
  overlay.hidden = false;
  if ((imageEl.getAttribute('src') || '') !== (active.previewUrl || '')) {
    if (active.previewUrl) imageEl.src = active.previewUrl;
    else imageEl.removeAttribute('src');
  }
  imageEl.alt = active.name || 'attachment preview';
  const nextMeta = `${active.name} · ${getSteeringAttachmentMetaText(active)}`;
  if (metaEl.textContent !== nextMeta) metaEl.textContent = nextMeta;
  if (prevBtn) prevBtn.style.display = showNav ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = showNav ? 'inline-flex' : 'none';
}
function revokeSteeringAttachment(attachment) {
  const url = String(attachment?.previewUrl || '');
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch (_) {}
}
function getSteeringDraftAttachmentCount() {
  return Math.max(0, steeringAttachments.length || 0);
}
function getSteeringItemAttachmentCount(item) {
  return Array.isArray(item?.images) ? item.images.length : 0;
}
function getSteeringItemSummary(item) {
  const text = String(item?.text || '').trim();
  const imageCount = getSteeringItemAttachmentCount(item);
  const imageLabel = imageCount ? `이미지 ${imageCount}` : '';
  if (text && imageLabel) return `${text} · ${imageLabel}`;
  if (text) return text;
  if (imageLabel) return imageLabel;
  return '비어 있는 대기';
}
function removeSteeringAttachment(attachmentId, options = {}) {
  const index = steeringAttachments.findIndex((item) => item?.id === attachmentId);
  if (index < 0) return false;
  const [picked] = steeringAttachments.splice(index, 1);
  revokeSteeringAttachment(picked);
  if (steeringPreviewAttachmentId === attachmentId) {
    steeringPreviewAttachmentId = steeringAttachments[Math.min(index, steeringAttachments.length - 1)]?.id || null;
  }
  if (!options.silent) {
    const count = getSteeringDraftAttachmentCount();
    setSteeringStatus(count ? `이미지 ${count}개 준비됨` : '이미지를 제거했습니다.');
  }
  updateSteeringUi();
  return true;
}
function clearSteeringDraftAttachments(options = {}) {
  const list = steeringAttachments.slice();
  steeringAttachments = [];
  steeringPreviewAttachmentId = null;
  list.forEach((item) => revokeSteeringAttachment(item));
  try { if (!options.keepFileInputValue && steeringRefs?.fileInput) steeringRefs.fileInput.value = ''; } catch (_) {}
  syncSteeringAttachmentPreview();
}
function extractImageFilesFromTransfer(dataTransfer) {
  const files = [];
  if (!dataTransfer) return files;
  try {
    const direct = Array.from(dataTransfer.files || []);
    for (const file of direct) if (isSteeringImageFile(file)) files.push(file);
  } catch (_) {}
  if (files.length) return files;
  try {
    const items = Array.from(dataTransfer.items || []);
    for (const item of items) {
      if (!item || item.kind !== 'file') continue;
      const file = item.getAsFile?.();
      if (isSteeringImageFile(file)) files.push(file);
    }
  } catch (_) {}
  return files;
}
async function addSteeringAttachments(inputFiles, options = {}) {
  const incoming = Array.from(inputFiles || []).filter((file) => isSteeringImageFile(file));
  if (!incoming.length) {
    if (!options.silent) setSteeringStatus('이미지 파일만 추가할 수 있습니다.', true);
    return { added: 0, skipped: 0, optimized: 0, total: getSteeringDraftAttachmentCount() };
  }
  const room = Math.max(0, STEERING_IMAGE_LIMIT - steeringAttachments.length);
  const accepted = incoming.slice(0, room);
  const skippedLimit = Math.max(0, incoming.length - accepted.length);
  let added = 0;
  let skippedInvalid = 0;
  let optimizedCount = 0;
  if (!options.silent && accepted.length > 1) setSteeringStatus(`이미지 ${accepted.length}개 준비 중`);
  for (const file of accepted) {
    const optimized = await optimizeSteeringImageFile(file);
    const attachment = makeSteeringAttachment(optimized.file, optimized);
    if (!attachment || attachment.invalid) {
      skippedInvalid += 1;
      continue;
    }
    if (optimized.optimized) optimizedCount += 1;
    steeringAttachments = [...steeringAttachments, attachment];
    added += 1;
  }
  try { if (steeringRefs?.fileInput) steeringRefs.fileInput.value = ''; } catch (_) {}
  if (!options.silent) {
    if (added) {
      const total = getSteeringDraftAttachmentCount();
      const extras = [];
      if (skippedLimit || skippedInvalid) extras.push(`제외 ${skippedLimit + skippedInvalid}`);
      const extra = extras.length ? ` · ${extras.join(' · ')}` : '';
      setSteeringStatus(`이미지 ${added}개 추가됨 · 총 ${total}개${extra}`);
    } else {
      setSteeringStatus(skippedInvalid ? '이미지 용량이 너무 큽니다.' : '추가할 이미지를 찾지 못했습니다.', true);
    }
  }
  updateSteeringUi();
  return { added, skipped: skippedLimit + skippedInvalid, optimized: optimizedCount, total: getSteeringDraftAttachmentCount() };
}
