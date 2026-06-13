// ════════════════════════════════════════════════════════════
// BossGreet — Content Script 入口
// 根据 URL 路由 + 消息监听
// ════════════════════════════════════════════════════════════

// ── 安全发送：SW 未激活时 sendMessage 抛同步错误，.catch() 捕获不了 ──
function safeSend(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => {
      if (chrome.runtime.lastError) { /* SW 未就绪，忽略 */ }
    });
  } catch (_) { /* chrome.runtime 不可用，忽略 */ }
}

(async () => {
  const href = window.location.href;

  // ── 消息监听 ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === MSG.PING) {
      sendResponse({ type: MSG.PONG });
      return true;
    }

    switch (msg.type) {
      case MSG.DO_COLLECT:
        handleCollect(msg.params).then(
          result => sendResponse({ success: true, ...result }),
          e => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.DO_FETCH_JD:
        handleFetchJD(msg.jobId, msg.jobLink).then(
          result => sendResponse({ success: true, ...result }),
          e => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.DO_BATCH_EXTRACT:
        handleBatchExtract(msg).then(
          result => sendResponse(result),
          e => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.WORKER_ACTIVATE:
        handleWorkerActivate(msg).then(
          result => sendResponse(result),
          e => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.WORKER_SEND:
        handleWorkerSend(msg).then(
          result => sendResponse(result),
          e => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.WORKER_REPAIR:
        handleWorkerRepair(msg).then(
          result => sendResponse(result),
          e => sendResponse({ complete: false, error: e.message })
        );
        return true;

      case MSG.DO_STOP:
        if (typeof JobCollector !== 'undefined') JobCollector.stop();
        if (typeof JobSender !== 'undefined') JobSender.stop();
        if (typeof ChatMonitor !== 'undefined') ChatMonitor.stop();
        sendResponse({ success: true });
        break;

      case MSG.QUEUE_EMPTY:
        return;
    }
  });

  // ── 路由初始化 ──
  if (href.includes('/web/geek/jobs')) {
    console.log('[BossGreet] 岗位搜索页已就绪');
  } else if (href.includes('/web/geek/chat')) {
    if (typeof ChatMonitor !== 'undefined') ChatMonitor.start();
    console.log('[BossGreet] 聊天页已就绪');
  } else if (href.includes('/job_detail/')) {
    console.log('[BossGreet] 岗位详情页已就绪');
  }

  // ── 通知 SW：CS 就绪 ──
  let role = '';
  if (href.includes('/web/geek/jobs')) role = 'search';
  else if (href.includes('/web/geek/chat')) role = 'worker';
  safeSend({ type: MSG.CS_READY, url: href, role });
})();

// ── 岗位采集 ──
async function handleCollect(params) {
  const result = await runCollection(params, progress => {
    safeSend({ type: MSG.COLLECT_PROGRESS, ...progress });
  });
  safeSend({
    type: MSG.JOBS_COLLECTED,
    jobs: result.jobs,
    count: result.count,
    withJD: result.withJD,
  });
  return result;
}

// ── 单个 JD 提取（从详情页）──
async function handleFetchJD(jobId, jobLink) {
  if (typeof JDExtractor === 'undefined') return { desc: '' };
  // 在当前页（搜索页右侧面板已展开）尝试提取
  const panelData = JDExtractor.extractFromPanel();
  if (panelData?.complete) {
    return { desc: panelData.desc, tags: panelData.tags, fromPanel: true };
  }
  return { desc: panelData?.desc || '', tags: panelData?.tags || [], fromPanel: true };
}

// ── v6: 批量提取 HR 信息 + JD ──
async function handleBatchExtract(msg) {
  const queue = msg.queue || [];
  if (typeof JobCollector !== 'undefined') JobCollector.stopped = false;
  if (typeof JobSender !== 'undefined') JobSender.stopped = false;

  const results = [];
  const skipped = [];
  let captchaDetected = false;

  for (let i = 0; i < queue.length; i++) {
    if (typeof JobCollector !== 'undefined' && JobCollector.stopped) break;
    const item = queue[i];

    try {
      // 找到卡片并点击
      const card = document.querySelector(`li.job-card-box a[href*="${item.jobId}"]`)?.closest('li.job-card-box');
      if (!card) continue;

      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      await new Promise(r => setTimeout(r, 300));
      card.click();
      await new Promise(r => setTimeout(r, 1500));

      // 提取面板信息（HR + JD）
      const panelData = JDExtractor.extractFromPanel();
      if (panelData?.hrName) {
        // HR 活跃筛选
        if (panelData.activity && !passActivityFilter(msg.hrActiveFilter, panelData.activity)) {
          skipped.push({ jobId: item.jobId, activeDesc: panelData.activity.desc });
          continue;
        }

        results.push({
          jobId: item.jobId,
          hrName: panelData.hrName,
          hrCompany: panelData.hrCompany,
          greeting: item.greeting,
          positionName: item.positionName,
          companyName: item.companyName,
        });
      }

      // 检测验证码
      if (typeof detectCaptcha === 'function' && detectCaptcha().detected) {
        captchaDetected = true;
        safeSend({ type: MSG.CAPTCHA_DETECTED });
        break;
      }
    } catch (e) {
      console.warn('[BossGreet] batchExtract item error:', e.message);
    }

    safeSend({
      type: MSG.EXTRACT_PROGRESS,
      done: i + 1, total: queue.length, extracted: results.length,
    });
  }

  safeSend({
    type: MSG.EXTRACT_COMPLETE,
    success: true, results, skipped, captchaDetected,
  });

  return { success: true, results, skipped, captchaDetected };
}

// ── v6: Worker 激活（找对话 + 进入）──
async function handleWorkerActivate(msg) {
  const job = msg.job || {};
  if (!job.hrName) return { success: false, jobId: job.jobId, error: 'HR名称为空' };
  if (typeof JobSender !== 'undefined' && JobSender.stopped) return { success: false, stopped: true };

  const listContainer = await waitForElement('.user-list-content', 10000);
  if (!listContainer) return { success: false, jobId: job.jobId, error: '对话列表容器未加载' };

  let conversation = findChatConversation(job.hrName, job.hrCompany);
  for (let retry = 0; retry < 12 && !conversation; retry++) {
    await new Promise(r => setTimeout(r, 500));
    conversation = findChatConversation(job.hrName, job.hrCompany);
  }
  if (!conversation) return { success: false, jobId: job.jobId, error: '未找到对话' };

  conversation.click();
  await new Promise(r => setTimeout(r, 2000));

  // 等输入框出现
  let chatLoaded = false;
  for (let w = 0; w < 50; w++) {
    await new Promise(r => setTimeout(r, 200));
    const input = document.querySelector(SELECTORS.chatDetail.chatInput);
    if (input && (input.offsetParent !== null || getComputedStyle(input).position === 'fixed')) {
      chatLoaded = true;
      break;
    }
    if (document.querySelectorAll('.msg-content, .message, [class*="message"]').length > 0) {
      chatLoaded = true;
      break;
    }
  }
  if (!chatLoaded) return { success: false, jobId: job.jobId, error: '对话未加载' };

  await closeBlockingDialogs(3);
  return { success: true, jobId: job.jobId };
}

// ── v6: Worker 发送 ──
async function handleWorkerSend(msg) {
  const job = msg.job || {};
  try {
    const sendResult = await JobSender.sendSingle(job.greeting, job.jobId,
      { timeoutMs: 4000, maxAttempts: 1 },
      { timeoutMs: 3000, maxAttempts: 1 }
    );
    return { success: true, jobId: job.jobId, positionName: job.positionName, companyName: job.companyName, ...sendResult };
  } catch (e) {
    return { success: false, jobId: job.jobId, error: e.message };
  }
}

// ── v6: 补发 ──
async function handleWorkerRepair(msg) {
  const job = msg.job || {};
  const act = await handleWorkerActivate(msg);
  if (!act?.success) {
    return { complete: false, foundConv: false, jobId: job.jobId, error: act?.error || '补发时未找到对话' };
  }
  await new Promise(r => setTimeout(r, 1500));
  try {
    const r = await JobSender.repairSingle(job.greeting, job.jobId,
      { timeoutMs: 5000, maxAttempts: 2, retryDelayMs: 600 },
      { timeoutMs: 5000, maxAttempts: 2, retryDelayMs: 600 }
    );
    return { jobId: job.jobId, foundConv: true, positionName: job.positionName, companyName: job.companyName, ...r };
  } catch (e) {
    return { complete: false, foundConv: true, jobId: job.jobId, error: e.message };
  }
}
