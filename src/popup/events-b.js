// BossGreet — B 页事件绑定（投递页）
function bindEventsB() {
  // ── 开始采集 ──
  $('#btnStartCollect')?.addEventListener('click', async () => {
    const fs = PopupState.filterState;
    const params = {
      urlParams: {
        city: fs.city,
        query: fs.keyword,
        experience: fs.experience,
      },
      hrActiveFilter: fs.hrActiveFilter,
    };
    if (!fs.keyword) { showToast('请输入搜索关键词'); return; }
    try {
      await sendMessage({ type: 'START_COLLECT', params });
    } catch (err) {
      showToast('采集启动失败: ' + err.message);
    }
  });

  // ── 停止采集 ──
  $('#btnStopCollect')?.addEventListener('click', async () => {
    try { await sendMessage({ type: 'STOP_COLLECT' }); } catch (_) {}
  });

  // ── 一键投递 ──
  $('#btnStartSend')?.addEventListener('click', async () => {
    const state = PopupState.swState;
    if (!state?.jobs?.length) { showToast('没有可投递的岗位'); return; }

    // 检查招呼语是否都生成完了
    const missing = state.jobs.filter(j => {
      const g = state.greetings?.[j.jobId || j.id];
      return !g || g.includes('生成失败');
    });
    if (missing.length) {
      showToast(`${missing.length} 条招呼语尚未生成，请等待`);
      return;
    }

    const jobIds = state.jobs.map(j => j.jobId || j.id);
    try {
      await sendMessage({ type: 'START_SEND', jobIds, hrActiveFilter: PopupState.filterState.hrActiveFilter });
    } catch (err) {
      showToast('投递启动失败: ' + err.message);
    }
  });

  // ── 停止投递 ──
  $('#btnStopSend')?.addEventListener('click', async () => {
    try { await sendMessage({ type: 'STOP_SEND' }); } catch (_) {}
  });

  // ── 编辑招呼语（事件委托）──
  document.addEventListener('click', e => {
    const editBtn = e.target.closest('.btn-edit-greeting');
    if (editBtn) {
      const jobId = editBtn.dataset.jobId;
      const card = editBtn.closest('.greeting-box');
      card.querySelector('.greeting-text')?.style.setProperty('display', 'none');
      const textarea = card.querySelector('.greeting-edit');
      textarea.style.display = 'block';
      editBtn.style.display = 'none';
      card.querySelector('.btn-save-greeting').style.display = '';
      textarea.focus();
      return;
    }

    const saveBtn = e.target.closest('.btn-save-greeting');
    if (saveBtn) {
      const jobId = saveBtn.dataset.jobId;
      const card = saveBtn.closest('.greeting-box');
      const textarea = card.querySelector('.greeting-edit');
      const newGreeting = textarea.value.trim();
      if (!newGreeting) { showToast('招呼语不能为空'); return; }
      sendMessage({ type: 'UPDATE_GREETING', jobId, greeting: newGreeting });
      textarea.style.display = 'none';
      const textEl = card.querySelector('.greeting-text');
      textEl.style.display = '';
      textEl.textContent = newGreeting;
      textEl.style.color = '';
      saveBtn.style.display = 'none';
      card.querySelector('.btn-edit-greeting').style.display = '';
      return;
    }

    const regenBtn = e.target.closest('.btn-regen-greeting');
    if (regenBtn) {
      const jobId = regenBtn.dataset.jobId;
      regenBtn.textContent = '生成中...';
      regenBtn.disabled = true;
      sendMessage({ type: 'REGENERATE_GREETING', jobId }).then(resp => {
        regenBtn.textContent = '重新生成';
        regenBtn.disabled = false;
        if (resp?.success) {
          const card = regenBtn.closest('.greeting-box');
          const textEl = card.querySelector('.greeting-text');
          textEl.style.display = '';
          textEl.textContent = resp.greeting;
          textEl.style.color = '';
          card.querySelector('.greeting-edit').value = resp.greeting;
        } else showToast('生成失败: ' + (resp?.error || ''));
      }).catch(err => {
        regenBtn.textContent = '重新生成';
        regenBtn.disabled = false;
        showToast('生成失败: ' + err.message);
      });
      return;
    }
  });

  // ── 重新投递 ──
  $('#btnRedo')?.addEventListener('click', () => {
    showPage('b');
  });
}
