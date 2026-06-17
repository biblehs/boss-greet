// ════════════════════════════════════════════════════════════
// 即投 — B 页（结果页）四级增量 DOM 渲染
// ════════════════════════════════════════════════════════════
// Depends on: E, Store, $/$$/esc (global)
// Depends on: CONFIG (from constants.js)
// Depends on: MSG (from constants.js)
// Depends on: renderResumeThumbnailsHTML (from render-a.js)

// ── Internal: track rendered job count per group ──
var _jobsRendered={};

// ── State preparation helpers ──

// 分来源传 picker(严格) + custom(宽松)，与 SW matchJobToPosition 完全同源。
window.prepareGroups=function(picker,custom,jobs){
  picker=picker||[];custom=custom||[];
  var allPos=picker.concat(custom);
  if(!allPos.length)return[];
  // 归组统一委托共享真相源 matchJobToExpected（constants.js），与 SW matchJobToPosition 完全同源
  // → B 页编辑组 === 发送组（编辑 key === 发送 key），且采到的岗位不会落「其他」。
  var groups=[],byPos={};
  allPos.forEach(function(pos){
    var g={position:pos,greeting:{text:'正在生成招呼语...',editing:false},fileName:'',jobs:[]};
    groups.push(g);byPos[pos]=g;
  });
  var unmatched=[];
  jobs.forEach(function(job){
    var pos=matchJobToExpected(job,picker,custom);
    if(pos!=='其他'&&byPos[pos]){byPos[pos].jobs.push(job);}
    else{unmatched.push(job);}
  });
  groups=groups.filter(function(g){return g.jobs.length>0});
  // 「其他」仅作 0 匹配极端 fallback（采集与分组同源，正常不该出现）
  if(unmatched.length){
    groups.push({position:'其他',greeting:{text:'正在生成招呼语...',editing:false},fileName:'',jobs:unmatched});
  }
  return groups;
};

window.initJobCustom=function(force){
  if(force)Store.set('jobCustom',{});
  var jc=Store.get('jobCustom')||{};
  var jobs=Store.get('jobs')||[];
  jobs.forEach(function(j){
    if(!jc[j.id])jc[j.id]={expanded:false,customGreeting:'',customFileName:'',images:[]};
  });
  Store.set('jobCustom',jc);
};

window.applyGreetingsToGroups=function(){
  var greetings=Store.get('greetings');
  if(!greetings||!Object.keys(greetings).length)return false;
  var groups=Store.get('groups')||[];
  var changed=false;
  groups.forEach(function(g){
    // 优先用期望岗位名匹配（SW 按 position 聚类生成），fallback 到 tag 首项
    var aiGreeting=greetings[g.position];
    if(!aiGreeting){
      var bestTag='其他',bestCount=0,tagCounts={};
      g.jobs.forEach(function(j){
        var tag=(j.tags&&j.tags[0])||'其他';
        tagCounts[tag]=(tagCounts[tag]||0)+1;
      });
      for(var t in tagCounts){if(tagCounts[t]>bestCount){bestTag=t;bestCount=tagCounts[t]}}
      aiGreeting=greetings[bestTag];
    }
    if(aiGreeting&&g.greeting.text!==aiGreeting){g.greeting.text=aiGreeting;changed=true}
  });
  if(changed)Store.set('groups',groups);
  return changed;
};

window.syncGroupGreeting=function(gi){
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g||!g.jobs.length)return;
  // 用期望岗位名作为 greeting key（与 SW position-based 聚类保持一致）
  var key=g.position;
  if(!key) return;
  var greetings=Store.get('greetings')||{};
  greetings[key]=g.greeting.text;
  Store.set('greetings',greetings);
  try{chrome.runtime.sendMessage({type:MSG.UPDATE_GREETING,category:key,greeting:g.greeting.text})}catch(ex){}
};

// ── Progress ──
window.updateProgress=function(collected,total,statusText,statusSub){
  if(total>0){
    E.progressFill.classList.remove('indeterminate');
    E.progressFill.style.width=Math.min(Math.round(collected/total*100),100)+'%';
  } else {
    E.progressFill.classList.add('indeterminate');
    E.progressFill.style.width='30%';
  }
  E.progressText.textContent=statusText||'正在搜索匹配岗位...';
  E.progressSub.textContent=statusSub||'已找到 '+collected+' 个匹配岗位';
  if(total>0&&collected>=total){
    E.progressFill.classList.remove('indeterminate');
    E.progressText.textContent='完成！共找到 '+total+' 个匹配岗位';
    E.progressSub.textContent='';
    E.bottomResults.classList.remove('hidden');
  }
  window._syncProgressTip&&window._syncProgressTip();
};

// ── Progress tip auto-toggle (based on progressText content) ──
window._syncProgressTip=function(){
  var tipEl=document.getElementById('progressTip');
  if(!tipEl)return;
  var txt=(E.progressText&&E.progressText.textContent)||'';
  var sending=/(投递|发送|提取)/.test(txt)&&!/(完成|失败|错误)/.test(txt);
  tipEl.classList.toggle('hidden',!sending);
};
(function(){
  var start=function(){
    var tEl=document.getElementById('progressText');
    if(!tEl){setTimeout(start,100);return;}
    try{
      new MutationObserver(function(){window._syncProgressTip&&window._syncProgressTip();})
        .observe(tEl,{childList:true,characterData:true,subtree:true});
    }catch(ex){}
    window._syncProgressTip&&window._syncProgressTip();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();

// ── Level 1: Group card structure stabilization ──

window.renderGroupsStable=function(){
  var groups=Store.get('groups')||[];
  E.groupedContent.innerHTML='';
  _jobsRendered={};

  var frag=document.createDocumentFragment();
  // Compute resume images/thumbnails once, reuse for all groups
  var resumeImages=Store.get('resumeImages')||[];
  var resumeThumbsHTML=resumeImages.length ? window.renderResumeThumbnailsHTML() : '<div class="univ-thumb-add" data-gact="addImg">+</div>';
  for(var gi=0;gi<groups.length;gi++){
    var g=groups[gi];
    _jobsRendered[gi]=0;

    var card=document.createElement('div');
    card.className='group-card';
    card.dataset.gi=gi;

    // Header
    var hdr=document.createElement('div');
    hdr.className='group-header';
    hdr.innerHTML='<span class="group-title">'+esc(g.position)+'</span>'
      +'<span class="group-count">'+g.jobs.length+'个岗位</span>';
    card.appendChild(hdr);

    // Greeting section
    var greetSec=document.createElement('div');
    greetSec.className='group-section';
    greetSec.innerHTML='<div class="section-subtitle">AI定制招呼语</div>'
      +'<div class="greet-card" style="position:relative">'
      +'<div class="greet-text" data-g="'+gi+'">'+esc(g.greeting.text)+'</div>'
      +'<textarea class="greet-textarea hidden" data-g="'+gi+'">'+esc(g.greeting.text)+'</textarea>'
      +'<span class="greet-refresh" data-g="'+gi+'" data-gact="rewrite">'
      +'<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
      +'<path d="M2 8a6 6 0 0 1 11.3-3.3M14 8a6 6 0 0 1-11.3 3.3"/><path d="M13.5 2v3h-3M2.5 14v-3h3"/></svg></span>'
      +'</div>';
    card.appendChild(greetSec);

    // Resume images section (per group) — 始终渲染，空态保留添加入口
    var rSec=document.createElement('div');
    rSec.className='group-section';
    rSec.innerHTML='<div class="section-subtitle">图片版简历</div>'
      +'<div class="univ-thumb-area" style="flex-wrap:wrap">'
      +resumeThumbsHTML
      +'</div>';
    card.appendChild(rSec);

    // File name section
    var fileSec=document.createElement('div');
    fileSec.className='group-section';
    fileSec.innerHTML='<div class="section-subtitle">自动回复简历名称<span class="help-tip" id="helpAutoReply">?</span></div>'
      +'<input type="text" class="att-name-input" data-g="'+gi+'" placeholder="请填写BOSS直聘-个人中心-指定的附件简历名称" value="'+esc(g.fileName||'')+'" style="font-size:12px">'
      +'<div class="section-hint">若未指定文件，默认发送最新上传附件</div>';
    card.appendChild(fileSec);

    // Jobs container (empty, populated by Level 2)
    var jobsSec=document.createElement('div');
    jobsSec.className='group-section';
    var jobsTitle=document.createElement('div');
    jobsTitle.className='section-subtitle';
    jobsTitle.style.marginBottom='8px';
    jobsTitle.style.display='flex';
    jobsTitle.style.alignItems='center';
    jobsTitle.style.justifyContent='space-between';
    jobsTitle.innerHTML='<span>岗位</span>'
      +'<div class="job-master-checkbox" data-master-gi="'+gi+'"><svg class="jm-check" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 6l2.5 3 4.5-5"/></svg><svg class="jm-dash" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 6h7"/></svg></div>';
    jobsSec.appendChild(jobsTitle);
    var jobsContainer=document.createElement('div');
    jobsContainer.className='group-jobs';
    jobsContainer.dataset.gi=gi;
    jobsSec.appendChild(jobsContainer);
    card.appendChild(jobsSec);

    frag.appendChild(card);
  }
  E.groupedContent.appendChild(frag);

  // Level 2: Initial append (default CONFIG.MAX_JOBS_PER_GROUP = 6)
  var maxPerGroup=CONFIG.MAX_JOBS_PER_GROUP||6;
  for(var gi2=0;gi2<groups.length;gi2++){
    window.appendJobsToGroup(gi2,0,maxPerGroup);
    window.recalcGroupMaster(gi2);
  }

  window.updResCnt();
};

// ── Level 2: Job item HTML ──

function renderJobItemHTML(job){
  return '<div class="job-item" data-job-id="'+job.id+'"><div class="job-top-row">'
    +'<div class="job-checkbox'+(job.checked?' checked':'')+'" data-job-id="'+job.id+'"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2.5 6l2.5 3 4.5-5"/></svg></div>'
    +'<div class="job-info">'
    +'<div class="job-title">'+esc(job.name)+'</div>'
    +'<div class="job-company">'+esc(job.company)+'</div>'
    +'<div class="job-salary">'+esc(job.salary||'')+'</div>'
    +'<div class="job-tags">'+(job.tags||[]).map(function(t){return'<span class="job-tag">'+esc(t)+'</span>'}).join('')+'</div>'
    +'<div class="job-custom-toggle" data-job-id="'+job.id+'" style="margin-top:10px">&#9654; 自定义消息</div>'
    +'</div></div></div>';
}

// ── Level 2: Incremental job append (DocumentFragment) ──

window.appendJobsToGroup=function(gi,start,count){
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g)return;

  var jobsContainer=document.querySelector('.group-jobs[data-gi="'+gi+'"]');
  if(!jobsContainer)return;

  var end=Math.min(start+count,g.jobs.length);
  if(start>=end)return;

  var frag=document.createDocumentFragment();
  var wrapper=document.createElement('div');

  for(var ji=start;ji<end;ji++){
    var job=g.jobs[ji];
    wrapper.innerHTML=renderJobItemHTML(job);
    frag.appendChild(wrapper.firstElementChild);
  }

  // Remove expand button before appending
  var expandBtn=jobsContainer.querySelector('.expand-more-jobs');
  if(expandBtn)expandBtn.parentNode.removeChild(expandBtn);

  jobsContainer.appendChild(frag);
  _jobsRendered[gi]=end;

  // Re-add expand button if more jobs remain
  if(end<g.jobs.length){
    var btn=document.createElement('div');
    btn.className='expand-more-jobs';
    btn.dataset.gi=gi;
    btn.textContent='展开全部 '+g.jobs.length+' 个岗位（剩余 '+(g.jobs.length-end)+' 个）';
    jobsContainer.appendChild(btn);
  }
};

// ── Level 3: Targeted updates ──

window.toggleJobCheck=function(jobId){
  var cb=document.querySelector('.job-checkbox[data-job-id="'+jobId+'"]');
  if(cb)cb.classList.toggle('checked');
  var jobs=Store.get('jobs')||[];
  for(var i=0;i<jobs.length;i++){
    if(jobs[i].id===jobId){jobs[i].checked=!jobs[i].checked;break}
  }
  Store.set('jobs',jobs);
  window.updResCnt();
  window.recalcGroupMaster(window.giOfJob(jobId));
};

// ── Master checkbox (derived tri-state per group) ──

window.giOfJob=function(jobId){
  var groups=Store.get('groups')||[];
  for(var gi=0;gi<groups.length;gi++){
    var js=groups[gi].jobs||[];
    for(var j=0;j<js.length;j++){if(js[j].id===jobId)return gi}
  }
  return -1;
};

// returns 'all' | 'none' | 'partial'
window.groupMasterState=function(gi){
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g||!g.jobs.length)return 'none';
  var jobs=Store.get('jobs')||[];
  var checkedMap={};
  for(var i=0;i<jobs.length;i++)checkedMap[jobs[i].id]=!!jobs[i].checked;
  var checked=0;
  for(var k=0;k<g.jobs.length;k++){if(checkedMap[g.jobs[k].id])checked++}
  if(checked===0)return 'none';
  if(checked===g.jobs.length)return 'all';
  return 'partial';
};

window.recalcGroupMaster=function(gi){
  if(gi<0)return;
  var el=document.querySelector('.job-master-checkbox[data-master-gi="'+gi+'"]');
  if(!el)return;
  var st=window.groupMasterState(gi);
  el.classList.remove('checked','indeterminate');
  if(st==='all')el.classList.add('checked');
  else if(st==='partial')el.classList.add('indeterminate');
};

window.toggleGroupMaster=function(gi){
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g||!g.jobs.length)return;
  // all or partial -> clear all; none -> select all
  var target=window.groupMasterState(gi)==='none';
  var ids={};
  for(var k=0;k<g.jobs.length;k++)ids[g.jobs[k].id]=true;
  var jobs=Store.get('jobs')||[];
  for(var i=0;i<jobs.length;i++){if(ids[jobs[i].id])jobs[i].checked=target}
  Store.set('jobs',jobs);
  // sync rendered job-checkbox DOM within this group
  var container=document.querySelector('.group-jobs[data-gi="'+gi+'"]');
  if(container){
    var boxes=container.querySelectorAll('.job-checkbox[data-job-id]');
    for(var b=0;b<boxes.length;b++){
      if(ids[boxes[b].dataset.jobId])boxes[b].classList.toggle('checked',target);
    }
  }
  window.updResCnt();
  window.recalcGroupMaster(gi);
};

window.renderJobThumbnailsHTML=function(jobId){
  var entry=(Store.get('jobCustom')||{})[jobId];
  var images=(entry&&entry.images)||[];
  var html='';
  for(var ii=0;ii<images.length;ii++){
    html+='<div class="univ-thumb" style="position:relative">'
      +'<img src="'+images[ii].src+'" alt="简历缩略图" data-job-img="'+jobId+'" data-idx="'+ii+'">'
      +'<span class="thumb-remove" data-job-img="'+jobId+'" data-idx="'+ii+'">&#x2715;</span>'
      +'</div>';
  }
  html+='<input type="file" id="jobFile_'+jobId+'" accept=".jpg,.jpeg,.png" style="display:none">'
    +'<div class="univ-thumb-add" data-gact="addJobImg" data-job-id="'+jobId+'">+</div>';
  return html;
};

window.createJobCustomSettings=function(jobId){
  var item=document.querySelector('.job-item[data-job-id="'+jobId+'"]');
  if(!item)return null;
  var jc=Store.get('jobCustom')||{};
  if(!jc[jobId])jc[jobId]={expanded:false,customGreeting:'',customFileName:'',images:[]};
  Store.set('jobCustom',jc);
  var div=document.createElement('div');
  div.className='job-custom-settings';
  div.dataset.jobId=jobId;
  div.style.display='none';
  var thumbsHtml='<div class="univ-thumb-area" style="flex-wrap:wrap;margin-bottom:8px">'
    +window.renderJobThumbnailsHTML(jobId)
    +'</div>';

  div.innerHTML=thumbsHtml
    +'<textarea class="custom-ta" data-job-id="'+jobId+'" data-cs="greeting" placeholder="请输入自定义招呼语">'+esc(jc[jobId].customGreeting)+'</textarea>'
    +'<input type="text" class="custom-inp" data-job-id="'+jobId+'" data-cs="fileName" placeholder="请填写BOSS直聘-个人中心-指定的附件简历名称" value="'+esc(jc[jobId].customFileName)+'">';
  var jobInfo=item.querySelector('.job-info');
  if(jobInfo)jobInfo.appendChild(div);
  return div;
};

window.toggleJobCustom=function(jobId){
  var settings=document.querySelector('.job-custom-settings[data-job-id="'+jobId+'"]');
  var toggle=document.querySelector('.job-custom-toggle[data-job-id="'+jobId+'"]');
  var jc=Store.get('jobCustom')||{};
  var entry=jc[jobId];
  if(!entry||!toggle)return;
  if(settings){
    var expanded=settings.style.display!=='none';
    settings.style.display=expanded?'none':'block';
    toggle.innerHTML=expanded?'&#9654; 自定义消息':'&#9660; 自定义消息';
    entry.expanded=!expanded;
  }else{
    settings=window.createJobCustomSettings(jobId);
    if(settings){
      settings.style.display='block';
      toggle.innerHTML='&#9660; 自定义消息';
      entry.expanded=true;
    }
  }
  Store.set('jobCustom',jc);
};

window.showGreetingEditor=function(gi){
  var greetText=document.querySelector('.greet-text[data-g="'+gi+'"]');
  var textarea=document.querySelector('.greet-textarea[data-g="'+gi+'"]');
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g||!greetText||!textarea)return;
  greetText.classList.add('hidden');
  textarea.classList.remove('hidden');
  g.greeting.editing=true;
  Store.set('groups',groups);
  setTimeout(function(){textarea.focus()},0);
};

window.saveAndHideGreetingEditor=function(gi){
  var greetText=document.querySelector('.greet-text[data-g="'+gi+'"]');
  var textarea=document.querySelector('.greet-textarea[data-g="'+gi+'"]');
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g||!greetText||!textarea)return;
  g.greeting.text=textarea.value;
  g.greeting.editing=false;
  Store.set('groups',groups);
  greetText.textContent=textarea.value;
  greetText.classList.remove('hidden');
  textarea.classList.add('hidden');
  window.syncGroupGreeting(gi);
};

window.updateGroupGreeting=function(gi){
  var groups=Store.get('groups')||[];
  var g=groups[gi];
  if(!g)return;
  var greetText=document.querySelector('.greet-text[data-g="'+gi+'"]');
  if(greetText)greetText.textContent=g.greeting.text;
};

window.updateAllGreetings=function(){
  var groups=Store.get('groups')||[];
  groups.forEach(function(g,gi){window.updateGroupGreeting(gi)});
};

window.expandGroup=function(gi){
  var g=(Store.get('groups')||[])[gi];
  if(!g)return;
  Store.get('groupExpanded')||{};
  var exp=Store.get('groupExpanded')||{};
  exp[gi]=true;
  Store.set('groupExpanded',exp);
  var rendered=_jobsRendered[gi]||0;
  var remaining=g.jobs.length-rendered;
  if(remaining>0)window.appendJobsToGroup(gi,rendered,remaining);
};

window.refreshBImages=function(){
  window.renderResumeImages(); // A page
  var images=Store.get('resumeImages')||[];
  var thumbsHTML=images.length ? window.renderResumeThumbnailsHTML() : '<div class="univ-thumb-add" data-gact="addImg">+</div>';
  // 仅更新 group 级别的缩略图区域，不碰 job custom settings 的独立图片
  $$('#groupedContent .group-card > .group-section .univ-thumb-area').forEach(function(area){
    area.innerHTML=thumbsHTML;
  });
};

window.updResCnt=function(){
  var jobs=Store.get('jobs')||[];
  var c=jobs.filter(function(j){return j.checked}).length;
  E.resultCountNum.textContent=c;
  E.resultCountTotal.textContent=jobs.length;
  E.btnSend.disabled=c===0
};

// ── Skeleton loading placeholders ──
window.showSkeleton=function(groupCount){
  var container=E.groupedContent;
  if(!container)return;
  var html='';
  for(var i=0;i<groupCount;i++){
    html+='<div class="skeleton-card">'
      +'<div class="skeleton-title"></div>'
      +'<div class="skeleton-line"></div>'
      +'<div class="skeleton-line"></div>'
      +'<div class="skeleton-line"></div>'
      +'</div>';
  }
  container.innerHTML=html;
};
// hideSkeleton removed — renderGroupsStable replaces innerHTML, auto-clearing skeleton
