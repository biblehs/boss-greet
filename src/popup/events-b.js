// BossGreet — Page B event bindings (Outreach)
function bindEventsB() {
  // Start collecting
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
    if (!fs.keyword) { showToast('Please enter search keywords'); return; }
    try {
      await sendMessage({ type: 'START_COLLECT', params });
    } catch (err) {
      showToast('Collection failed: ' + err.message);
    }
  });

  // Stop collecting
  $('#btnStopCollect')?.addEventListener('click', async () => {
    try { await sendMessage({ type: 'STOP_COLLECT' }); } catch (_) {}
  });

  // Send all greetings
  $('#btnStartSend')?.addEventListener('click', async () => {
    const state = PopupState.swState;
    if (!state?.jobs?.length) { showToast('No opportunities to send greetings to'); return; }

    // Check if all greetings have been generated
    const missing = state.jobs.filter(j => {
      const g = state.greetings?.[j.jobId || j.id];
      return !g || g.includes('Generation failed');
    });
    if (missing.length) {
      showToast(`${missing.length} greeting(s) not yet generated, please wait`);
      return;
    }

    const jobIds = state.jobs.map(j => j.jobId || j.id);
    try {
      await sendMessage({ type: 'START_SEND', jobIds, hrActiveFilter: PopupState.filterState.hrActiveFilter });
    } catch (err) {
      showToast('Send failed: ' + err.message);
    }
  });

  // Stop sending
  $('#btnStopSend')?.addEventListener('click', async () => {
    try { await sendMessage({ type: 'STOP_SEND' }); } catch (_) {}
  });

  // Edit greeting (event delegation)
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
      if (!newGreeting) { showToast('Greeting cannot be empty'); return; }
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
      regenBtn.textContent = 'Generating...';
      regenBtn.disabled = true;
      sendMessage({ type: 'REGENERATE_GREETING', jobId }).then(resp => {
        regenBtn.textContent = 'Regenerate';
        regenBtn.disabled = false;
        if (resp?.success) {
          const card = regenBtn.closest('.greeting-box');
          const textEl = card.querySelector('.greeting-text');
          textEl.style.display = '';
          textEl.textContent = resp.greeting;
          textEl.style.color = '';
          card.querySelector('.greeting-edit').value = resp.greeting;
        } else showToast('Generation failed: ' + (resp?.error || ''));
      }).catch(err => {
        regenBtn.textContent = 'Regenerate';
        regenBtn.disabled = false;
        showToast('Generation failed: ' + err.message);
      });
      return;
    }
  });

  // Send again
  $('#btnRedo')?.addEventListener('click', () => {
    showPage('b');
  });
}
