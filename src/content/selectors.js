// BOSS 直聘 DOM 选择器集中管理
const SELECTORS = {
  // ── 岗位搜索页 /web/geek/jobs ──
  jobs: {
    jobCard: 'li.job-card-box',
    jobName: '.job-name',
    jobSalary: '.job-salary',
    tagList: '.tag-list li',
    company: '.job-card-footer .boss-info',
    expectSelect: 'div.c-expect-select',
    synthesis: 'a.synthesis',
    expectItem: 'a.expect-item',
    expectItemText: 'a.expect-item span.text-content',
    filterCondition: 'div.filter-condition div.c-filter-condition',
    industryDropdown: '.condition-industry-select .filter-select-dropdown',
    immediateChatBtn: 'a.op-btn-chat',
  },

  // ── 搜索页右侧详情面板（点击卡片后展开）──
  jobPanel: {
    container: '.job-detail-container, .detail-content, .job-detail-box',
    jobDesc: '.job-sec-text, .job-detail .text',
    jobTags: '.job-tags span, .tag-list li',
    bossInfo: '.job-boss-info',
    bossName: '.job-boss-info h2.name, .job-boss-info .name',
    bossAttr: '.job-boss-info .boss-info-attr',
    bossOnline: '.boss-online-tag',
    bossActive: '.boss-active-time',
  },

  // ── JD 详情页 /job_detail/{id}.html ──
  jobDetail: {
    container: '.job-detail',
    jobSecText: '.job-sec-text',
    companyName: '.company-name',
    jobName: '.job-name',
    salary: '.salary',
    tags: '.tag-list li, .job-tags span',
  },

  // ── 聊天列表页 /web/geek/chat ──
  chatList: {
    userList: '.user-list-content li',
    unreadLabel: '.label-name',
    friendContent: '.friend-content',
  },

  // ── 聊天详情页 ──
  chatDetail: {
    chatInput: 'div#chat-input.chat-input',
    btnSend: 'button.btn-send',
    hrMessage: '.message-item.item-friend',
    systemMessage: '.message-item.item-system',
    messageSent: '.item-myself',
    imageUpload: '.btn-sendimg input[type=file]',
    resumeBtn: '.toolbar-btn',
    resumeDialog: '.dialog-container',
    resumeItem: '.list-item',
    resumeConfirm: '.btn-confirm',
  },
};

// ── CAPTCHA 检测选择器 ──
const CAPTCHA_SELECTORS = [
  '.captcha-box', '.verify-box', '.geetest_box', '#captcha',
  '.yoda-modal', '.nc_wrapper', '[class*="captcha"]',
  '[class*="verify"]', '.boss-popup-captcha',
];

function detectCaptcha() {
  for (const sel of CAPTCHA_SELECTORS) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return { detected: true, selector: sel };
  }
  return { detected: false };
}
