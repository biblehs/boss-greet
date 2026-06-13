// BossGreet — Popup 主入口
(async () => {
  // 初始化
  PopupState.init();

  // 加载 API 配置
  try {
    const resp = await sendMessage({ type: 'GET_API_CONFIG' });
    if (resp?.config) PopupState.apiConfig = resp.config;
  } catch (_) {}

  // 加载 SW 状态
  try {
    const resp = await sendMessage({ type: 'GET_STATE' });
    if (resp?.state) PopupState.swState = resp.state;
  } catch (_) {}

  // 渲染各页面
  renderA();
  renderB(PopupState.swState);
  renderReview(PopupState.swState);

  // 绑定事件
  bindEventsA();
  bindEventsB();

  // 页面切换
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  // ── 监听 SW 状态更新 ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE' && msg.state) {
      PopupState.swState = msg.state;
      // 根据当前页面更新渲染
      if (PopupState.page === 'b') renderB(msg.state);
      if (PopupState.page === 'review') renderReview(msg.state);
    }

    if (msg.type === 'ERROR') {
      showToast(msg.message || '发生错误');
    }

    if (msg.type === 'COLLECT_PROGRESS') {
      if (PopupState.page === 'b') {
        const statusText = msg.phase === 'jd_extract'
          ? `正在提取 JD... ${msg.jdExtracted || 0}/${msg.jdTotal || 0}`
          : `已采集 ${msg.collected || 0} 个岗位`;
        $('#sending-status-text').textContent = statusText;
      }
    }

    if (msg.type === 'SEND_PROGRESS' && PopupState.page === 'b') {
      const sp = msg;
      const pct = sp.total > 0 ? Math.round((sp.sent / sp.total) * 100) : 0;
      $('#sendProgressFill').style.width = pct + '%';
      $('#sendProgressText').textContent = `${sp.sent}/${sp.total} - ${sp.status || ''}`;
    }

    if (msg.type === 'SEND_ITEM_RESULT' && PopupState.page === 'b') {
      const logEl = $('#send-log');
      if (logEl) {
        const item = document.createElement('div');
        item.className = `send-log-item ${msg.payload?.success ? 'success' : 'fail'}`;
        item.textContent = `${msg.payload?.success ? '✓' : '✗'} ${msg.payload?.positionName || msg.payload?.jobId} - ${msg.payload?.success ? '成功' : msg.payload?.error || '失败'}`;
        logEl.appendChild(item);
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    if (msg.type === 'SEND_COMPLETE') {
      renderReview(PopupState.swState);
      showPage('review');
    }
  });

  // 初始化 filter state
  const fs = PopupState.filterState;
  $('#citySelect').value = fs.city;
  $('#searchKeyword').value = fs.keyword;
  $('#experienceSelect').value = fs.experience;
  $('#hrActiveFilter').value = fs.hrActiveFilter;
})();
