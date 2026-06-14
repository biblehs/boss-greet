// BossGreet — Review page rendering
function renderReview(state) {
  if (!state) return;

  const results = state.sendResults || [];
  if (!results.length) {
    $('#review-empty').style.display = 'block';
    $('#review-content').style.display = 'none';
    return;
  }

  $('#review-empty').style.display = 'none';
  $('#review-content').style.display = 'block';

  // Stats
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && !r.skipped).length;
  const total = results.length;
  $('#statSuccess').textContent = success;
  $('#statFailed').textContent = failed;
  $('#statTotal').textContent = total;
  $('#statDuration').textContent = formatDuration(state.sendDuration);

  // List
  const list = $('#review-list');
  list.innerHTML = '';
  for (const r of results) {
    const cls = r.success ? 'success' : r.skipped ? 'skipped' : 'fail';
    const item = document.createElement('div');
    item.className = `review-item ${cls}`;
    item.innerHTML = `
      <div class="review-item-name">${esc(r.positionName || r.jobId)}</div>
      <div class="review-item-company">${esc(r.companyName || '')} ${r.hrName ? '| ' + esc(r.hrName) : ''}</div>
      ${r.error ? `<div class="review-item-error">${esc(r.error)}</div>` : ''}
      ${r.alreadyChatted ? '<div class="review-item-error" style="color:var(--text-muted)">Already contacted</div>' : ''}
    `;
    list.appendChild(item);
  }
}
