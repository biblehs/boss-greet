// BossGreet — A 页渲染（配置）
function renderA() {
  // 恢复表单值
  const config = PopupState.apiConfig;
  $('#aiProvider').value = config.provider || 'mimo';
  if (config.apiKey) $('#apiKey').value = config.apiKey;
  if (config.model) $('#aiModel').value = config.model;

  const fs = PopupState.filterState;
  if (fs.city) $('#citySelect').value = fs.city;
  if (fs.keyword) $('#searchKeyword').value = fs.keyword;
  if (fs.experience) $('#experienceSelect').value = fs.experience;
  if (fs.hrActiveFilter) $('#hrActiveFilter').value = fs.hrActiveFilter;

  // 简历状态
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
      statusEl.textContent = `已上传简历文本（${text.length} 字）`;
      statusEl.style.color = '#2ecc71';
      previewEl.style.display = 'block';
      textPreview.textContent = text.slice(0, 500) + (text.length > 500 ? '...' : '');
    } else if (images.length) {
      statusEl.textContent = `已上传 ${images.length} 张简历图片`;
      statusEl.style.color = '#2ecc71';
    } else {
      statusEl.textContent = '未上传简历';
      statusEl.style.color = '';
      previewEl.style.display = 'none';
    }
  });
}
