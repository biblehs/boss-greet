// ════════════════════════════════════════════════════════════
// BossGreet — Unified Constants (Single Source of Truth)
// ════════════════════════════════════════════════════════════

const MSG = {
  // Popup → SW
  GET_STATE: 'GET_STATE',
  START_COLLECT: 'START_COLLECT',
  STOP_COLLECT: 'STOP_COLLECT',
  START_SEND: 'START_SEND',
  STOP_SEND: 'STOP_SEND',
  REGENERATE_GREETING: 'REGENERATE_GREETING',
  UPDATE_GREETING: 'UPDATE_GREETING',
  GET_API_CONFIG: 'GET_API_CONFIG',
  SAVE_API_CONFIG: 'SAVE_API_CONFIG',
  TEST_GREETING: 'TEST_GREETING',
  EXTRACT_RESUME: 'EXTRACT_RESUME',

  // SW → Popup
  STATE_UPDATE: 'STATE_UPDATE',
  ERROR: 'ERROR',

  // Content → SW
  JOBS_COLLECTED: 'JOBS_COLLECTED',
  COLLECT_PROGRESS: 'COLLECT_PROGRESS',
  SEND_PROGRESS: 'SEND_PROGRESS',
  SEND_ITEM_RESULT: 'SEND_ITEM_RESULT',
  SEND_COMPLETE: 'SEND_COMPLETE',
  JD_FETCHED: 'JD_FETCHED',
  CS_READY: 'CS_READY',
  PONG: 'PONG',

  // SW → Content
  DO_COLLECT: 'DO_COLLECT',
  DO_FETCH_JD: 'DO_FETCH_JD',
  DO_STOP: 'DO_STOP',
  PING: 'PING',

  // Send architecture
  DO_BATCH_EXTRACT: 'DO_BATCH_EXTRACT',
  EXTRACT_PROGRESS: 'EXTRACT_PROGRESS',
  EXTRACT_COMPLETE: 'EXTRACT_COMPLETE',
  WORKER_ACTIVATE: 'WORKER_ACTIVATE',
  WORKER_SEND: 'WORKER_SEND',
  WORKER_REPAIR: 'WORKER_REPAIR',
  QUEUE_EMPTY: 'QUEUE_EMPTY',

  // CAPTCHA
  CAPTCHA_DETECTED: 'CAPTCHA_DETECTED',
};

const STORAGE_KEYS = {
  SW: {
    PHASE: 'sw:phase',
    JOBS: 'sw:jobs',
    GREETINGS: 'sw:greetings',
    SEND_PROGRESS: 'sw:sendProgress',
    SENT_JOB_IDS: 'sw:sentJobIds',
    SEND_RESULTS: 'sw:sendResults',
    SEND_DURATION: 'sw:sendDuration',
    SEARCH_URL: 'sw:searchUrl',
    SEND_QUEUE_V6: 'sw:sendQueueV6',
    SEND_QUEUE_INDEX: 'sw:sendQueueIndex',
    SEND_PHASE: 'sw:sendPhase',
    RESUME_TEXT: 'sw:resumeText',
  },
  UI: {
    API_CONFIG: 'ui:apiConfig',
    RESUME_IMAGES: 'ui:resumeImages',
    FILTER_STATE: 'ui:filterState',
    JOB_CUSTOM: 'ui:jobCustom',
  },
};

const CONFIG = {
  MAX_JOBS_PER_GROUP: 6,
  GREETING_CONCURRENCY: 5,
  GREETING_TIMEOUT_MS: 120000,
  BATCH_SIZE: 50,
  SEND_INTERVAL_MIN_MS: 2000,
  SEND_INTERVAL_MAX_MS: 4000,
  MAX_COLLECT_TABS: 2,
  RESUME_MAX_COUNT: 5,
  MAX_SEND_WORKERS: 3,
  EXTRACT_CARD_DELAY_MS: 1500,
  CONVERSATION_POLL_MS: 500,
  CONVERSATION_TIMEOUT_MS: 6000,
  POST_EXTRACT_DELAY_MS: 3000,
  FILL_SETTLE_MS: 700,
  IMG_UPLOAD_TIMEOUT_MS: 15000,
  KEEPALIVE_PERIOD_MIN: 0.5,
  JD_FETCH_TIMEOUT_MS: 10000,
  JD_MIN_LENGTH: 50,
};

// AI provider configuration templates
const AI_PROVIDERS = {
  qwen: {
    name: 'Alibaba Qwen (DashScope)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    headers(apiKey) {
      return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    },
    buildBody(model, messages, opts) {
      return {
        model,
        messages,
        max_tokens: opts.maxTokens || 500,
        temperature: opts.temperature || 0.4,
      };
    },
    parseContent(data) {
      if (!data.choices || !data.choices.length) throw new Error('Empty API response');
      return data.choices[0].message.content;
    },
  },
  mimo: {
    name: 'Xiaomi MiMo',
    // tp- keys use Token Plan endpoint (SGP), sk- keys use pay-as-you-go endpoint
    getEndpoint(apiKey) {
      return (apiKey || '').startsWith('tp-')
        ? 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions'
        : 'https://api.xiaomimimo.com/v1/chat/completions';
    },
    defaultModel: 'mimo-v2.5-pro',
    headers(apiKey) {
      return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    },
    buildBody(model, messages, opts) {
      return {
        model: model || 'mimo-v2.5-pro',
        messages,
        max_tokens: opts.maxTokens || 500,
        temperature: opts.temperature || 0.4,
      };
    },
    parseContent(data) {
      if (!data.choices || !data.choices.length) throw new Error('Empty API response');
      return data.choices[0].message.content;
    },
  },
  openai: {
    name: 'OpenAI (GPT)',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    headers(apiKey) {
      return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    },
    buildBody(model, messages, opts) {
      return {
        model,
        messages,
        max_tokens: opts.maxTokens || 500,
        temperature: opts.temperature || 0.4,
      };
    },
    parseContent(data) {
      if (!data.choices || !data.choices.length) throw new Error('Empty API response');
      return data.choices[0].message.content;
    },
  },
  claude: {
    name: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    headers(apiKey) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
    },
    buildBody(model, messages, opts) {
      const systemMsg = messages.find(m => m.role === 'system');
      const otherMsgs = messages.filter(m => m.role !== 'system');
      const body = {
        model,
        messages: otherMsgs,
        max_tokens: opts.maxTokens || 500,
        temperature: opts.temperature || 0.4,
      };
      if (systemMsg) body.system = systemMsg.content;
      return body;
    },
    parseContent(data) {
      if (!data.content || !data.content.length) throw new Error('Empty API response');
      return data.content[0].text;
    },
  },
};
