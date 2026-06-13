// ════════════════════════════════════════════════════════════
// BossGreet — Service Worker
// 消息中枢 + 多模型 AI + per-JD 招呼语生成 + 发送编排
// ════════════════════════════════════════════════════════════

importScripts('/src/shared/constants.js');
importScripts('/src/shared/ai-provider.js');

// ── 状态管理 ──
let state = {
  phase: 'idle', // idle | collecting | ready | sending | review | captcha_paused
  jobs: [],
  greetings: {}, // jobId → greeting（per-JD，不是 per-category）
  greetingProgress: { done: 0, total: 0 },
  sendProgress: { sent: 0, total: 0 },
  sendResults: [],
  sendDuration: 0,
  searchUrlParams: null,
  sendQueueV6: [],
  sendQueueV6Index: 0,
  sendPhase: '',
  _v6WorkerTabIds: [],
  _v6WorkerWindowIds: [],
  _v6WorkerTabsReady: new Set(),
  _v6RepairQueue: [],
  _v6SearchReady: false,
  originalMainWindowId: null,
  hrActiveFilter: '不限',
  resumeText: '', // 结构化简历文本
};

const sentJobIds = new Set();
let sendStartTime = 0;
let abortStage1 = null;
let sendAborted = false;
let greetingPromise = null;

// ── 状态持久化 ──
let persistTimer = null;
function persistState() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.local.set({
      [STORAGE_KEYS.SW.PHASE]: state.phase,
      [STORAGE_KEYS.SW.JOBS]: state.jobs,
      [STORAGE_KEYS.SW.GREETINGS]: state.greetings,
      [STORAGE_KEYS.SW.SEND_PROGRESS]: state.sendProgress,
      [STORAGE_KEYS.SW.SENT_JOB_IDS]: Array.from(sentJobIds),
      [STORAGE_KEYS.SW.SEND_RESULTS]: state.sendResults,
      [STORAGE_KEYS.SW.SEND_DURATION]: state.sendDuration,
      [STORAGE_KEYS.SW.SEARCH_URL]: state.searchUrlParams,
      [STORAGE_KEYS.SW.SEND_QUEUE_V6]: state.sendQueueV6,
      [STORAGE_KEYS.SW.SEND_QUEUE_INDEX]: state.sendQueueV6Index,
      [STORAGE_KEYS.SW.SEND_PHASE]: state.sendPhase,
      [STORAGE_KEYS.SW.RESUME_TEXT]: state.resumeText,
    }).catch(() => {});
  }, 500);
}

function pushState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {});
  persistState();
}

// ── 启动恢复 ──
chrome.storage.local.get([
  STORAGE_KEYS.SW.PHASE, STORAGE_KEYS.SW.JOBS, STORAGE_KEYS.SW.GREETINGS,
  STORAGE_KEYS.SW.SEND_PROGRESS, STORAGE_KEYS.SW.SENT_JOB_IDS,
  STORAGE_KEYS.SW.SEND_RESULTS, STORAGE_KEYS.SW.SEND_DURATION,
  STORAGE_KEYS.SW.SEARCH_URL, STORAGE_KEYS.SW.SEND_QUEUE_V6,
  STORAGE_KEYS.SW.SEND_QUEUE_INDEX, STORAGE_KEYS.SW.SEND_PHASE,
  STORAGE_KEYS.SW.RESUME_TEXT,
], result => {
  if (result[STORAGE_KEYS.SW.SEARCH_URL]) state.searchUrlParams = result[STORAGE_KEYS.SW.SEARCH_URL];
  if (result[STORAGE_KEYS.SW.RESUME_TEXT]) state.resumeText = result[STORAGE_KEYS.SW.RESUME_TEXT];

  if (result[STORAGE_KEYS.SW.PHASE] && result[STORAGE_KEYS.SW.PHASE] !== 'idle') {
    state.phase = result[STORAGE_KEYS.SW.PHASE];
    if (result[STORAGE_KEYS.SW.JOBS]) state.jobs = result[STORAGE_KEYS.SW.JOBS];
    if (result[STORAGE_KEYS.SW.GREETINGS]) state.greetings = result[STORAGE_KEYS.SW.GREETINGS];
    if (result[STORAGE_KEYS.SW.SEND_PROGRESS]) state.sendProgress = result[STORAGE_KEYS.SW.SEND_PROGRESS];
    if (result[STORAGE_KEYS.SW.SEND_RESULTS]) state.sendResults = result[STORAGE_KEYS.SW.SEND_RESULTS];
    if (result[STORAGE_KEYS.SW.SEND_DURATION]) state.sendDuration = result[STORAGE_KEYS.SW.SEND_DURATION];
    if (result[STORAGE_KEYS.SW.SENT_JOB_IDS]?.length) result[STORAGE_KEYS.SW.SENT_JOB_IDS].forEach(id => sentJobIds.add(id));
    if (result[STORAGE_KEYS.SW.SEND_QUEUE_V6]) state.sendQueueV6 = result[STORAGE_KEYS.SW.SEND_QUEUE_V6];
    if (result[STORAGE_KEYS.SW.SEND_QUEUE_INDEX]) state.sendQueueV6Index = result[STORAGE_KEYS.SW.SEND_QUEUE_INDEX];
    if (result[STORAGE_KEYS.SW.SEND_PHASE]) state.sendPhase = result[STORAGE_KEYS.SW.SEND_PHASE];

    if (state.phase === 'sending' && state.sendPhase) resumeSendV6();
    pushState();
  }
});

// ── 错误捕获 ──
self.addEventListener('error', e => console.error('[BossGreet] SW error:', e.message));
self.addEventListener('unhandledrejection', e => console.error('[BossGreet] SW rejection:', e.reason?.message));

// ── 侧边栏行为 ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ════════════════════════════════════════════════════════════
// Per-JD 招呼语生成（核心改动）
// ════════════════════════════════════════════════════════════

function getSystemPrompt() {
  return `你是求职者本人，正在BOSS直聘上给HR发送招呼语。你的回复将直接发送给HR，严禁添加任何注释、说明、括号备注、替换建议或引导语。

【核心规则】
1. 仔细阅读下方"岗位JD"中的具体要求（职责、技术栈、经验要求等）
2. 从"你的简历"中找到与JD要求最匹配的经历和技能
3. 必须包含至少1个量化成果（数字、百分比、金额、规模等具体数据）
4. 字数控制在80-120字，语气真诚专业，不要夸张
5. 如果JD提到了具体技术栈，你必须在简历中找到对应的使用经验

【好的招呼语示例】
"您好，我有5年前端开发经验，目前在腾讯负责XX平台，React+TypeScript技术栈。主导的性能优化项目将首屏加载时间从3.2s降至0.8s，日活用户50万+。看到贵司JD中提到的微前端架构和性能优化方向，与我的经验高度匹配，期待进一步沟通。"

这个示例好在：
- 匹配了JD的技术栈要求（React、TypeScript）
- 有量化成果（3.2s→0.8s，50万+日活）
- 点出了JD中的具体方向（微前端、性能优化）
- 长度合适，结尾自然`;
}

async function generateGreetingForJob(apiConfig, resumeText, job) {
  const jdText = job.jd?.fullDesc || job.jd?.desc || job.name;
  const jdKeywords = job.jd?.keywords?.join('、') || '';

  const userPrompt = `【你的简历】
${resumeText}

【目标岗位】
公司：${job.company}
职位：${job.name}
薪资：${job.salary || '未标注'}
${jdKeywords ? 'JD关键词：' + jdKeywords : ''}

【岗位JD详情】
${jdText}

请根据JD中的具体要求，从你的简历中挑选最匹配的经历，写一段个性化招呼语。重点体现你能解决JD中提到的问题，并包含量化成果。`;

  return AIProvider.call(
    apiConfig.provider,
    apiConfig.apiKey,
    apiConfig.model,
    [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: userPrompt },
    ],
    { maxTokens: 500, temperature: 0.4, timeoutMs: 60000 }
  );
}

async function getApiConfig() {
  const { [STORAGE_KEYS.UI.API_CONFIG]: config } = await chrome.storage.local.get(STORAGE_KEYS.UI.API_CONFIG);
  return config || {};
}

async function generateAllGreetingsConcurrent() {
  const apiConfig = await getApiConfig();
  if (!apiConfig.apiKey) {
    chrome.runtime.sendMessage({ type: 'ERROR', message: '请先在设置页配置 API Key' }).catch(() => {});
    return;
  }

  const resumeText = state.resumeText;
  if (!resumeText) {
    chrome.runtime.sendMessage({ type: 'ERROR', message: '请先上传简历' }).catch(() => {});
    return;
  }

  // 跳过已成功生成的
  const jobsToGenerate = state.jobs.filter(j => {
    const existing = state.greetings[j.jobId || j.id];
    return !existing || existing.includes('生成失败');
  });

  const total = jobsToGenerate.length;
  if (!total) return;

  state.greetingProgress = { done: 0, total };
  pushState();

  const CONCURRENCY = CONFIG.GREETING_CONCURRENCY || 5;
  const TIMEOUT_MS = CONFIG.GREETING_TIMEOUT_MS || 120000;
  let doneCount = 0;

  for (let i = 0; i < jobsToGenerate.length; i += CONCURRENCY) {
    const batch = jobsToGenerate.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(job =>
      (async () => {
        const jobId = job.jobId || job.id;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const greeting = await Promise.race([
              generateGreetingForJob(apiConfig, resumeText, job),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
            ]);
            state.greetings[jobId] = greeting;
            return;
          } catch (err) {
            if (attempt < 2) continue;
            state.greetings[jobId] = '生成失败：' + (err.message || '未知错误');
          }
        }
      })()
    ));

    doneCount += batch.length;
    state.greetingProgress.done = Math.min(doneCount, total);
    pushState();
  }

  state.greetingProgress = { done: total, total };
  greetingPromise = null;
  pushState();
}

// ── 消息路由 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATE':
      sendResponse({ success: true, state });
      break;

    case 'START_COLLECT':
      startCollect(msg.params).then(() => sendResponse({ success: true })).catch(e => {
        sendResponse({ success: false, error: e.message });
      });
      return true;

    case 'STOP_COLLECT':
      stopCollect().then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'JOBS_COLLECTED':
      state.jobs = msg.jobs || [];
      state.phase = 'ready';
      pushState();
      if (!state.jobs.length) {
        chrome.runtime.sendMessage({ type: 'ERROR', message: '未找到岗位' }).catch(() => {});
        sendResponse({ success: true }); break;
      }
      // 立即开始 per-JD 招呼语生成
      if (!greetingPromise) greetingPromise = generateAllGreetingsConcurrent();
      sendResponse({ success: true });
      break;

    case 'COLLECT_PROGRESS':
      chrome.runtime.sendMessage(msg).catch(() => {});
      sendResponse({ success: true });
      break;

    case 'START_SEND':
      if (sender?.tab?.windowId) state.originalMainWindowId = sender.tab.windowId;
      else chrome.windows.getLastFocused().then(win => { if (win?.id) state.originalMainWindowId = win.id; }).catch(() => {});
      state.hrActiveFilter = msg.hrActiveFilter || '不限';
      startSendV6(msg.jobIds).then(() => sendResponse({ success: true })).catch(e => {
        chrome.runtime.sendMessage({ type: 'ERROR', message: e.message }).catch(() => {});
        sendResponse({ success: false, error: e.message });
      });
      return true;

    case 'STOP_SEND':
      stopSend().then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'SEND_ITEM_RESULT':
      if (msg.payload?.jobId && sentJobIds.has(msg.payload.jobId)) { sendResponse({ success: true }); break; }
      state.sendResults.push(msg.payload);
      if (msg.payload.success || msg.payload.error === 'partial') sentJobIds.add(msg.payload.jobId);
      state.sendProgress.sent = state.sendResults.length;
      persistState();
      chrome.runtime.sendMessage(msg).catch(() => {});
      sendResponse({ success: true });
      break;

    case 'SEND_COMPLETE':
      if (state.phase === 'sending') { sendResponse({ success: true }); break; }
      if (state.phase === 'captcha_paused') break;
      if (state.sendResults.length > 0 && state.sendResults.every(r => !r.success)) {
        state.phase = 'ready'; state.sendProgress = { sent: 0, total: 0 }; pushState(); break;
      }
      state.phase = 'review';
      state.sendDuration = Date.now() - sendStartTime;
      pushState();
      chrome.runtime.sendMessage({ type: MSG.SEND_COMPLETE, results: state.sendResults, duration: state.sendDuration }).catch(() => {});
      sendResponse({ success: true });
      break;

    case 'CAPTCHA_DETECTED':
      state.phase = 'captcha_paused';
      pushState();
      chrome.tabs.query({ url: '*://*.zhipin.com/*' }).then(tabs => {
        tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'DO_STOP' }).catch(() => {}));
      });
      sendResponse({ success: true });
      break;

    case MSG.CS_READY:
      if (msg.role === 'search') { state._v6SearchReady = true; state.searchTabId = sender.tab?.id; }
      else if (msg.role === 'worker') state._v6WorkerTabsReady.add(sender.tab?.id);
      sendResponse({ success: true });
      break;

    case 'REGENERATE_GREETING':
      regenerateGreeting(msg.jobId).then(g => sendResponse({ success: true, greeting: g })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'UPDATE_GREETING':
      state.greetings[msg.jobId] = msg.greeting;
      pushState();
      sendResponse({ success: true });
      break;

    case 'GET_API_CONFIG':
      getApiConfig().then(config => sendResponse({ success: true, config })).catch(() => sendResponse({ success: true, config: {} }));
      return true;

    case 'SAVE_API_CONFIG':
      chrome.storage.local.set({ [STORAGE_KEYS.UI.API_CONFIG]: msg.config }, () => sendResponse({ success: true }));
      return true;

    case 'TEST_GREETING':
      testGreeting(msg.config).then(result => sendResponse({ success: true, result })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'EXTRACT_RESUME':
      extractResume(msg.data, msg.type).then(text => sendResponse({ success: true, text })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'CLEAR_SENT_JOB_IDS':
      sentJobIds.clear(); persistState(); sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// ── 简历提取 ──
async function extractResume(data, type) {
  let text = '';
  if (type === 'text') {
    text = data;
  } else if (type === 'pdf') {
    // PDF 解析在 popup 中完成（需要 PDF.js），这里接收已提取的文本
    text = data;
  }
  state.resumeText = text;
  pushState();
  return text;
}

// ── 测试招呼语生成 ──
async function testGreeting(config) {
  const testJob = {
    name: '前端开发工程师',
    company: '测试公司',
    salary: '20-40K',
    jd: { desc: '负责公司核心产品的前端开发，要求3年以上React经验，熟悉TypeScript，有性能优化经验优先。' },
  };
  return generateGreetingForJob(config, state.resumeText || '暂无简历内容', testJob);
}

// ── 重新生成单条招呼语 ──
async function regenerateGreeting(jobId) {
  const apiConfig = await getApiConfig();
  if (!apiConfig.apiKey) throw new Error('请先配置 API Key');
  const job = state.jobs.find(j => (j.jobId || j.id) === jobId);
  if (!job) throw new Error('未找到岗位');
  const greeting = await generateGreetingForJob(apiConfig, state.resumeText, job);
  state.greetings[jobId] = greeting;
  pushState();
  return greeting;
}

// ════════════════════════════════════════════════════════════
// 采集控制
// ════════════════════════════════════════════════════════════

async function startCollect(params) {
  state.phase = 'collecting';
  state.jobs = [];
  state.greetings = {};
  sentJobIds.clear();
  state.sendResults = [];
  state.sendDuration = 0;
  state.sendProgress = { sent: 0, total: 0 };
  if (params?.urlParams) state.searchUrlParams = params.urlParams;
  pushState();

  // 预热招呼语生成（如果简历已上传）
  if (state.resumeText && !greetingPromise) {
    // 等采集完成后生成
  }

  try {
    const url = buildJobUrl(params.urlParams || {});
    const tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/web/geek/jobs*' });
    let tabId;
    if (tabs.length) {
      tabId = tabs[0].id;
      await chrome.tabs.update(tabId, { url });
    } else {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
    }
    await waitForTabLoad(tabId);
    await waitForContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { type: 'DO_COLLECT', params });
  } catch (e) {
    state.phase = 'idle';
    pushState();
    throw e;
  }
}

async function stopCollect() {
  state.phase = 'idle';
  pushState();
  const tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/*' });
  tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'DO_STOP' }).catch(() => {}));
}

// ════════════════════════════════════════════════════════════
// v6 发送编排
// ════════════════════════════════════════════════════════════

function buildJobUrl(params) {
  const base = 'https://www.zhipin.com/web/geek/jobs';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v) qs.set(k, v); }
  return `${base}?${qs.toString()}`;
}

function getJobsPageUrl() {
  return state.searchUrlParams ? buildJobUrl(state.searchUrlParams) : 'https://www.zhipin.com/web/geek/jobs';
}

function buildSendQueueV6(state, jobIds) {
  return jobIds
    .filter(id => !sentJobIds.has(id))
    .map(id => {
      const job = state.jobs.find(j => (j.jobId || j.id) === id);
      return {
        jobId: id,
        hrName: job?.hrName || '',
        hrCompany: job?.hrCompany || '',
        greeting: state.greetings[id] || '',
        positionName: job?.name || '',
        companyName: job?.company || '',
        jobLink: job?.jobLink || job?.link || `https://www.zhipin.com/job_detail/${id}.html`,
      };
    });
}

function claimNextJob() {
  if (state.sendQueueV6Index >= state.sendQueueV6.length) return null;
  return state.sendQueueV6[state.sendQueueV6Index++];
}

async function startSendV6(jobIds) {
  sendAborted = false;
  sendStartTime = Date.now();
  state.sendQueueV6 = buildSendQueueV6(state, jobIds);
  state.sendQueueV6Index = 0;
  state.sendProgress = { sent: 0, total: jobIds.length };
  state.sendResults = [];
  sentJobIds.clear();
  state.phase = 'sending';
  state.sendPhase = 'stage1';
  await persistState();

  const searchTabs = await chrome.tabs.query({ url: '*://*.zhipin.com/web/geek/jobs*' });
  if (!searchTabs.length) {
    state.phase = 'idle'; state.sendPhase = '';
    await persistState();
    throw new Error('未找到BOSS直聘搜索页');
  }

  // Stage 1: 批量提取 HR 信息
  for (const tab of searchTabs) {
    if (sendAborted) break;
    const remaining = state.sendQueueV6.filter(item => !item.hrName).length;
    if (!remaining) break;
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await sleep(2000);
      state.searchTabId = tab.id;
      await runStage1();
    } catch (_) {}
  }

  if (sendAborted) return;
  await sleep(CONFIG.POST_EXTRACT_DELAY_MS);

  // 过滤提取失败 + 已沟通过
  state.sendQueueV6 = state.sendQueueV6.filter(item => item.hrName);
  const skippedAlready = state.sendQueueV6.filter(item => item.alreadyChatted);
  state.sendQueueV6 = state.sendQueueV6.filter(item => !item.alreadyChatted);
  for (const item of skippedAlready) {
    sentJobIds.add(item.jobId);
    state.sendProgress.sent++;
    state.sendResults.push({ jobId: item.jobId, positionName: item.positionName, companyName: item.companyName, success: true, alreadyChatted: true, hrName: item.hrName, time: Date.now() });
  }

  if (!state.sendQueueV6.length) { await finalizeTask('done'); return; }
  if (sendAborted) return;

  // Stage 2: 并行发送
  state.sendPhase = 'stage2';
  state.sendProgress.total = state.sendQueueV6.length;
  await persistState();
  await runStage2();
  if (sendAborted) return;

  // Stage 3: 补发
  await teardownWorkerWindows();
  await sleep(3000);
  if (sendAborted) return;
  await runRepairV6();
  await cleanupV6();
  await finishSend();
}

async function resumeSendV6() {
  // 清理残留
  for (const wid of (state._v6WorkerWindowIds || [])) try { await chrome.windows.remove(wid); } catch (_) {}
  state._v6WorkerWindowIds = [];
  for (const tid of state._v6WorkerTabIds) try { await chrome.tabs.remove(tid); } catch (_) {}
  state._v6WorkerTabIds = [];
  state._v6WorkerTabsReady.clear();

  const searchTabs = await chrome.tabs.query({ url: '*://*.zhipin.com/web/geek/jobs*' });
  if (!searchTabs.length) {
    state.phase = 'idle'; state.sendPhase = '';
    await persistState();
    return;
  }
  state.searchTabId = searchTabs[0].id;

  if (!state.sendQueueV6.length) state.sendQueueV6 = buildSendQueueV6(state, state.jobs.map(j => j.jobId || j.id));
  state.sendQueueV6Index = 0;
  state.sendPhase = 'stage1';
  await persistState();

  await runStage1();
  await sleep(CONFIG.POST_EXTRACT_DELAY_MS);
  state.sendQueueV6 = state.sendQueueV6.filter(item => item.hrName);
  state.sendPhase = 'stage2';
  await persistState();
  await runStage2();
  await teardownWorkerWindows();
  await sleep(3000);
  await runRepairV6();
  await cleanupV6();
  await finishSend();
}

// ── Stage 1: 批量提取 HR ──
async function runStage1() {
  await waitForContentScript(state.searchTabId);
  return new Promise((resolve, reject) => {
    let timedOut = false, settled = false;
    const timeout = setTimeout(() => { timedOut = true; settled = true; reject(new Error('Stage1 超时')); }, 120000);

    abortStage1 = () => { if (settled) return; settled = true; clearTimeout(timeout); resolve(); };

    const handler = (msg, sender) => {
      if (msg.type === MSG.EXTRACT_COMPLETE && sender.tab?.id === state.searchTabId) {
        if (timedOut) return;
        settled = true; clearTimeout(timeout); chrome.runtime.onMessage.removeListener(handler);
        if (msg.success) {
          for (const r of (msg.results || [])) {
            const item = state.sendQueueV6.find(q => q.jobId === r.jobId);
            if (item) { item.hrName = r.hrName; item.hrCompany = r.hrCompany; item.alreadyChatted = !!r.alreadyChatted; }
          }
          for (const s of (msg.skipped || [])) {
            const idx = state.sendQueueV6.findIndex(q => q.jobId === s.jobId);
            const qit = idx >= 0 ? state.sendQueueV6[idx] : null;
            sentJobIds.add(s.jobId);
            state.sendProgress.sent++;
            state.sendResults.push({ jobId: s.jobId, positionName: qit?.positionName || '', companyName: qit?.companyName || '', success: false, skipped: true, error: 'HR活跃不符' + (s.activeDesc ? '（' + s.activeDesc + '）' : ''), time: Date.now() });
            if (idx >= 0) state.sendQueueV6.splice(idx, 1);
          }
          pushState();
        }
        resolve();
      } else if (msg.type === MSG.EXTRACT_PROGRESS && sender.tab?.id === state.searchTabId) {
        chrome.runtime.sendMessage({ type: MSG.SEND_PROGRESS, sent: msg.extracted, total: msg.total, status: '正在提取HR信息' }).catch(() => {});
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    chrome.tabs.update(state.searchTabId, { active: true }).then(() => {
      setTimeout(() => {
        chrome.tabs.sendMessage(state.searchTabId, { type: MSG.DO_BATCH_EXTRACT, queue: state.sendQueueV6, hrActiveFilter: state.hrActiveFilter }).catch(err => {
          if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
        });
      }, 1500);
    });
  });
}

// ── Stage 2: 并行发送 ──
async function runStage2() {
  const workerCount = Math.min(CONFIG.MAX_SEND_WORKERS, state.sendQueueV6.length);
  state._v6WorkerTabIds = [];
  state._v6WorkerWindowIds = [];
  state._v6WorkerTabsReady.clear();
  state._v6RepairQueue = [];

  for (let i = 0; i < workerCount; i++) {
    const win = await chrome.windows.create({ url: 'https://www.zhipin.com/web/geek/chat', focused: false, state: 'normal', width: 1280, height: 800 });
    if (win?.id != null) state._v6WorkerWindowIds.push(win.id);
    const workerTab = win?.tabs?.[0];
    if (workerTab?.id != null) state._v6WorkerTabIds.push(workerTab.id);
  }

  // 等所有 worker 就绪
  await new Promise(resolve => {
    const check = () => {
      if (state._v6WorkerTabsReady.size >= workerCount) { resolve(); return; }
      if (state.phase !== 'sending') { resolve(); return; }
      setTimeout(check, 500);
    };
    setTimeout(resolve, 10000);
    setTimeout(check, 500);
  });

  if (state.phase !== 'sending') return;
  await Promise.allSettled(state._v6WorkerTabIds.map(tabId => runWorkerLoop(tabId)));
}

async function runWorkerLoop(tabId) {
  startWorkerKeepalive(tabId);
  try {
    while (state.phase === 'sending' && state.sendPhase === 'stage2') {
      if (sendAborted) break;
      const job = claimNextJob();
      if (!job) { try { await chrome.tabs.sendMessage(tabId, { type: MSG.QUEUE_EMPTY }); } catch (_) {} break; }

      try {
        if (sendAborted) break;
        const findResp = await chrome.tabs.sendMessage(tabId, { type: MSG.WORKER_ACTIVATE, job });
        if (!findResp?.success) {
          await recordV6Failure(job, findResp?.error || '未找到对话', 'findConv');
          state._v6RepairQueue.push(job);
          continue;
        }
        await sleep(1500);
        if (sendAborted) break;
        const sendResp = await chrome.tabs.sendMessage(tabId, { type: MSG.WORKER_SEND, job });
        if (sendResp?.success) await recordV6Success(job);
        else {
          await recordV6Failure(job, sendResp?.error || '发送失败', sendResp?.skipped === 'image' ? 'sendImage' : 'sendText');
          state._v6RepairQueue.push(job);
        }
      } catch (e) {
        await recordV6Failure(job, '通信失败: ' + e.message, 'worker_comm');
        state._v6RepairQueue.push(job);
      }

      if (state.phase === 'captcha_paused') break;
      await sleep(200);
    }
  } finally {
    stopWorkerKeepalive(tabId);
  }
}

// ── 补发 ──
async function runRepairV6() {
  if (state.phase !== 'sending') return;
  const queue = (state._v6RepairQueue || []).slice();
  if (!queue.length) return;

  let repairTabId = null, repairWinId = null;
  try {
    const win = await chrome.windows.create({ url: 'https://www.zhipin.com/web/geek/chat', focused: false, state: 'normal', width: 1280, height: 800 });
    if (win?.id != null) { repairWinId = win.id; state._v6WorkerWindowIds.push(win.id); }
    if (win?.tabs?.[0]?.id != null) repairTabId = win.tabs[0].id;
  } catch (_) {}
  if (repairTabId == null) return;

  await new Promise(resolve => {
    const deadline = Date.now() + 15000;
    const check = () => {
      if (state._v6WorkerTabsReady.has(repairTabId)) return resolve();
      if (state.phase !== 'sending' || Date.now() > deadline) return resolve();
      setTimeout(check, 300);
    };
    setTimeout(check, 500);
  });

  for (let pass = 0; pass < 2 && queue.length; pass++) {
    const still = [];
    for (const job of queue) {
      if (state.phase !== 'sending') break;
      let resp;
      try { resp = await chrome.tabs.sendMessage(repairTabId, { type: MSG.WORKER_REPAIR, job }); } catch (e) {
        resp = { complete: false, error: '通信失败: ' + e.message };
      }
      await applyRepairResult(job, resp, pass + 1);
      if (!(resp?.complete) && resp?.foundConv !== false) still.push(job);
      await sleep(800);
    }
    queue.length = 0;
    queue.push(...still);
  }

  state._v6RepairQueue = [];
  try { if (repairWinId != null) await chrome.windows.remove(repairWinId); } catch (_) {}
  if (repairWinId != null) state._v6WorkerWindowIds = state._v6WorkerWindowIds.filter(id => id !== repairWinId);
}

async function applyRepairResult(job, resp, pass) {
  const ok = !!(resp?.complete);
  for (let i = state.sendResults.length - 1; i >= 0; i--) {
    if (state.sendResults[i].jobId === job.jobId) {
      state.sendResults[i].success = ok;
      state.sendResults[i].repaired = true;
      if (ok) { state.sendResults[i].error = null; state.sendResults[i].stage = null; }
      else state.sendResults[i].error = resp?.error || 'repair未补全';
      break;
    }
  }
  pushState();
}

// ── 记录结果 ──
async function recordV6Success(item) {
  sentJobIds.add(item.jobId);
  state.sendProgress.sent++;
  state.sendResults.push({ jobId: item.jobId, positionName: item.positionName, companyName: item.companyName, success: true, hrName: item.hrName, time: Date.now() });
  pushState();
  chrome.runtime.sendMessage({ type: MSG.SEND_ITEM_RESULT, payload: { jobId: item.jobId, positionName: item.positionName, companyName: item.companyName, success: true } }).catch(() => {});
}

async function recordV6Failure(item, error, stage) {
  sentJobIds.add(item.jobId);
  state.sendProgress.sent++;
  state.sendResults.push({ jobId: item.jobId, positionName: item.positionName, companyName: item.companyName, success: false, error, stage, hrName: item.hrName, time: Date.now() });
  pushState();
  chrome.runtime.sendMessage({ type: MSG.SEND_ITEM_RESULT, payload: { jobId: item.jobId, positionName: item.positionName, companyName: item.companyName, success: false, error } }).catch(() => {});
}

// ── 终态 ──
async function finalizeTask(reason) {
  const recorded = {};
  for (const r of state.sendResults) if (r?.jobId != null) recorded[r.jobId] = true;
  for (const it of [...(state.sendQueueV6 || []), ...(state._v6RepairQueue || [])]) {
    if (!it?.jobId || recorded[it.jobId]) continue;
    recorded[it.jobId] = true;
    state.sendResults.push({ jobId: it.jobId, positionName: it.positionName || '', companyName: it.companyName || '', success: false, skipped: true, error: reason === 'stopped' ? '未投递：已停止' : '未投递', time: Date.now() });
  }
  state.sendProgress.total = state.sendResults.length;
  state.sendPhase = '';
  await persistState();
  finishSend();
}

function finishSend() {
  state.phase = 'review';
  state.sendDuration = Date.now() - sendStartTime;
  pushState();
  chrome.runtime.sendMessage({ type: MSG.SEND_COMPLETE, results: state.sendResults, duration: state.sendDuration }).catch(() => {});
}

async function stopSend() {
  sendAborted = true;
  const tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/*' });
  tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'DO_STOP' }).catch(() => {}));
  if (typeof abortStage1 === 'function') try { abortStage1(); } catch (_) {}
  stopAllWorkerKeepalives();
  for (const wid of (state._v6WorkerWindowIds || [])) try { chrome.windows.remove(wid).catch(() => {}); } catch (_) {}
  state._v6WorkerWindowIds = [];
  for (const tid of state._v6WorkerTabIds) try { chrome.tabs.remove(tid).catch(() => {}); } catch (_) {}
  state._v6WorkerTabIds = [];
  state._v6WorkerTabsReady.clear();
  await finalizeTask('stopped');
  state.sendQueueV6 = [];
  state._v6RepairQueue = [];
  await persistState();
}

// ── Worker keepalive ──
const _workerAlarmPrefix = 'bg:worker_keepalive:';
const _activeWorkerKeepalives = new Set();

function startWorkerKeepalive(tabId) {
  if (_activeWorkerKeepalives.has(tabId)) return;
  _activeWorkerKeepalives.add(tabId);
  chrome.alarms.create(_workerAlarmPrefix + tabId, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
}

function stopWorkerKeepalive(tabId) {
  if (!_activeWorkerKeepalives.has(tabId)) return;
  _activeWorkerKeepalives.delete(tabId);
  chrome.alarms.clear(_workerAlarmPrefix + tabId).catch(() => {});
}

function stopAllWorkerKeepalives() {
  for (const tabId of [..._activeWorkerKeepalives]) stopWorkerKeepalive(tabId);
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm?.name?.startsWith(_workerAlarmPrefix)) return;
  const tabId = parseInt(alarm.name.slice(_workerAlarmPrefix.length), 10);
  if (!tabId || !_activeWorkerKeepalives.has(tabId)) { chrome.alarms.clear(alarm.name).catch(() => {}); return; }
  chrome.tabs.sendMessage(tabId, { type: MSG.PING }).catch(() => {});
});

// ── 清理 ──
async function teardownWorkerWindows() {
  if (!state._v6WorkerTabIds.length && !state._v6WorkerWindowIds.length) return;
  stopAllWorkerKeepalives();
  await sleep(1500);
  for (const wid of (state._v6WorkerWindowIds || [])) try { await chrome.windows.remove(wid); } catch (_) {}
  state._v6WorkerWindowIds = [];
  for (const tid of state._v6WorkerTabIds) try { await chrome.tabs.remove(tid); } catch (_) {}
  state._v6WorkerTabIds = [];
  state._v6WorkerTabsReady.clear();
}

async function cleanupV6() {
  await teardownWorkerWindows();
  state._v6SearchReady = false;
  state.sendPhase = '';
  state.sendQueueV6 = [];
  state.sendQueueV6Index = 0;
  await persistState();
  if (state.originalMainWindowId) {
    try { await chrome.windows.update(state.originalMainWindowId, { focused: true }); } catch (_) {}
  }
}

// ── 辅助 ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTabLoad(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('页面加载超时')); }, timeoutMs);
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForContentScript(tabId, timeoutMs = 3000, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('PING timeout')), timeoutMs);
        chrome.tabs.sendMessage(tabId, { type: 'PING' }).then(resp => { clearTimeout(timer); resolve(resp); }).catch(err => { clearTimeout(timer); reject(err); });
      });
      if (response?.type === 'PONG') return true;
    } catch (err) {
      if (attempt < maxRetries - 1) await sleep(500);
    }
  }
  throw new Error('Content script not ready');
}

// ── 通知所有 CS 停止 ──
async function notifyAllStop() {
  const tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/*' });
  tabs.forEach(t => chrome.tabs.sendMessage(t.id, { type: 'DO_STOP' }).catch(() => {}));
}
