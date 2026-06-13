// ════════════════════════════════════════════════════════════
// BossGreet — 聊天页发送模块
// 文字招呼语 + 简历图片，含投递确认和防双发
// ════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 元素等待 ──
async function waitForElement(selectors, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of (Array.isArray(selectors) ? selectors : [selectors])) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.offsetParent !== null) return el;
      if (getComputedStyle(el).position === 'fixed') return el;
    }
    await sleep(200);
  }
  return null;
}

// ── 投递确认：轮询 .message-status ──
async function waitForDeliveryStatus(timeoutMs, baselineCount, expectText) {
  const deadline = Date.now() + timeoutMs;
  const norm = s => (s || '').replace(/\s+/g, '');
  const fp = norm(expectText).slice(0, 16);
  while (Date.now() < deadline) {
    const items = document.querySelectorAll(SELECTORS.chatDetail.messageSent);
    for (let i = baselineCount; i < items.length; i++) {
      const target = items[i];
      if (!target) continue;
      if (fp && norm(target.textContent).indexOf(fp) < 0) continue;
      const st = target.querySelector('.message-status');
      if (st) {
        if (st.className.indexOf('status-delivery') >= 0) return 'delivery';
        if (st.className.indexOf('status-error') >= 0) return 'error';
      }
    }
    await sleep(300);
  }
  return 'timeout';
}

// ── 图片投递确认：等 CDN URL + status-delivery ──
async function waitForImageDelivered(timeoutMs, baselineCount) {
  const deadline = Date.now() + timeoutMs;
  let seen = 'none';
  while (Date.now() < deadline) {
    const items = document.querySelectorAll(SELECTORS.chatDetail.messageSent);
    for (let i = baselineCount; i < items.length; i++) {
      const target = items[i];
      if (!target) continue;
      const st = target.querySelector('.message-status');
      if (st && st.className.indexOf('status-error') >= 0) return { status: 'error', seen: 'error' };
      const img = target.querySelector('img');
      if (img && img.src) {
        if (img.src.indexOf('blob:') === 0) seen = 'blob';
        if (img.src.indexOf('https://imgaz.bosszhipin.com/') === 0) {
          seen = 'cdn';
          if (st && st.className.indexOf('status-delivery') >= 0) return { status: 'delivery', seen: 'cdn' };
        }
      } else if (seen === 'none') seen = 'bubble_no_img';
    }
    await sleep(300);
  }
  return { status: 'timeout', seen };
}

function findDeliveredImageBubble(bc) {
  const items = document.querySelectorAll(SELECTORS.chatDetail.messageSent);
  for (let i = bc; i < items.length; i++) {
    const t = items[i];
    const img = t.querySelector('img');
    const st = t.querySelector('.message-status');
    if (img?.src?.startsWith('https://imgaz.bosszhipin.com/') && st?.className.includes('status-delivery')) return true;
  }
  return false;
}

function findDeliveredTextBubble(bc, expectText) {
  const norm = s => (s || '').replace(/\s+/g, '');
  const fp = norm(expectText).slice(0, 16);
  if (!fp) return false;
  const items = document.querySelectorAll(SELECTORS.chatDetail.messageSent);
  for (let i = bc; i < items.length; i++) {
    if (norm(items[i].textContent).indexOf(fp) >= 0) {
      const st = items[i].querySelector('.message-status');
      if (st?.className.includes('status-delivery')) return true;
    }
  }
  return false;
}

// ── 关闭弹窗 ──
async function closeBlockingDialogs(maxRounds = 3) {
  for (let round = 0; round < maxRounds; round++) {
    await sleep(400);
    const closers = document.querySelectorAll('.icon-close');
    for (const c of closers) {
      if (c.offsetHeight > 0) try { c.click(); } catch (_) {}
    }
    await sleep(300);
    const dialogs = document.querySelectorAll('[class*="dialog"]');
    for (const d of dialogs) {
      if (d.offsetHeight > 0) try { d.remove(); } catch (_) {}
    }
    await sleep(300);
    const stillOpen = [...document.querySelectorAll('[class*="dialog"]')].some(d => d.offsetHeight > 0);
    if (!stillOpen) return true;
  }
  return false;
}

// ── HR 活跃度筛选 ──
function passActivityFilter(filter, act) {
  if (!filter || filter === '不限') return true;
  if (filter === '只投在线') return act.online === true;
  const maxMap = { '3日内活跃': 3, '本周内活跃': 7, '本月内活跃': 30 };
  const max = maxMap[filter];
  if (max == null) return true;
  if (act.online) return true;
  if (act.activeDays == null) return true;
  return act.activeDays <= max;
}

// ── 对话查找 ──
function findChatConversation(hrName, hrCompany) {
  const items = document.querySelectorAll('.user-list-content li, .friend-content-warp');
  hrName = (hrName || '').trim();
  hrCompany = (hrCompany || '').trim();

  for (let i = 0; i < items.length; i++) {
    const nameEl = items[i].querySelector('.name-text');
    if (!nameEl) continue;
    if (!nameEl.textContent.trim().includes(hrName) && hrName !== nameEl.textContent.trim()) continue;
    const nameBox = items[i].querySelector('.name-box');
    if (nameBox) {
      const spans = nameBox.querySelectorAll('span');
      for (const s of spans) {
        if (s.classList.contains('name-text')) continue;
        if (s.textContent.trim().includes(hrCompany) || hrCompany === s.textContent.trim()) {
          return items[i].querySelector('.friend-content') || items[i];
        }
      }
    }
  }
  // fallback: 只按名字
  for (let j = 0; j < items.length; j++) {
    const nEl = items[j].querySelector('.name-text');
    if (nEl && (nEl.textContent.trim().includes(hrName) || hrName === nEl.textContent.trim())) {
      return items[j].querySelector('.friend-content') || items[j];
    }
  }
  return null;
}

// ── Data URL → Blob ──
function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  if (!mimeMatch) throw new Error('Invalid data URL');
  const mime = mimeMatch[1];
  const byteStr = atob(parts[1]);
  const arr = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ════════════════════════════════════════════════════════════
// JobSender 主体
// ════════════════════════════════════════════════════════════
function _safeSendSender(msg) {
  try { chrome.runtime.sendMessage(msg, () => { if (chrome.runtime.lastError) {} }); } catch (_) {}
}

const JobSender = {
  stopped: false,

  // ── 发送文字招呼语（单次）──
  async _sendTextOnce(greeting, baselineOverride, timeoutMsOverride) {
    if (!greeting?.trim()) return { success: false, error: 'greeting_empty', status: 'error' };

    const input = await waitForElement(SELECTORS.chatDetail.chatInput, 10000);
    if (!input) return { success: false, error: '未找到聊天输入框', status: 'error' };

    const sendBtn = await waitForElement(SELECTORS.chatDetail.btnSend, 2000);
    if (!sendBtn) return { success: false, error: '未找到发送按钮', status: 'error' };

    const freshInput = await waitForElement(SELECTORS.chatDetail.chatInput, 2000);
    if (!freshInput) return { success: false, error: '未找到聊天输入框', status: 'error' };

    freshInput.focus();
    freshInput.textContent = greeting;
    freshInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: greeting }));

    if (!freshInput.textContent?.trim()) return { success: false, error: '文字未能填入输入框', status: 'error' };

    await sleep(CONFIG.FILL_SETTLE_MS);
    const enabled = !sendBtn.classList.contains('disabled') && !sendBtn.disabled;
    if (!enabled) {
      await sleep(200);
      if (!(!sendBtn.classList.contains('disabled') && !sendBtn.disabled)) {
        return { success: false, error: 'btn-send 未激活', status: 'error' };
      }
    }

    const baselineCount = (typeof baselineOverride === 'number')
      ? baselineOverride
      : document.querySelectorAll(SELECTORS.chatDetail.messageSent).length;

    sendBtn.click();

    const _waitMs = (typeof timeoutMsOverride === 'number') ? timeoutMsOverride : 8000;
    const status = await waitForDeliveryStatus(_waitMs, baselineCount, greeting);
    if (status === 'delivery') return { success: true, status: 'delivery' };
    if (status === 'error') return { success: false, error: 'text_delivery_failed', status: 'error' };
    return { success: false, error: 'text_delivery_timeout', status: 'timeout' };
  },

  // ── 发送文字（含重试）──
  async sendText(greeting, opts = {}) {
    if (!greeting?.trim()) return { success: false, error: 'greeting_empty', status: 'error' };
    const maxAttempts = opts.maxAttempts || 3;
    const retryDelayMs = opts.retryDelayMs || 1200;
    const origBaseline = document.querySelectorAll(SELECTORS.chatDetail.messageSent).length;
    let last = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        if (findDeliveredTextBubble(origBaseline, greeting)) return { success: true, status: 'delivery' };
        await sleep(retryDelayMs);
        if (findDeliveredTextBubble(origBaseline, greeting)) return { success: true, status: 'delivery' };
      }
      try { last = await this._sendTextOnce(greeting, origBaseline, opts.timeoutMs); } catch (e) {
        last = { success: false, error: 'sendText异常: ' + e.message, status: 'error' };
      }
      if (last?.success) return last;
    }
    return last || { success: false, status: 'timeout' };
  },

  // ── 发送图片（单次）──
  async _sendImageOnce(blob, filename, jobId, baselineOverride, timeoutMsOverride) {
    const file = new File([blob], filename || 'resume.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);

    let fileInput = null;
    for (let retry = 0; retry < 10 && !fileInput; retry++) {
      fileInput = document.querySelector(SELECTORS.chatDetail.imageUpload);
      if (!fileInput) await sleep(500);
    }
    if (!fileInput) throw new Error('未找到图片上传入口');

    const baselineCount = (typeof baselineOverride === 'number')
      ? baselineOverride
      : document.querySelectorAll(SELECTORS.chatDetail.messageSent).length;

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set;
    nativeSetter.call(fileInput, dt.files);
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    const timeoutMs = (typeof timeoutMsOverride === 'number') ? timeoutMsOverride
      : (CONFIG.IMG_UPLOAD_TIMEOUT_MS || 15000);
    const r = await waitForImageDelivered(timeoutMs, baselineCount);
    return { success: r.status === 'delivery', status: r.status };
  },

  // ── 发送图片（含重试）──
  async sendImage(blob, filename, jobId, opts = {}) {
    const maxAttempts = opts.maxAttempts || 3;
    const retryDelayMs = opts.retryDelayMs || 1200;
    const origBaseline = document.querySelectorAll(SELECTORS.chatDetail.messageSent).length;
    let last = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        if (findDeliveredImageBubble(origBaseline)) return { success: true, status: 'delivery' };
        await sleep(retryDelayMs);
        if (findDeliveredImageBubble(origBaseline)) return { success: true, status: 'delivery' };
      }
      try { last = await this._sendImageOnce(blob, filename, jobId, origBaseline, opts.timeoutMs); } catch (e) {
        last = { success: false, error: 'sendImage异常: ' + e.message, status: 'error' };
      }
      if (last?.status === 'delivery') return { success: true, status: 'delivery' };
    }
    return last || { success: false, status: 'timeout' };
  },

  // ── 发送单个岗位（招呼语 + 简历图片）──
  async sendSingle(greeting, jobId, imgOpts, textOpts) {
    if (this.stopped) return { success: false, stopped: true, error: 'stopped' };

    // 1. 发文字
    let textResult;
    try { textResult = await this.sendText(greeting, textOpts); } catch (e) {
      textResult = { success: false, error: 'sendText异常: ' + e.message };
    }
    if (!textResult.success) return textResult;
    if (this.stopped) return { success: false, stopped: true, error: 'stopped' };
    await sleep(500);

    // 2. 发图片
    const imgRet = await this._sendResumeImages(jobId, imgOpts);

    // 3. 检测验证码
    if (typeof detectCaptcha === 'function' && detectCaptcha().detected) {
      _safeSendSender({ type: 'CAPTCHA_DETECTED' });
      return { success: false, error: 'captcha', captchaDetected: true };
    }

    if (imgRet.imageFailed) return { success: false, error: imgRet.imageError || 'image_send_failed', skipped: 'image' };
    return { success: true };
  },

  // ── 发送简历图片 ──
  async _sendResumeImages(jobId, imgOpts) {
    let imagesData = null;
    try {
      const { 'ui:jobCustom': jobCustom } = await chrome.storage.local.get('ui:jobCustom');
      if (jobCustom?.[jobId]?.images?.length > 0) imagesData = jobCustom[jobId].images;
    } catch (_) {}

    let imageFailed = false, imageError = null, attempted = false;

    if (imagesData?.length > 0) {
      for (const img of imagesData) {
        if (this.stopped) break;
        const dataUrl = img.fullSrc || img.src;
        if (!dataUrl) continue;
        attempted = true;
        try {
          const blob = dataUrlToBlob(dataUrl);
          const r = await this.sendImage(blob, img.name || 'resume.jpg', jobId, imgOpts);
          if (!r?.success) { imageFailed = true; imageError = r?.status ? 'image_' + r.status : 'image_send_failed'; }
        } catch (e) { imageFailed = true; imageError = 'image_send_failed'; }
        await sleep(800);
      }
    } else {
      const { 'ui:resumeImages': stored } = await chrome.storage.local.get('ui:resumeImages');
      if (stored?.length > 0) {
        for (const s of stored) {
          if (this.stopped) break;
          attempted = true;
          const blob = new Blob([new Uint8Array(s.data)], { type: s.type || 'image/jpeg' });
          const r = await this.sendImage(blob, s.name || 'resume.jpg', jobId, imgOpts);
          if (!r?.success) { imageFailed = true; imageError = r?.status ? 'image_' + r.status : 'image_send_failed'; }
          await sleep(800);
        }
      }
    }
    return { imageFailed, imageError, attempted };
  },

  // ── 补发：核对服务器历史 ──
  hasTextInHistory(expectText) {
    const norm = s => (s || '').replace(/\s+/g, '');
    const fp = norm(expectText).slice(0, 16);
    if (!fp) return true;
    const items = document.querySelectorAll(SELECTORS.chatDetail.messageSent);
    for (const item of items) {
      if (norm(item.textContent).indexOf(fp) >= 0) return true;
    }
    return false;
  },

  hasImageInHistory() {
    const items = document.querySelectorAll(SELECTORS.chatDetail.messageSent);
    for (const item of items) {
      const img = item.querySelector('img');
      if (img?.src?.startsWith('https://imgaz.bosszhipin.com/')) return true;
    }
    return false;
  },

  async repairSingle(greeting, jobId, imgOpts, textOpts) {
    const hadText = greeting ? this.hasTextInHistory(greeting) : true;
    const hadImage = this.hasImageInHistory();
    let textOk = hadText, imageOk = hadImage;
    let repairedText = false, repairedImage = false;

    if (!hadText && greeting) {
      let tr = null;
      try { tr = await this.sendText(greeting, textOpts); } catch (_) {}
      textOk = !!(tr?.success);
      repairedText = textOk;
      await sleep(500);
    }

    if (!hadImage) {
      const ir = await this._sendResumeImages(jobId, imgOpts);
      if (!ir.attempted) imageOk = true;
      else { imageOk = !ir.imageFailed; repairedImage = imageOk; }
    }

    return { complete: textOk && imageOk, hadText, hadImage, repairedText, repairedImage };
  },

  stop() { this.stopped = true; },
};
