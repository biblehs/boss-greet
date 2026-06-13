// ════════════════════════════════════════════════════════════
// BossGreet — 聊天监听模块
// MutationObserver 监听 HR 消息，关键词触发自动回复简历
// ════════════════════════════════════════════════════════════

function _safeSendCS(msg) {
  try { chrome.runtime.sendMessage(msg, () => { if (chrome.runtime.lastError) {} }); } catch (_) {}
}

const ChatMonitor = {
  observer: null,
  enabled: false,
  resumeKeywords: ['简历', '附件', 'PDF', 'pdf', '清晰', '文件', '发我', '发一份', '发个', '再发', '详细的'],

  start() {
    if (this.observer) return;
    this.enabled = true;

    this.observer = new MutationObserver(mutations => {
      if (!this.enabled) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) this.checkMessages(node);
        }
      }
    });

    const chatArea = document.querySelector('.chat-main');
    this.observer.observe(chatArea || document.body, { childList: true, subtree: true });
    this.checkMessages(chatArea || document.body);
  },

  checkMessages(container) {
    const hrMessages = container.querySelectorAll?.(SELECTORS.chatDetail.hrMessage) || [];
    hrMessages.forEach(msg => this.processMessage(msg));
  },

  async processMessage(msgEl) {
    if (msgEl.dataset.bgChecked) return;
    msgEl.dataset.bgChecked = '1';
    const text = msgEl.textContent || '';
    if (!this.resumeKeywords.some(kw => text.includes(kw))) return;
    _safeSendCS({ type: 'CHAT_DETECTED', text: text.slice(0, 100) });
    await this.sendResumeAttachment();
  },

  async sendResumeAttachment() {
    try {
      const resumeBtn = document.querySelector(SELECTORS.chatDetail.resumeBtn);
      if (!resumeBtn) return;
      resumeBtn.click();
      await new Promise(r => setTimeout(r, 800));
      const item = document.querySelector(SELECTORS.chatDetail.resumeItem);
      if (!item) return;
      item.click();
      await new Promise(r => setTimeout(r, 300));
      const confirm = document.querySelector(SELECTORS.chatDetail.resumeConfirm);
      if (!confirm) return;
      confirm.click();
      _safeSendCS({ type: 'AUTO_REPLY_SENT', success: true });
    } catch (e) {
      _safeSendCS({ type: 'AUTO_REPLY_SENT', success: false, error: e.message });
    }
  },

  stop() {
    this.enabled = false;
    this.observer?.disconnect();
    this.observer = null;
  },
};
