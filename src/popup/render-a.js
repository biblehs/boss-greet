// BossGreet — Page A rendering (Settings)
function renderA() {
  // Restore form values
  const config = PopupState.apiConfig;
  $('#aiProvider').value = config.provider || 'mimo';
  if (config.apiKey) $('#apiKey').value = config.apiKey;
  if (config.model) $('#aiModel').value = config.model;

  const fs = PopupState.filterState;
  if (fs.city) $('#citySelect').value = fs.city;
  if (fs.keyword) $('#searchKeyword').value = fs.keyword;
  if (fs.experience) $('#experienceSelect').value = fs.experience;
  if (fs.hrActiveFilter) $('#hrActiveFilter').value = fs.hrActiveFilter;

  // Resume status
  updateResumeStatus();
}

function updateResumeStatus() {
  chrome.storage.local.get(['sw:resumeText', 'ui:resumeImages'], result => {
    const text = result['sw:resumeText'] || '';
    const images = result['ui:resumeImages'] || [];
    const statusEl = $('#resume-status');
    const previewEl = $('#resume-preview');
    const textPreview = $('#resume-text-preview');

    if (text) {
      statusEl.textContent = `Resume text uploaded (${text.length} chars)`;
      statusEl.style.color = '#2ecc71';
      previewEl.style.display = 'block';
      textPreview.textContent = text.slice(0, 500) + (text.length > 500 ? '...' : '');
    } else if (images.length) {
      statusEl.textContent = `${images.length} resume image(s) uploaded`;
      statusEl.style.color = '#2ecc71';
    } else {
      statusEl.textContent = 'No resume uploaded';
      statusEl.style.color = '';
      previewEl.style.display = 'none';
    }
  });
}
