// BossGreet — Popup main entry
(async () => {
  // Initialize
  PopupState.init();

  // Load API configuration
  try {
    const resp = await sendMessage({ type: 'GET_API_CONFIG' });
    if (resp?.config) PopupState.apiConfig = resp.config;
  } catch (_) {}

  // Load SW state
  try {
    const resp = await sendMessage({ type: 'GET_STATE' });
    if (resp?.state) PopupState.swState = resp.state;
  } catch (_) {}

  // Render pages
  renderA();
  renderB(PopupState.swState);
  renderReview(PopupState.swState);

  // Bind events
  bindEventsA();
  bindEventsB();

  // Page switching
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  // Listen for SW state updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE' && msg.state) {
      PopupState.swState = msg.state;
      // Update rendering based on current page
      if (PopupState.page === 'b') renderB(msg.state);
      if (PopupState.page === 'review') renderReview(msg.state);
    }

    if (msg.type === 'ERROR') {
      showToast(msg.message || 'An error occurred');
    }

    if (msg.type === 'COLLECT_PROGRESS') {
      if (PopupState.page === 'b') {
        const statusText = msg.phase === 'jd_extract'
          ? `Extracting JD... ${msg.jdExtracted || 0}/${msg.jdTotal || 0}`
          : `Collected ${msg.collected || 0} opportunities`;
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
        item.textContent = `${msg.payload?.success ? '✓' : '✗'} ${msg.payload?.positionName || msg.payload?.jobId} - ${msg.payload?.success ? 'Sent' : msg.payload?.error || 'Failed'}`;
        logEl.appendChild(item);
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    if (msg.type === 'SEND_COMPLETE') {
      renderReview(PopupState.swState);
      showPage('review');
    }
  });

  // Initialize filter state
  const fs = PopupState.filterState;
  $('#citySelect').value = fs.city;
  $('#searchKeyword').value = fs.keyword;
  $('#experienceSelect').value = fs.experience;
  $('#hrActiveFilter').value = fs.hrActiveFilter;
})();
