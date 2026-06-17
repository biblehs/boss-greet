// ════════════════════════════════════════════════════════════
// 即投 — B 页（结果页）事件委托
// ════════════════════════════════════════════════════════════
// Depends on: E, Store, $/$$/esc (global)
// Depends on: MSG (from constants.js)
// Depends on: render-b.js (window.* functions)

window.initEventsB=function(){
  if(window._eventsBInitialized)return;
  window._eventsBInitialized=true;

  // ── Grouped content delegation ──
  E.groupedContent.addEventListener('click',function(e){
    try{
      // Per-job custom image upload
      var jact=e.target.closest('[data-gact="addJobImg"]');
      if(jact){
        var jobId=jact.dataset.jobId;
        var fileInput=document.getElementById('jobFile_'+jobId);
        if(fileInput)fileInput.click();
        return
      }
      // Per-job custom image remove
      var jrem=e.target.closest('.thumb-remove[data-job-img]');
      if(jrem){
        var jid=jrem.dataset.jobImg;
        var idx=parseInt(jrem.dataset.idx);
        var jc=Store.get('jobCustom')||{};
        var entry=jc[jid];
        if(entry&&entry.images&&idx>=0&&idx<entry.images.length){
          entry.images.splice(idx,1);
          Store.set('jobCustom',jc);
          // Re-render this job's thumb area
          var thumbArea=jrem.closest('.univ-thumb-area');
          if(thumbArea)thumbArea.innerHTML=window.renderJobThumbnailsHTML(jid);
        }
        return
      }

      // Greeting actions (rewrite)
      var gact=e.target.closest('[data-gact]');
      if(gact){
        if(gact.dataset.gact==='addImg'){E.hiddenFileInput.click();return}
        if(gact.dataset.gact==='addJobImg')return; // handled above
        var gi=parseInt(gact.dataset.g);
        if(isNaN(gi))return;
        var groups=Store.get('groups')||[];
        var g=groups[gi];
        if(!g)return;
        if(gact.dataset.gact==='rewrite'){
          gact.classList.add('spinning');
          var jdSamples=g.jobs.slice(0,5).map(function(j){
            return{title:j.name,tags:j.tags,desc:j.name};
          });
          chrome.runtime.sendMessage({type:MSG.REGENERATE_GREETING,category:g.position,jdSamples:jdSamples},function(resp){
            if(resp&&resp.success&&resp.greeting){
              g.greeting.text=resp.greeting;
              g.greeting.editing=false;
              Store.set('groups',groups);
              window.syncGroupGreeting(gi);
            }
            // Targeted update: refresh greeting display only
            window.updateGroupGreeting(gi);
            gact.classList.remove('spinning');
          });
        }
        return
      }

      // Expand group
      var exp=e.target.closest('.expand-more-jobs');
      if(exp){
        var egi=parseInt(exp.dataset.gi);
        if(!isNaN(egi))window.expandGroup(egi);
        return
      }

      // Click greet-text to edit
      var gt=e.target.closest('.greet-text[data-g]');
      if(gt){
        window.showGreetingEditor(parseInt(gt.dataset.g));
        return
      }

      // Image remove (B page)
      var rem=e.target.closest('.thumb-remove');
      if(rem){
        var idx=parseInt(rem.dataset.gimg);
        if(!isNaN(idx)&&idx>=0){
          var images=Store.get('resumeImages')||[];
          if(idx<images.length){
            var rid=images[idx].id;
            images.splice(idx,1);
            Store.set('resumeImages',images);
            window.refreshBImages();
            atomicUpdateResumeImages(function(arr){
              return arr.filter(function(it){return it.id!==rid});
            });
          }
        }
        return
      }

      // Image lightbox (B page thumbnails) — use fullSrc from Store
      var thumbImg=e.target.closest('.univ-thumb img');
      if(thumbImg){
        var gimg=thumbImg.dataset.gimg;
        var images=Store.get('resumeImages')||[];
        var imgData=images[parseInt(gimg)];
        var src=(imgData&&imgData.fullSrc)?imgData.fullSrc:thumbImg.src;
        showImageLightbox(src);
        return
      }

      // Job custom toggle (lazy create)
      var toggle=e.target.closest('.job-custom-toggle');
      if(toggle){
        var id=toggle.dataset.jobId;
        window.toggleJobCustom(id);
        return
      }

      // Help tip: click ? to open full-size help image in new tab
      var helpTip=e.target.closest('.help-tip');
      if(helpTip){
        var imgUrl=chrome.runtime.getURL('src/popup/auto-reply-help.png');
        var html='<html><head><meta charset="utf-8"><title>自动回复简历说明</title><style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}img{max-width:800px;width:90%;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.12)}p{color:#555;font-size:14px;margin-top:16px}</style></head><body><img src="'+imgUrl+'" alt="自动回复说明"><p>帮助您识别 HR 消息中的关键词，进行自动回复附件简历。</p></body></html>';
        var b64=btoa(unescape(encodeURIComponent(html)));
        chrome.tabs.create({ url: 'data:text/html;charset=utf-8;base64,'+b64 });
        return
      }

      // Master checkbox: tri-state toggle for all jobs in group
      var master=e.target.closest('.job-master-checkbox');
      if(master){
        window.toggleGroupMaster(parseInt(master.dataset.masterGi));
        return
      }

      // Job checkbox toggle (skip if click inside custom settings panel)
      var it=e.target.closest('.job-item');
      if(it){
        if(e.target.closest('.job-custom-settings')) return;
        var id=it.dataset.jobId;
        window.toggleJobCheck(id);
      }
    }catch(ex){console.error('groupedContent click:',ex)}
  });

  // Greeting textarea: Enter exits editing
  E.groupedContent.addEventListener('keydown',function(e){
    var ta=e.target.closest('.greet-textarea[data-g]');
    if(ta&&e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      window.saveAndHideGreetingEditor(parseInt(ta.dataset.g));
    }
  });
  E.groupedContent.addEventListener('focusout',function(e){
    var ta=e.target.closest('.greet-textarea[data-g]');
    if(ta)window.saveAndHideGreetingEditor(parseInt(ta.dataset.g));
  });

  // Greeting & file name input (live sync)
  E.groupedContent.addEventListener('input',function(e){
    var ta=e.target.closest('.greet-textarea[data-g]');
    if(ta){
      var gi=parseInt(ta.dataset.g);
      var groups=Store.get('groups')||[];
      var g=groups[gi];
      if(g)g.greeting.text=ta.value;
      Store.set('groups',groups);
      return
    }
    var fn=e.target.closest('.att-name-input[data-g]');
    if(fn){
      var gi=parseInt(fn.dataset.g);
      var groups=Store.get('groups')||[];
      var g=groups[gi];
      if(g)g.fileName=fn.value;
      Store.set('groups',groups);
      syncResumeFileNames();
      return
    }
    var inp=e.target.closest('.custom-ta,.custom-inp');
    if(inp){
      var id=inp.dataset.jobId;
      var setting=inp.dataset.cs;
      var jc=Store.get('jobCustom')||{};
      var entry=jc[id];
      if(!entry)return;
      if(setting==='greeting')entry.customGreeting=inp.value;
      else if(setting==='fileName'){entry.customFileName=inp.value;syncResumeFileNames()}
      Store.set('jobCustom',jc);
    }
  });

  // Per-job custom image upload (change event on dynamically created file inputs)
  E.groupedContent.addEventListener('change',function(e){
    var fileInput=e.target.closest('input[type="file"][id^="jobFile_"]');
    if(!fileInput)return;
    var files=fileInput.files;
    if(!files||!files.length)return;
    var jobId=fileInput.id.replace('jobFile_','');
    var jc=Store.get('jobCustom')||{};
    if(!jc[jobId])jc[jobId]={expanded:false,customGreeting:'',customFileName:'',images:[]};
    if(!jc[jobId].images)jc[jobId].images=[];
    var maxNew=10-(jc[jobId].images.length);
    var todo=[];
    for(var fi=0;fi<files.length&&todo.length<maxNew;fi++)todo.push(files[fi]);
    var done=0;
    var thatDiv=fileInput.closest('.univ-thumb-area');
    for(var ti=0;ti<todo.length;ti++)(function(f){
      var reader=new FileReader();
      reader.onload=function(ev){
        var ab=ev.target.result;
        var u8=new Uint8Array(ab);
        var img=new Image();
        img.onload=function(){
          var cv=document.createElement('canvas');
          var w=img.width,h=img.height;
          if(w>120){h=h*120/w;w=120}
          if(h>160){w=w*160/h;h=160}
          cv.width=Math.round(w);
          cv.height=Math.round(h);
          cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
          var thumb=cv.toDataURL('image/jpeg',0.7);
          var cvLb=document.createElement('canvas');
          var lbW=img.width,lbH=img.height;
          if(lbW>800){lbH=lbH*800/lbW;lbW=800}
          if(lbH>1000){lbW=lbW*1000/lbH;lbH=1000}
          cvLb.width=Math.round(lbW);
          cvLb.height=Math.round(lbH);
          cvLb.getContext('2d').drawImage(img,0,0,cvLb.width,cvLb.height);
          var lightboxSrc=cvLb.toDataURL('image/jpeg',0.85);
          jc[jobId].images.push({src:thumb,fullSrc:lightboxSrc,name:f.name});
          URL.revokeObjectURL(img.src);
          done++;
          if(done===todo.length){
            fileInput.value='';
            Store.set('jobCustom',jc);
            if(thatDiv)thatDiv.innerHTML=window.renderJobThumbnailsHTML(jobId);
          }
        };
        img.src=URL.createObjectURL(new Blob([ab],{type:f.type}));
      };
      reader.readAsArrayBuffer(f);
    })(todo[ti]);
  });

  // ── Send button ──
  E.btnSend.addEventListener('click',function(){
    var sending=Store.get('sending');
    if(sending){
      // 停止＝硬中止 + 统一终态：不在本地把 sending 置 false（否则后续 SEND_COMPLETE 的
      // `if(sending)` 守卫为假 → review 不渲染）。保持 sending=true，让 SW 的 stopSend→
      // finalizeTask→SEND_COMPLETE 回来时正常落 review（底部按钮变「重新投递」）。
      E.btnSend.textContent='正在停止...';
      E.btnSend.disabled=true;
      E.progressText.textContent='正在停止...';
      E.progressSub.textContent='正在收尾，请稍候';
      try{chrome.runtime.sendMessage({type:MSG.STOP_SEND})}catch(ex){}
      return
    }
    Store.set('sending',true);
    Store.set('progressDone',false);
    Store.set('reviewDismissed',false); // 新一批开投 → 解除抑制，本批投完正常弹 review
    E.progressSection.classList.remove('hidden');
    try{E.progressSection.scrollIntoView({behavior:'smooth',block:'start'})}catch(ex){}
    E.btnSend.textContent='停止发送';
    E.btnSend.classList.add('sending');
    E.btnSend.disabled=false;
    E.progressText.textContent='正在启动投递...';
    E.progressSub.textContent='请稍候';
    E.progressFill.style.width='0%';
    var jobs=Store.get('jobs')||[];
    var jobIds=jobs.filter(function(j){return j.checked}).map(function(j){return j.id});
    try{
      chrome.runtime.sendMessage({type:MSG.START_SEND,jobIds:jobIds,hrActiveFilter:Store.get('hrActiveFilter')||'不限'},function(resp){
        if(chrome.runtime.lastError||!resp||!resp.success){
          Store.set('sending',false);
          E.btnSend.textContent='一键发送';
          E.btnSend.classList.remove('sending');
          E.btnSend.disabled=false;
          E.btnSend.style.background='';
          E.progressText.textContent='投递启动失败';
          E.progressSub.textContent=(resp&&resp.error)||'请确保BOSS直聘聊天页已打开';
        }else{
          E.progressText.textContent='正在投递...';
          E.progressSub.textContent='共 '+jobIds.length+' 个岗位';
        }
      });
    }catch(ex){
      Store.set('sending',false);
      E.btnSend.textContent='一键发送';
      E.btnSend.classList.remove('sending');
      E.btnSend.disabled=false;
      E.btnSend.style.background='';
      E.progressText.textContent='投递启动失败';
      E.progressSub.textContent='扩展上下文异常，请刷新页面重试';
    }
  });
};
