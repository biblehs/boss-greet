// ════════════════════════════════════════════════════════════
// BossGreet — B 页（结果页）精准匹配渲染
// ════════════════════════════════════════════════════════════

// ── 匹配度标签 ──
function getMatchTag(greeting) {
  if (!greeting) return { text: '待生成', cls: 'tag-pending', icon: '⏳' };
  if (greeting.startsWith('[跳过]')) return { text: '不匹配', cls: 'tag-skip', icon: '❌' };
  if (greeting.includes('生成失败')) return { text: '失败', cls: 'tag-fail', icon: '⚠️' };
  return { text: '已匹配', cls: 'tag-good', icon: '✅' };
}

// ── 进度更新 ──
window.updateProgress = function(collected, total, statusText, statusSub) {
  if (total > 0) {
    E.progressFill.classList.remove('indeterminate');
    E.progressFill.style.width = Math.min(Math.round(collected / total * 100), 100) + '%';
  } else {
    E.progressFill.classList.add('indeterminate');
    E.progressFill.style.width = '30%';
  }
  E.progressText.textContent = statusText || '正在搜索匹配岗位...';
  E.progressSub.textContent = statusSub || '已找到 ' + collected + ' 个匹配岗位';
  if (total > 0 && collected >= total) {
    E.progressFill.classList.remove('indeterminate');
    E.progressText.textContent = '完成！共找到 ' + total + ' 个岗位';
    E.progressSub.textContent = 'AI 正在分析匹配度并生成招呼语...';
    E.bottomResults.classList.remove('hidden');
  }
};

// ── 渲染岗位列表（精准匹配模式）──
window.renderGroupsStable = function() {
  var jobs = Store.get('jobs') || [];
  var greetings = Store.get('greetings') || {};
  var container = E.groupedContent;
  if (!container) return;

  container.innerHTML = '';

  // 统计
  var matched = 0, skipped = 0, pending = 0;
  jobs.forEach(function(job) {
    var g = greetings[job.id] || '';
    if (g.startsWith('[跳过]')) skipped++;
    else if (g && !g.includes('生成失败')) matched++;
    else pending++;
  });

  // 顶部统计
  var stats = document.createElement('div');
  stats.className = 'match-stats';
  stats.innerHTML = '<div class="stat-item stat-matched"><span class="stat-num">' + matched + '</span><span>已匹配</span></div>'
    + '<div class="stat-item stat-skipped"><span class="stat-num">' + skipped + '</span><span>不匹配</span></div>'
    + '<div class="stat-item stat-pending"><span class="stat-num">' + pending + '</span><span>待处理</span></div>';
  container.appendChild(stats);

  // 筛选按钮
  var filters = document.createElement('div');
  filters.className = 'match-filters';
  filters.innerHTML = '<button class="filter-btn active" data-filter="all">全部</button>'
    + '<button class="filter-btn" data-filter="matched">已匹配 (' + matched + ')</button>'
    + '<button class="filter-btn" data-filter="skipped">不匹配 (' + skipped + ')</button>';
  container.appendChild(filters);

  // 岗位列表
  var list = document.createElement('div');
  list.className = 'job-list';
  list.id = 'jobList';

  jobs.forEach(function(job, idx) {
    var greeting = greetings[job.id] || '';
    var tag = getMatchTag(greeting);
    var isChecked = job.checked !== false; // 默认选中已匹配的

    var card = document.createElement('div');
    card.className = 'job-card-precise';
    card.dataset.jobId = job.id;
    card.dataset.matched = tag.cls === 'tag-good' ? 'matched' : (tag.cls === 'tag-skip' ? 'skipped' : 'pending');

    card.innerHTML = '<div class="job-card-header">'
      + '<div class="job-card-left">'
      + '<div class="job-check' + (isChecked && tag.cls === 'tag-good' ? ' checked' : '') + '" data-job-id="' + job.id + '">'
      + '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 6l2.5 3 4.5-5"/></svg>'
      + '</div>'
      + '<div class="job-match-tag ' + tag.cls + '">' + tag.icon + ' ' + tag.text + '</div>'
      + '</div>'
      + '<div class="job-card-info">'
      + '<div class="job-name">' + esc(job.name) + '</div>'
      + '<div class="job-company">' + esc(job.company) + '</div>'
      + '<div class="job-salary">' + esc(job.salary || '') + '</div>'
      + '</div>'
      + '</div>'
      + (job.jd ? '<div class="job-jd-preview">' + esc((job.jd.desc || '').substring(0, 100)) + '...</div>' : '')
      + '<div class="job-greeting-area">'
      + '<div class="greeting-label">招呼语：</div>'
      + '<div class="greeting-text" data-job-id="' + job.id + '">' + esc(greeting || '等待生成...') + '</div>'
      + '<textarea class="greeting-edit hidden" data-job-id="' + job.id + '">' + esc(greeting) + '</textarea>'
      + '<div class="greeting-actions">'
      + '<button class="btn-greeting-edit" data-job-id="' + job.id + '">编辑</button>'
      + '<button class="btn-greeting-save hidden" data-job-id="' + job.id + '">保存</button>'
      + '<button class="btn-greeting-regen" data-job-id="' + job.id + '">重新生成</button>'
      + '</div>'
      + '</div>';

    list.appendChild(card);
  });

  container.appendChild(list);

  // 绑定事件
  bindJobCardEvents();
  updateSelectedCount();
};

// ── 绑定岗位卡片事件 ──
function bindJobCardEvents() {
  // 勾选框
  document.querySelectorAll('.job-check').forEach(function(cb) {
    cb.addEventListener('click', function() {
      var jobId = this.dataset.jobId;
      this.classList.toggle('checked');
      var jobs = Store.get('jobs') || [];
      var job = jobs.find(function(j) { return j.id === jobId; });
      if (job) {
        job.checked = this.classList.contains('checked');
        Store.set('jobs', jobs);
      }
      updateSelectedCount();
    });
  });

  // 编辑招呼语
  document.querySelectorAll('.btn-greeting-edit').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var jobId = this.dataset.jobId;
      var textEl = document.querySelector('.greeting-text[data-job-id="' + jobId + '"]');
      var editEl = document.querySelector('.greeting-edit[data-job-id="' + jobId + '"]');
      var saveBtn = document.querySelector('.btn-greeting-save[data-job-id="' + jobId + '"]');
      if (textEl && editEl && saveBtn) {
        textEl.classList.add('hidden');
        editEl.classList.remove('hidden');
        editEl.focus();
        this.classList.add('hidden');
        saveBtn.classList.remove('hidden');
      }
    });
  });

  // 保存招呼语
  document.querySelectorAll('.btn-greeting-save').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var jobId = this.dataset.jobId;
      var textEl = document.querySelector('.greeting-text[data-job-id="' + jobId + '"]');
      var editEl = document.querySelector('.greeting-edit[data-job-id="' + jobId + '"]');
      var editBtn = document.querySelector('.btn-greeting-edit[data-job-id="' + jobId + '"]');
      if (textEl && editEl && editBtn) {
        var newGreeting = editEl.value.trim();
        textEl.textContent = newGreeting;
        textEl.classList.remove('hidden');
        editEl.classList.add('hidden');
        this.classList.add('hidden');
        editBtn.classList.remove('hidden');
        // 更新存储
        var greetings = Store.get('greetings') || {};
        greetings[jobId] = newGreeting;
        Store.set('greetings', greetings);
        chrome.runtime.sendMessage({ type: 'UPDATE_GREETING', jobId: jobId, greeting: newGreeting });
      }
    });
  });

  // 重新生成招呼语
  document.querySelectorAll('.btn-greeting-regen').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var jobId = this.dataset.jobId;
      this.disabled = true;
      this.textContent = '生成中...';
      try {
        var resp = await sendMsg({ type: 'REGENERATE_GREETING', jobId: jobId });
        if (resp && resp.success) {
          var textEl = document.querySelector('.greeting-text[data-job-id="' + jobId + '"]');
          var editEl = document.querySelector('.greeting-edit[data-job-id="' + jobId + '"]');
          if (textEl) textEl.textContent = resp.greeting;
          if (editEl) editEl.value = resp.greeting;
          // 更新匹配标签
          var tag = getMatchTag(resp.greeting);
          var tagEl = document.querySelector('.job-card-precise[data-job-id="' + jobId + '"] .job-match-tag');
          if (tagEl) {
            tagEl.className = 'job-match-tag ' + tag.cls;
            tagEl.textContent = tag.icon + ' ' + tag.text;
          }
          // 更新存储
          var greetings = Store.get('greetings') || {};
          greetings[jobId] = resp.greeting;
          Store.set('greetings', greetings);
        } else {
          alert('生成失败：' + (resp?.error || '未知错误'));
        }
      } catch (err) {
        alert('生成失败：' + err.message);
      }
      this.disabled = false;
      this.textContent = '重新生成';
    });
  });

  // 筛选按钮
  document.querySelectorAll('.filter-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      var filter = this.dataset.filter;
      document.querySelectorAll('.job-card-precise').forEach(function(card) {
        if (filter === 'all') {
          card.style.display = '';
        } else {
          card.style.display = card.dataset.matched === filter ? '' : 'none';
        }
      });
    });
  });
}

// ── 更新已选数量 ──
function updateSelectedCount() {
  var jobs = Store.get('jobs') || [];
  var greetings = Store.get('greetings') || {};
  var selected = 0;
  var total = 0;
  jobs.forEach(function(job) {
    var g = greetings[job.id] || '';
    if (!g.startsWith('[跳过]') && !g.includes('生成失败')) {
      total++;
      if (job.checked !== false) selected++;
    }
  });
  var numEl = document.getElementById('resultCountNum');
  var totalEl = document.getElementById('resultCountTotal');
  if (numEl) numEl.textContent = selected;
  if (totalEl) totalEl.textContent = total;
}

// ── 辅助函数 ──
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendMsg(msg) {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage(msg, function(resp) {
      if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
}

// ── 兼容旧接口 ──
window.prepareGroups = function() { return []; };
window.applyGreetingsToGroups = function() { return false; };
window.syncGroupGreeting = function() {};
window.initJobCustom = function() {};
window.appendJobsToGroup = function() {};
window.toggleJobCheck = function() {};
window.giOfJob = function() { return -1; };
window.groupMasterState = function() { return 'none'; };
window.recalcGroupMaster = function() {};
window.toggleGroupMaster = function() {};
window.renderJobThumbnailsHTML = function() { return ''; };
window.createJobCustomSettings = function() { return null; };
window.toggleJobCustom = function() {};
window.updResCnt = function() { updateSelectedCount(); };
window.showSkeleton = function() {};
