// Service Worker — MiMo AI + 简历分析 + 招呼语生成
importScripts('/src/shared/constants.js');
importScripts('/src/shared/error-logger.js');

// MiMo API 配置
const MIMO_CONFIG = {
  getEndpoint(apiKey) {
    return (apiKey || '').startsWith('tp-')
      ? 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions'
      : 'https://api.xiaomimimo.com/v1/chat/completions';
  },
  model: 'mimo-v2.5-pro',
  maxTokens: 4096,
  temperature: 0.3
};

// ── MiMo API 调用 ──
async function callMiMo(apiKey, messages, maxTokens = 2000, timeoutMs = 30000, label = '') {
  const tag = label ? `[BossGreet][${label}]` : '[BossGreet]';
  const t0 = Date.now();
  const endpoint = MIMO_CONFIG.getEndpoint(apiKey);
  const bodyStr = JSON.stringify({
    model: MIMO_CONFIG.model,
    messages,
    max_tokens: maxTokens,
    temperature: MIMO_CONFIG.temperature,
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    console.log(`${tag} API 调用开始 endpoint=${endpoint}`);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '未知错误');
      throw new Error(`API 错误 ${resp.status}: ${errText.substring(0, 200)}`);
    }
    const data = await resp.json();
    const elapsed = Date.now() - t0;
    console.log(`${tag} API 调用完成 ${elapsed}ms`);
    if (!data.choices || !data.choices.length) throw new Error('API 返回空结果');
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;
    console.error(`${tag} API 调用失败 ${elapsed}ms: ${err.message}`);
    ErrorLogger.logError(err.message, err.stack, 'callMiMo');
    if (err.name === 'AbortError') throw new Error(`请求超时（${timeoutMs/1000}秒），请检查网络`);
    throw err;
  }
}

// ── 简历文本分析：提取关键技能、量化成就 ──
async function analyzeResume(apiKey, resumeText) {
  const systemPrompt = `你是专业的简历分析师。分析简历文本，提取结构化信息用于求职匹配。

输出格式（严格按照此结构）：
【关键技能】
- 列出 5-8 个最相关的技术/专业技能

【量化成就】
- 列出 3-5 个有具体数字、百分比或可衡量结果的成就
- 格式："成就描述（具体指标）"
- 示例："将页面加载时间从 3.2s 降至 0.8s（提升 75%）"

【经验总结】
- 总工作年限
- 关键行业/领域
- 知名公司/职位

【匹配优势】
- 3-4 个对招聘方最有吸引力的要点
- 重点关注可迁移技能和独特价值`;

  const userPrompt = `请分析这份简历并提取关键信息：

${resumeText}`;

  return callMiMo(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 1500, 60000, '简历分析');
}

// ── 基于简历文本生成招呼语（含 JD 匹配） ──
async function generateGreetingFromText(apiKey, resumeText, resumeAnalysis, job) {
  const jdText = job.jd?.desc || job.jd?.fullDesc || job.name;
  const jdKeywords = job.jd?.keywords?.join('、') || '';

  let systemPrompt = `你是求职者本人，正在BOSS直聘上给HR发送招呼语。你的回复将直接发送给HR，严禁添加任何注释、说明、括号备注、替换建议或引导语。

【核心规则】
1. 仔细阅读"职位描述"中的具体要求（职责、技术栈、经验要求等）
2. 从"你的简历"中找到与JD要求最匹配的经验和技能
3. 包含至少1-2个量化成就（数字、百分比、金额、规模指标等）
4. 字数控制在80-120字，语气真诚专业，不要夸张
5. 如果JD提到具体技术栈，必须引用简历中的相关经验
6. 以自然、专业的结尾收尾，表达对该岗位的热情

【量化策略】
- 将模糊成就转化为数字："提升性能" → "加载时间从 3.2s 降至 0.8s（提升 75%）"
- 包含规模指标：团队人数、用户数、交易量、数据规模
- 引用业务影响：收入增长、成本降低、效率提升`;

  if (resumeAnalysis) {
    systemPrompt += `\n\n【简历亮点摘要】
${resumeAnalysis}
使用这些亮点快速匹配JD要求。优先使用与JD直接对应的成就和技能。`;
  }

  const userPrompt = `【你的简历】
${resumeText}

【目标岗位】
公司：${job.company}
职位：${job.name}
薪资：${job.salary || '未标注'}
${jdKeywords ? 'JD关键词：' + jdKeywords : ''}

【职位描述详情】
${jdText}

根据JD中的具体要求，从简历中挑选最相关的经验，写一段个性化招呼语。重点展示你能解决JD中提到的问题，并包含量化成就。`;

  return callMiMo(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], 500, 60000, '招呼语生成');
}

// ── 基于简历图片生成招呼语（原有功能） ──
async function generateGreetingFromImage(apiKey, resumeImages, category) {
  const systemPrompt = `你是求职者本人，正在BOSS直聘上给HR发送招呼语。你的回复将直接发送给HR，严禁添加任何注释、说明、括号备注、替换建议或引导语。

【关键指令】
1. 仔细阅读附带的简历图片，从中提取以下具体信息：姓名、当前/最近公司、工作年限、擅长技能、项目经验、教育背景
2. 根据提取到的简历信息，结合目标岗位，写一段个性化的打招呼语
3. 招呼语中必须包含简历中的具体信息（至少2项，如具体技能、行业经验、项目成果等），让HR感受到你认真阅读过岗位要求
4. 包含量化成就（数字、百分比等）
5. 字数控制在80-120字，语气真诚专业，不要夸张

如果简历图片无法阅读，请回复"请重新上传清晰的简历图片"`;

  const content = [];
  if (resumeImages && resumeImages.length > 0) {
    for (const img of resumeImages.slice(0, 2)) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.type};base64,${img.base64}` }
      });
    }
  }
  content.push({ type: 'text', text: '这是我的简历图片。\n请根据我的简历内容（尤其是工作经历、技能和项目经验），写一段针对该岗位的招呼语。' });
  content.push({ type: 'text', text: `应聘岗位：${category}` });

  return callMiMo(apiKey, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content },
  ], 200, 120000, `招呼语:${category}`);
}

// ── 简历图片缓存 ──
let _cachedResumeImages = null;

async function loadResumeImages() {
  if (_cachedResumeImages !== null) return _cachedResumeImages;
  try {
    const { resumeImages: stored } = await chrome.storage.local.get('resumeImages');
    if (!stored || !Array.isArray(stored) || stored.length === 0) {
      _cachedResumeImages = [];
      return [];
    }
    const toProcess = stored.slice(0, 2);
    const results = [];
    for (const s of toProcess) {
      const bytes = new Uint8Array(s.data);
      const mimeType = s.type || 'image/png';
      try {
        const blob = new Blob([bytes], { type: mimeType });
        const bitmap = await createImageBitmap(blob);
        const MAX_W = 1024;
        let w = bitmap.width, h = bitmap.height;
        if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        const compressedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        bitmap.close();
        const base64 = await new Promise(r => {
          const reader = new FileReader();
          reader.onloadend = () => r(result.split(',')[1]);
          reader.readAsDataURL(compressedBlob);
        });
        results.push({ type: 'image/jpeg', base64 });
      } catch (e) {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        results.push({ type: mimeType, base64: btoa(binary) });
      }
    }
    _cachedResumeImages = results;
    return results;
  } catch (e) {
    _cachedResumeImages = [];
    return [];
  }
}

// ── 重写招呼语 ──
async function rewriteGreeting(apiKey, originalGreeting, instruction) {
  return callMiMo(apiKey, [
    { role: 'system', content: '你是求职助手，帮助用户优化招呼语。保持专业、真诚的语气。' },
    { role: 'user', content: `原招呼语：\n"${originalGreeting}"\n\n请根据以下要求重写：${instruction}\n\n输出要求：100-150字。` },
  ], 500, 30000, '重写招呼语');
}

// ── 状态管理 ──
let state = {
  phase: 'idle',
  jobs: [],
  greetings: {},
  greetingProgress: { done: 0, total: 0 },
  sendProgress: { sent: 0, total: 0 },
  autoReplyCount: 0,
  sendResults: [],
  sendDuration: 0,
  searchUrlParams: null,
  chatTabId: null,
  sendQueue: [],
  sendIndex: 0,
  searchTabId: null,
  sendPhase: '',
  sendQueueV6: [],
  sendQueueV6Index: 0,
  _v6WorkerTabIds: [],
  _v6WorkerWindowIds: [],
  _v6SearchReady: false,
  _v6WorkerTabsReady: new Set(),
  _v6RepairQueue: [],
  originalMainWindowId: null,
  // 新增：简历文本和分析结果
  resumeText: '',
  resumeAnalysis: null,
};

const sentJobIds = new Set();
let sendStartTime = 0;
let abortStage1 = null;
let sendAborted = false;

function claimNextJob(state) {
  if (state.sendQueueV6Index >= state.sendQueueV6.length) return null;
  return state.sendQueueV6[state.sendQueueV6Index++];
}

function buildSendQueueV6(state, jobIds) {
  return jobIds
    .filter(id => !sentJobIds.has(id))
    .map(id => {
      const job = state.jobs.find(j => (j.jobId || j.id) === id);
      return {
        jobId: id,
        hrName: '',
        hrCompany: '',
        greeting: state.greetings[id] || '',
        positionName: job ? (job.name || '') : '',
        companyName: job ? (job.company || '') : '',
        jobLink: job ? (job.jobLink || `https://www.zhipin.com/job_detail/${id}.html`) : ''
      };
    });
}

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
      'sw:resumeText': state.resumeText,
      'sw:resumeAnalysis': state.resumeAnalysis,
    }).catch(() => {});
  }, 500);
}

function pushState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {});
  persistState();
}

// ── 全局错误捕获 ──
self.addEventListener('error', e => console.error('[BossGreet] SW error:', e.message));
self.addEventListener('unhandledrejection', e => console.error('[BossGreet] SW rejection:', e.reason?.message));

// ── 启动恢复 ──
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.storage.local.get([
  STORAGE_KEYS.SW.PHASE, STORAGE_KEYS.SW.JOBS, STORAGE_KEYS.SW.GREETINGS,
  STORAGE_KEYS.SW.SEND_PROGRESS, STORAGE_KEYS.SW.SENT_JOB_IDS,
  STORAGE_KEYS.SW.SEND_RESULTS, STORAGE_KEYS.SW.SEND_DURATION,
  STORAGE_KEYS.SW.SEARCH_URL, STORAGE_KEYS.SW.SEND_QUEUE_V6,
  STORAGE_KEYS.SW.SEND_QUEUE_INDEX, STORAGE_KEYS.SW.SEND_PHASE,
  'sw:resumeText', 'sw:resumeAnalysis',
], result => {
  if (result[STORAGE_KEYS.SW.SEARCH_URL]) state.searchUrlParams = result[STORAGE_KEYS.SW.SEARCH_URL];
  if (result['sw:resumeText']) state.resumeText = result['sw:resumeText'];
  if (result['sw:resumeAnalysis']) state.resumeAnalysis = result['sw:resumeAnalysis'];

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

// ── 消息路由 ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'CS_DBG') {
    console.log('[BossGreet][CS_DBG] tab=' + (sender?.tab?.id || '?'), msg.stage, msg.info || {});
    return;
  }
  if (msg && msg.type === 'EXT_ERROR') {
    ErrorLogger.logError(String(msg.msg || ''), msg.stack || '', (msg.src || 'client') + ' error');
    return;
  }

  switch (msg.type) {
    case 'GET_STATE':
      sendResponse({ success: true, state });
      break;

    case 'START_COLLECT':
      startCollect(msg.params).then(() => sendResponse({ success: true })).catch(e => {
        ErrorLogger.logError(e.message, e.stack, 'START_COLLECT');
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
        chrome.runtime.sendMessage({ type: 'ERROR', message: '未找到匹配岗位' }).catch(() => {});
        sendResponse({ success: true }); break;
      }
      // 立即启动招呼语生成
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

    case 'GET_API_KEY':
      chrome.storage.local.get('apiKey', r => sendResponse({ success: true, apiKey: r.apiKey || '' }));
      return true;

    case 'SAVE_API_KEY':
      chrome.storage.local.set({ apiKey: msg.apiKey }, () => sendResponse({ success: true }));
      return true;

    case 'EXTRACT_RESUME':
      extractResume(msg.data, msg.format || 'text').then(text => sendResponse({ success: true, text })).catch(e => sendResponse({ success: false, error: e.message }));
      return true;

    case 'ANALYZE_RESUME':
      doAnalyzeResume().then(analysis => sendResponse({ success: true, analysis })).catch(e => sendResponse({ success: false, error: e.message }));
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
  if (type === 'text') text = data;
  else if (type === 'pdf') text = data; // PDF 在 popup 解析后传入
  state.resumeText = text;
  state.resumeAnalysis = null; // 重新上传时清除分析
  pushState();
  return text;
}

// ── 简历分析 ──
async function doAnalyzeResume() {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('请先配置 API Key');
  if (!state.resumeText) throw new Error('请先上传简历');

  const analysis = await analyzeResume(apiKey, state.resumeText);
  state.resumeAnalysis = analysis;
  pushState();
  return analysis;
}

// ── 获取 API Key ──
async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  return apiKey || '';
}

// ── 招呼语并发生成 ──
let greetingPromise = null;

async function generateAllGreetingsConcurrent() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    chrome.runtime.sendMessage({ type: 'ERROR', message: '请先配置 API Key' }).catch(() => {});
    return;
  }

  const resumeText = state.resumeText;
  const resumeAnalysis = state.resumeAnalysis;
  const resumeImages = await loadResumeImages();

  // 确定需要生成招呼语的岗位
  const jobsToGenerate = state.jobs.filter(j => {
    const id = j.jobId || j.id;
    const existing = state.greetings[id];
    return !existing || existing.includes('生成失败');
  });

  const total = jobsToGenerate.length;
  if (!total) return;

  state.greetingProgress = { done: 0, total };
  pushState();

  const CONCURRENCY = 3;
  const TIMEOUT_MS = 120000;
  let doneCount = 0;

  for (let i = 0; i < jobsToGenerate.length; i += CONCURRENCY) {
    const batch = jobsToGenerate.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(job =>
      (async () => {
        const jobId = job.jobId || job.id;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            let greeting;
            if (resumeText) {
              // 有简历文本：使用文本匹配模式（更精准）
              greeting = await generateGreetingFromText(apiKey, resumeText, resumeAnalysis, job);
            } else if (resumeImages.length > 0) {
              // 只有图片：使用图片模式
              greeting = await generateGreetingFromImage(apiKey, resumeImages, job.name);
            } else {
              throw new Error('请上传简历');
            }
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

async function regenerateGreeting(jobId) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('请先配置 API Key');
  const job = state.jobs.find(j => (j.jobId || j.id) === jobId);
  if (!job) throw new Error('未找到岗位');

  let greeting;
  if (state.resumeText) {
    greeting = await generateGreetingFromText(apiKey, state.resumeText, state.resumeAnalysis, job);
  } else {
    const resumeImages = await loadResumeImages();
    greeting = await generateGreetingFromImage(apiKey, resumeImages, job.name);
  }
  state.greetings[jobId] = greeting;
  pushState();
  return greeting;
}

// ════════════════════════════════════════════════════════════
// 采集控制（使用 jitou 的逻辑）
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

async function startCollect(params) {
  console.log('[BossGreet] startCollect 开始');
  state.phase = 'collecting';
  state.jobs = [];
  state.greetings = {};
  sentJobIds.clear();
  state.sendResults = [];
  state.sendDuration = 0;
  state.sendProgress = { sent: 0, total: 0 };
  if (params?.urlParams) state.searchUrlParams = params.urlParams;
  pushState();

  try {
    const url = buildJobUrl(params.urlParams || {});
    console.log('[BossGreet] 导航到:', url);

    const tabs = await chrome.tabs.query({ url: '*://*.zhipin.com/web/geek/jobs*' });
    let tabId;
    if (tabs.length) {
      tabId = tabs[0].id;
      await chrome.tabs.update(tabId, { url, active: true });
    } else {
      const tab = await chrome.tabs.create({ url, active: true });
      tabId = tab.id;
    }

    console.log('[BossGreet] Tab ID:', tabId);
    await waitForTabLoad(tabId);
    console.log('[BossGreet] 页面加载完成');
    await sleep(2000); // 等待内容脚本注入
    await waitForContentScript(tabId);
    console.log('[BossGreet] 内容脚本就绪，发送 DO_COLLECT');
    await chrome.tabs.sendMessage(tabId, { type: 'DO_COLLECT', params });
    console.log('[BossGreet] DO_COLLECT 已发送');
  } catch (e) {
    console.error('[BossGreet] startCollect 失败:', e.message);
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
// v6 发送协调
// ════════════════════════════════════════════════════════════

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
  await sleep(3000);

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

  state.sendPhase = 'stage2';
  state.sendProgress.total = state.sendQueueV6.length;
  await persistState();
  await runStage2();
  if (sendAborted) return;

  await teardownWorkerWindows();
  await sleep(3000);
  if (sendAborted) return;
  await runRepairV6();
  await cleanupV6();
  await finishSend();
}

async function resumeSendV6() {
  for (const wid of (state._v6WorkerWindowIds || [])) try { await chrome.windows.remove(wid); } catch (_) {}
  state._v6WorkerWindowIds = [];
  for (const tid of state._v6WorkerTabIds) try { await chrome.tabs.remove(tid); } catch (_) {}
  state._v6WorkerTabIds = [];
  state._v6WorkerTabsReady.clear();

  const searchTabs = await chrome.tabs.query({ url: '*://*.zhipin.com/web/geek/jobs*' });
  if (!searchTabs.length) { state.phase = 'idle'; state.sendPhase = ''; await persistState(); return; }
  state.searchTabId = searchTabs[0].id;

  if (!state.sendQueueV6.length) state.sendQueueV6 = buildSendQueueV6(state, state.jobs.map(j => j.jobId || j.id));
  state.sendQueueV6Index = 0;
  state.sendPhase = 'stage1';
  await persistState();

  await runStage1();
  await sleep(3000);
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

async function runStage1() {
  await waitForContentScript(state.searchTabId);
  return new Promise((resolve, reject) => {
    let timedOut = false, settled = false;
    const timeout = setTimeout(() => { timedOut = true; settled = true; reject(new Error('Stage 1 超时')); }, 120000);
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
        chrome.runtime.sendMessage({ type: MSG.SEND_PROGRESS, sent: msg.extracted, total: msg.total, status: '提取HR信息中...' }).catch(() => {});
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

async function runStage2() {
  const workerCount = Math.min(3, state.sendQueueV6.length);
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
      const job = claimNextJob(state);
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
        await recordV6Failure(job, '通信失败：' + e.message, 'worker_comm');
        state._v6RepairQueue.push(job);
      }

      if (state.phase === 'captcha_paused') break;
      await sleep(200);
    }
  } finally {
    stopWorkerKeepalive(tabId);
  }
}

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
        resp = { complete: false, error: '通信失败：' + e.message };
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
      else state.sendResults[i].error = resp?.error || '补发未完成';
      break;
    }
  }
  pushState();
}

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

// ── 辅助函数 ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTabLoad(tabId, timeoutMs = 15000) {
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

async function waitForContentScript(tabId, timeoutMs = 5000, maxRetries = 8) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('PING timeout')), timeoutMs);
        chrome.tabs.sendMessage(tabId, { type: 'PING' }).then(resp => { clearTimeout(timer); resolve(resp); }).catch(err => { clearTimeout(timer); reject(err); });
      });
      if (response?.type === 'PONG') {
        console.log('[BossGreet] 内容脚本就绪，尝试次数:', attempt + 1);
        return true;
      }
    } catch (err) {
      console.warn(`[BossGreet] PING 尝试 ${attempt + 1}/${maxRetries} 失败:`, err.message);
      if (attempt === 2) {
        console.log('[BossGreet] 尝试手动注入内容脚本...');
        try {
          await injectContentScript(tabId);
          await sleep(1000);
        } catch (injectErr) {
          console.warn('[BossGreet] 手动注入失败:', injectErr.message);
        }
      }
      if (attempt < maxRetries - 1) await sleep(1500);
    }
  }
  throw new Error('内容脚本未就绪');
}

async function injectContentScript(tabId) {
  const scripts = [
    'src/content/selectors.js',
    'src/content/salary-decoder.js',
    'src/shared/error-logger.js',
    'src/content/job-collector.js',
    'src/content/job-sender.js',
    'src/content/content.js',
  ];
  for (const script of scripts) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [script] });
  }
  console.log('[BossGreet] 内容脚本已手动注入');
}
