// BossGreet — B 页渲染（投递）
function renderB(state) {
  if (!state) return;

  if (state.phase === 'collecting') {
    $('#b-empty').style.display = 'none';
    $('#b-content').style.display = 'none';
    $('#b-sending').style.display = 'block';
    $('#sending-status-text').textContent = '正在采集岗位...';
    return;
  }

  if (state.phase === 'sending') {
    $('#b-empty').style.display = 'none';
    $('#b-content').style.display = 'none';
    $('#b-sending').style.display = 'block';
    renderSending(state);
    return;
  }

  $('#b-sending').style.display = 'none';

  if (!state.jobs || state.jobs.length === 0) {
    $('#b-empty').style.display = 'block';
    $('#b-content').style.display = 'none';
    return;
  }

  $('#b-empty').style.display = 'none';
  $('#b-content').style.display = 'block';

  // 岗位数量
  $('#job-count').textContent = `${state.jobs.length} 个岗位`;

  // 招呼语生成进度
  if (state.greetingProgress && state.greetingProgress.total > 0) {
    const gp = state.greetingProgress;
    const pct = gp.total > 0 ? Math.round((gp.done / gp.total) * 100) : 0;
    $('#greeting-progress').style.display = 'block';
    $('#greetingProgressFill').style.width = pct + '%';
    $('#greetingProgressText').textContent = `生成招呼语 ${gp.done}/${gp.total}`;
  } else {
    $('#greeting-progress').style.display = 'none';
  }

  // 岗位列表
  renderJobList(state);
}

function renderJobList(state) {
  const container = $('#job-groups');
  container.innerHTML = '';

  for (const job of state.jobs) {
    const jobId = job.jobId || job.id;
    const greeting = state.greetings?.[jobId] || '';
    const greetingStatus = greeting.includes('生成失败') ? 'fail'
      : greeting ? 'ok' : 'pending';

    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <div class="job-card-header">
        <div>
          <div class="job-card-name">${esc(job.name)}</div>
          <div class="job-card-company">${esc(job.company)}</div>
        </div>
        <div class="job-card-salary">${esc(job.salary || '')}</div>
      </div>
      ${job.jd?.desc ? `<div class="job-card-jd">${esc(job.jd.desc.slice(0, 100))}</div>` : ''}
      <div class="greeting-box">
        ${greetingStatus === 'ok'
          ? `<div class="greeting-text">${esc(greeting)}</div>`
          : greetingStatus === 'fail'
            ? `<div class="greeting-text" style="color:var(--danger)">${esc(greeting)}</div>`
            : `<div class="greeting-text" style="color:var(--text-muted)">招呼语生成中...</div>`
        }
        <textarea class="greeting-edit" style="display:none" data-job-id="${jobId}">${esc(greeting)}</textarea>
        <div class="greeting-actions">
          <button class="btn-small btn-edit-greeting" data-job-id="${jobId}">编辑</button>
          <button class="btn-small btn-save-greeting" data-job-id="${jobId}" style="display:none">保存</button>
          <button class="btn-small btn-regen-greeting" data-job-id="${jobId}">重新生成</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  }
}

function renderSending(state) {
  const sp = state.sendProgress || { sent: 0, total: 0 };
  const pct = sp.total > 0 ? Math.round((sp.sent / sp.total) * 100) : 0;
  $('#sendProgressFill').style.width = pct + '%';
  $('#sendProgressText').textContent = `${sp.sent}/${sp.total}`;

  const phase = state.sendPhase || '';
  const phaseText = {
    stage1: '正在提取 HR 信息...',
    stage2: '正在并行发送...',
    '': '正在投递...',
  }[phase] || '正在投递...';
  $('#sending-status-text').textContent = phaseText;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
