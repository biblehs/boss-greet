// ════════════════════════════════════════════════════════════
// 即投 — A 页（筛选页）事件委托
// ════════════════════════════════════════════════════════════
// Depends on: E, Store, $/$$/esc/tog/togD (global)
// Depends on: TAG_DATA (from tag-data.js)
// Depends on: MSG (from constants.js)
// Depends on: render-a.js, getWorkAreas (from render-a.js)

window.initEventsA=function(){
  if(window._eventsAInitialized)return;
  window._eventsAInitialized=true;

  // ── City chips ──
  E.cityChipContainer.addEventListener('click',function(e){
    var chip=e.target.closest('.city-chip');if(!chip)return;
    var code=chip.dataset.code;
    var selected=Store.get('selectedCities')||[];
    var i=selected.indexOf(code);
    if(i>=0)selected.splice(i,1);else selected.push(code);
    Store.set('selectedCities',selected);
    window.renderCityChips(E.cityInput.value);
    window.renderChipSecs();
    try{persistFilterState()}catch(ex){}
  });
  E.cityInput.addEventListener('input',function(){window.renderCityChips(E.cityInput.value)});

  // ── City selected tags（删除已选城市，复刻「期望职位」已选 tag 交互）──
  E.citySelectedArea.addEventListener('click',function(e){
    var tag=e.target.closest('.selected-tag[data-code]');
    if(!tag)return;
    var selected=Store.get('selectedCities')||[];
    var i=selected.indexOf(tag.dataset.code);
    if(i>=0)selected.splice(i,1);
    Store.set('selectedCities',selected);
    window.renderCityChips(E.cityInput.value);
    window.renderChipSecs();
    try{persistFilterState()}catch(ex){}
  });

  // ── Thumbnail helper ──
  function createThumbnail(file, maxW, maxH){
    return new Promise(function(resolve){
      var reader = new FileReader();
      reader.onload = function(e){
        var img = new Image();
        img.onload = function(){
          var cv = document.createElement('canvas');
          var w = img.width, h = img.height;
          if(w > maxW){h = h * maxW / w; w = maxW}
          if(h > maxH){w = w * maxH / h; h = maxH}
          cv.width = Math.round(w);
          cv.height = Math.round(h);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
  window.createThumbnail = createThumbnail;

  // ── Resume upload (先构建完整数组，最后一次性写入 storage 避免并行覆盖) ──
  E.hiddenFileInput.addEventListener('change',function(e){
    var files=e.target.files;
    if(!files||!files.length)return;
    var images=Store.get('resumeImages')||[];
    var maxNew=10-images.length;
    var todo=[];
    for(var fi=0;fi<files.length&&todo.length<maxNew;fi++)todo.push(files[fi]);
    var pendingImages=[];
    var pendingStore=[];
    var done=0;
    function chkDoneAll(){
      done++;
      if(done===todo.length){
        e.target.value='';
        // 所有缩略图生成完毕，一次性更新 Store 和 chrome.storage
        var newImages=Store.get('resumeImages')||[];
        pendingImages.forEach(function(pi){newImages.push(pi)});
        Store.set('resumeImages',newImages);
        window.refreshBImages();
        // 原子写入 storage（通过 serailized queue 避免竞态）
        atomicUpdateResumeImages(function(arr){
          pendingStore.forEach(function(ps){arr.push(ps)});
          return arr;
        });
      }
    }
    for(var ti=0;ti<todo.length;ti++)(function(f){
      var reader=new FileReader();
      reader.onload=function(ev){
        var ab=ev.target.result;
        var u8=new Uint8Array(ab);
        var data=Array.prototype.slice.call(u8);
        var id=Date.now()+'_'+Math.random().toString(36).slice(2,6);
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
          // Lightbox-size version (much larger for detail viewing)
          var cvLb=document.createElement('canvas');
          var lbW=img.width,lbH=img.height;
          if(lbW>800){lbH=lbH*800/lbW;lbW=800}
          if(lbH>1000){lbW=lbW*1000/lbH;lbH=1000}
          cvLb.width=Math.round(lbW);
          cvLb.height=Math.round(lbH);
          cvLb.getContext('2d').drawImage(img,0,0,cvLb.width,cvLb.height);
          var lightboxSrc=cvLb.toDataURL('image/jpeg',0.85);
          pendingImages.push({src:thumb,fullSrc:lightboxSrc,name:f.name,id:id});
          pendingStore.push({name:f.name,type:f.type,data:data,id:id,thumb:thumb,fullSrc:lightboxSrc});
          URL.revokeObjectURL(img.src);
          chkDoneAll();
        };
        img.src=URL.createObjectURL(new Blob([ab],{type:f.type}));
      };
      reader.readAsArrayBuffer(f);
    })(todo[ti]);
  });

  // A page resume thumb click delegation
  E.resumeThumbArea.addEventListener('click',function(e){
    var imgEl=e.target.closest('.univ-thumb img');
    if(imgEl){
      var gimg=imgEl.dataset.gimg;
      var images=Store.get('resumeImages')||[];
      var imgData=images[parseInt(gimg)];
      var src=(imgData&&imgData.fullSrc)?imgData.fullSrc:imgEl.src;
      showImageLightbox(src);return
    }
    var add=e.target.closest('[data-gact="addImg"]');
    if(add){E.hiddenFileInput.click();return}
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
    }
  });

  // ── Position search ──
  E.posBrowseArea.addEventListener('click',function(e){
    var addBtn=e.target.closest('[data-addcustom]');
    if(addBtn){
      var w=(addBtn.dataset.addcustom||'').trim();
      if(w){
        var cp=Store.get('customPositions')||[];
        var sp=Store.get('selectedPositions')||[];
        if(cp.indexOf(w)<0&&sp.indexOf(w)<0)cp.push(w);
        Store.set('customPositions',cp);
        E.posSearch.value='';Store.set('posSearchQuery','');E.posSearchClear.style.display='none';
        window.renderPosBrowse();persistFilterState();
      }
      return
    }
    var ctag=e.target.closest('.selected-tag[data-custompos]');
    if(ctag){
      var cp2=Store.get('customPositions')||[];
      var ci=cp2.indexOf(ctag.dataset.custompos);
      if(ci>=0)cp2.splice(ci,1);
      Store.set('customPositions',cp2);
      window.renderPosBrowse();persistFilterState();
      return
    }
    var chip=e.target.closest('.chip[data-pos]');
    if(chip){
      var sel=Store.get('selectedPositions')||[];
      togD(sel,chip.dataset.pos,false);
      Store.set('selectedPositions',sel);
      window.renderPosBrowse();
      persistFilterState();
      return
    }
    var tag=e.target.closest('.selected-tag[data-pos]');
    if(tag){
      var sel=Store.get('selectedPositions')||[];
      var i=sel.indexOf(tag.dataset.pos);
      if(i>=0)sel.splice(i,1);
      Store.set('selectedPositions',sel);
      window.renderPosBrowse();
      persistFilterState();
      return
    }
  });
  // ── HR 活跃度单选 ──
  var _hrActiveCont=document.getElementById('hrActiveChips');
  if(_hrActiveCont){
    _hrActiveCont.addEventListener('click',function(e){
      var c=e.target.closest('.chip[data-hract]');if(!c)return;
      Store.set('hrActiveFilter',c.dataset.hract);
      if(window.renderHrActiveChips)window.renderHrActiveChips();
      persistFilterState();
    });
  }
  E.posSearch.addEventListener('input',function(){
    Store.set('posSearchQuery',E.posSearch.value);
    var q=Store.get('posSearchQuery');
    E.posSearchClear.style.display=q?'block':'none';
    window.renderPosBrowse()
  });
  E.posSearchClear.addEventListener('click',function(){
    E.posSearch.value='';
    Store.set('posSearchQuery','');
    E.posSearchClear.style.display='none';
    window.renderPosBrowse();
    E.posSearch.focus()
  });

  // ── Industry search ──
  E.indArea.addEventListener('click',function(e){
    var chip=e.target.closest('.chip[data-ind]');
    if(chip){
      var sel=Store.get('selectedIndustries')||[];
      togD(sel,chip.dataset.ind,false);
      Store.set('selectedIndustries',sel);
      window.renderInd();
      persistFilterState();
      return
    }
    var tag=e.target.closest('.selected-tag[data-ind]');
    if(tag){
      var sel=Store.get('selectedIndustries')||[];
      var i=sel.indexOf(tag.dataset.ind);
      if(i>=0)sel.splice(i,1);
      Store.set('selectedIndustries',sel);
      window.renderInd();
      persistFilterState();
      return
    }
    var hdr=e.target.closest('[data-toggle="ind"]');
    if(hdr){var g=hdr.closest('.industry-group');if(g)g.classList.toggle('collapsed')}
  });
  E.indSearch.addEventListener('input',function(){
    Store.set('indSearchQuery',E.indSearch.value);
    var q=Store.get('indSearchQuery');
    E.indSearchClear.style.display=q?'block':'none';
    window.renderInd()
  });
  E.indSearchClear.addEventListener('click',function(){
    E.indSearch.value='';
    Store.set('indSearchQuery','');
    E.indSearchClear.style.display='none';
    window.renderInd();
    E.indSearch.focus()
  });
  E.expandIndustries.addEventListener('click',function(){
    var show=Store.get('showAllIndustries');
    Store.set('showAllIndustries',!show);
    window.renderInd()
  });

  // ── Chip sections ──
  var chipSecs=[
    {e:E.workAreaChips,k:'workAreas'},
    {e:E.jobTypeChips,k:'jobTypes'},
    {e:E.applyTypeChips,k:'applyTypes'},
    {e:E.salaryChips,k:'salaryRanges'},
    {e:E.expChips,k:'experience'},
    {e:E.eduChips,k:'education'},
    {e:E.sizeChips,k:'companySizes'},
    {e:E.stageChips,k:'fundingStages'}
  ];
  var chipData={
    workAreas:null, // lazy from getWorkAreas
    jobTypes:['不限','全职','兼职'],
    applyTypes:['不限','社招','校招','实习'],
    salaryRanges:['不限','3K以下','3-5K','5-10K','10-20K','20-50K','50K以上'],
    experience:['不限','在校生','应届生','经验不限','1年以内','1-3年','3-5年','5-10年','10年以上'],
    education:['不限','初中及以下','中专/中技','高中','大专','本科','硕士','博士'],
    companySizes:['不限','0-20人','20-99人','100-499人','500-999人','1000-9999人','10000人以上'],
    fundingStages:['不限','未融资','天使轮','A轮','B轮','C轮','D轮及以上','已上市','不需要融资']
  };
  chipSecs.forEach(function(sec){
    sec.e.addEventListener('click',function(e){
      var c=e.target.closest('.chip');if(!c||!c.dataset.val)return;
      var v=c.dataset.val;
      var arr=Store.get(sec.k)||[];
      var da=sec.k==='workAreas'?getWorkAreas():chipData[sec.k];
      var hd=da&&da[0]==='不限';
      togD(arr,v,hd);
      Store.set(sec.k,arr);
      var items=sec.k==='workAreas'?getWorkAreas():chipData[sec.k];
      window.renderChips(sec.e,items,Store.get(sec.k)||[]);
      persistFilterState();
    })
  });

  // ── Reset & Collect buttons ──
  E.btnReset.addEventListener('click',function(){
    Store.set('selectedCities',[]);
    Store.set('selectedPositions',[]);
    Store.set('customPositions',[]);
    Store.set('hrActiveFilter','不限');
    Store.set('selectedIndustries',[]);
    Store.set('workAreas',['不限']);
    Store.set('jobTypes',['不限']);
    Store.set('applyTypes',['不限']);
    Store.set('salaryRanges',['不限']);
    Store.set('experience',['不限']);
    Store.set('education',['不限']);
    Store.set('companySizes',['不限']);
    Store.set('fundingStages',['不限']);
    Store.set('posSearchQuery','');
    Store.set('indSearchQuery','');
    E.posSearch.value='';
    E.indSearch.value='';
    E.posSearchClear.style.display='none';
    E.indSearchClear.style.display='none';
    Store.set('resumeImages',[]);
    window.renderResumeImages();
    Store.set('cityExpanded',false);
    window.renderCityChips('');
    chrome.storage.local.remove('resumeImages',function(){});
    window.renderSettings();
    persistFilterState();
    // 清除发送相关状态
    chrome.storage.local.remove('sw:sentJobIds');
    chrome.storage.local.remove('sw:sendResults');
    chrome.runtime.sendMessage({type:'CLEAR_SENT_JOB_IDS'});
  });
  E.btnCollect.addEventListener('click',function(){
    var cities=Store.get('selectedCities')||[];
    var positions=Store.get('selectedPositions')||[];
    var customPos=Store.get('customPositions')||[];
    if(!cities.length||(!positions.length&&!customPos.length)){
      alert('请至少选择目标城市和期望职位');
      return;
    }
    window.toResults();
  });
  E.btnBack.addEventListener('click',window.toSettings);

  // ── PDF 简历上传 ──
  var pdfInput = document.getElementById('pdfResumeInput');
  if (pdfInput) {
    pdfInput.addEventListener('change', async function(e) {
      var file = e.target.files[0];
      if (!file) return;
      try {
        var arrayBuffer = await file.arrayBuffer();
        var text = await extractPdfText(arrayBuffer);
        if (text && text.length > 50) {
          await sendResumeToSW(text, 'pdf');
          updateResumeUI(text);
          showToast('PDF 简历解析成功');
        } else {
          showToast('PDF 解析失败，请粘贴文字简历');
        }
      } catch (err) {
        showToast('PDF 解析错误：' + err.message);
      }
      e.target.value = '';
    });
  }

  // ── 文字简历粘贴 ──
  var resumeTextarea = document.getElementById('resumeTextInput');
  if (resumeTextarea) {
    resumeTextarea.addEventListener('blur', async function() {
      var text = resumeTextarea.value.trim();
      if (text && text.length > 30) {
        await sendResumeToSW(text, 'text');
        updateResumeUI(text);
      }
    });
  }

  // ── 图片简历上传（原有功能增强） ──
  var imgInput = document.getElementById('imgResumeInput');
  if (imgInput) {
    imgInput.addEventListener('change', function(e) {
      var files = e.target.files;
      if (!files || !files.length) return;
      E.hiddenFileInput.files = files;
      E.hiddenFileInput.dispatchEvent(new Event('change'));
    });
  }

  // ── AI 分析简历按钮 ──
  var btnAnalyze = document.getElementById('btnAnalyze');
  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', async function() {
      btnAnalyze.disabled = true;
      btnAnalyze.textContent = '分析中...';
      try {
        var resp = await sendMsg({ type: 'ANALYZE_RESUME' });
        if (resp && resp.success) {
          var resultEl = document.getElementById('analysisResult');
          if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.textContent = resp.analysis;
          }
          showToast('简历分析完成');
        } else {
          showToast('分析失败：' + (resp?.error || '未知错误'));
        }
      } catch (err) {
        showToast('分析错误：' + err.message);
      }
      btnAnalyze.disabled = false;
      btnAnalyze.textContent = 'AI 分析简历';
    });
  }

  // ── API Key 保存 ──
  var btnSaveKey = document.getElementById('btnSaveKey');
  if (btnSaveKey) {
    btnSaveKey.addEventListener('click', async function() {
      var key = document.getElementById('apiKeyInput').value.trim();
      if (!key) { showToast('请输入 API Key'); return; }
      await sendMsg({ type: 'SAVE_API_KEY', apiKey: key });
      showToast('API Key 已保存');
    });
  }

  // ── API 测试连接（通过 Service Worker 代理，避免 CORS 问题） ──
  var btnTestKey = document.getElementById('btnTestKey');
  if (btnTestKey) {
    btnTestKey.addEventListener('click', async function() {
      var resultEl = document.getElementById('apiTestResult');
      if (resultEl) resultEl.textContent = '测试中...';
      try {
        // 通过 Service Worker 测试 API
        var resp = await sendMsg({ type: 'TEST_API' });
        if (resp && resp.success) {
          if (resultEl) resultEl.textContent = '✅ 连接成功！模型：' + (resp.model || 'mimo-v2.5-pro');
        } else {
          if (resultEl) resultEl.textContent = '❌ 连接失败：' + (resp?.error || '未知错误');
        }
      } catch (err) {
        if (resultEl) resultEl.textContent = '❌ 测试失败：' + err.message;
      }
    });
  }

  // ── 初始化：加载已保存的 API Key 和简历 ──
  initResumeAndAPI();
};

// ── 辅助函数 ──
function sendMsg(msg) {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage(msg, function(resp) {
      if (chrome.runtime.lastError) { resolve({ success: false, error: chrome.runtime.lastError.message }); }
      else resolve(resp);
    });
  });
}

async function sendResumeToSW(text, format) {
  await sendMsg({ type: 'EXTRACT_RESUME', data: text, format: format });
}

function updateResumeUI(text) {
  var statusEl = document.getElementById('resumeStatus');
  var previewEl = document.getElementById('resumePreview');
  var btnAnalyze = document.getElementById('btnAnalyze');
  if (statusEl) statusEl.textContent = '已上传简历（' + text.length + ' 字）';
  if (previewEl) {
    previewEl.style.display = 'block';
    previewEl.textContent = text.substring(0, 200) + (text.length > 200 ? '...' : '');
  }
  if (btnAnalyze) btnAnalyze.style.display = 'inline-flex';
}

async function initResumeAndAPI() {
  // 加载 API Key
  var keyResp = await sendMsg({ type: 'GET_API_KEY' });
  if (keyResp && keyResp.apiKey) {
    var keyInput = document.getElementById('apiKeyInput');
    if (keyInput) keyInput.value = keyResp.apiKey;
  }
  // 加载简历状态
  chrome.storage.local.get(['sw:resumeText', 'sw:resumeAnalysis'], function(result) {
    if (result['sw:resumeText']) {
      updateResumeUI(result['sw:resumeText']);
    }
    if (result['sw:resumeAnalysis']) {
      var resultEl = document.getElementById('analysisResult');
      if (resultEl) {
        resultEl.style.display = 'block';
        resultEl.textContent = result['sw:resumeAnalysis'];
      }
    }
  });
}

// ── PDF 文本提取（简化版，使用 pdfjsLib 如果可用） ──
async function extractPdfText(arrayBuffer) {
  // 尝试使用 pdfjsLib（如果已加载）
  if (typeof pdfjsLib !== 'undefined') {
    try {
      var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      var text = '';
      for (var i = 1; i <= pdf.numPages; i++) {
        var page = await pdf.getPage(i);
        var content = await page.getTextContent();
        text += content.items.map(function(item) { return item.str; }).join(' ') + '\n';
      }
      return text.trim();
    } catch (e) {
      console.warn('[BossGreet] PDF.js 解析失败，使用备用方案:', e.message);
    }
  }
  // 备用方案：简单文本提取
  var decoder = new TextDecoder('utf-8', { fatal: false });
  var raw = decoder.decode(new Uint8Array(arrayBuffer));
  var texts = [];
  var match;
  var tjPattern = /\(([^)]{2,})\)\s*Tj/g;
  while ((match = tjPattern.exec(raw)) !== null) texts.push(match[1]);
  var tjArrayPattern = /\[(.*?)\]\s*TJ/g;
  while ((match = tjArrayPattern.exec(raw)) !== null) {
    var inner = match[1];
    var strMatches = inner.match(/\(([^)]*)\)/g);
    if (strMatches) texts.push(strMatches.map(function(s) { return s.slice(1, -1); }).join(''));
  }
  return texts.length > 0 ? texts.join('\n').trim() : '';
}

function showToast(msg) {
  // 简单 toast 实现
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:6px;font-size:12px;z-index:9999;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 2000);
}

// ── Collect params builder ──
window.buildCollectParams=function(){
  var state=Store.get();
  var urlParams={city:(state.city||{}).code||''};
  var selectedCities=state.selectedCities||[];
  if(selectedCities.length>0)urlParams.city=selectedCities[0];
  var _allPos=(state.selectedPositions||[]).concat(state.customPositions||[]);
  if(_allPos.length>0)urlParams.query=_allPos.join(',');
  if(state.jobTypes&&state.jobTypes.length>0){var jtMap={'全职':'1','兼职':'2'};var mapped=state.jobTypes.map(function(t){return jtMap[t]}).filter(Boolean);if(mapped.length)urlParams.jobType=mapped.join(',')}
  if(state.experience&&state.experience.length>0){var expMap={'在校生':'108','应届生':'102','经验不限':'101','1年以内':'103','1-3年':'104','3-5年':'105','5-10年':'106','10年以上':'107'};var mapped=state.experience.map(function(e){return expMap[e]}).filter(Boolean);if(mapped.length)urlParams.experience=mapped.join(',')}
  if(state.education&&state.education.length>0){var degMap={'初中及以下':'209','中专/中技':'208','高中':'206','大专':'202','本科':'203','硕士':'204','博士':'205'};var mapped=state.education.map(function(d){return degMap[d]}).filter(Boolean);if(mapped.length)urlParams.degree=mapped.join(',')}
  if(state.salaryRanges&&state.salaryRanges.length>0){var salaryMap={'3K以下':'1','3-5K':'2','5-10K':'3','10-20K':'4','20-50K':'5','50K以上':'6'};var mapped=state.salaryRanges.map(function(s){return salaryMap[s]}).filter(Boolean);if(mapped.length)urlParams.salary=mapped.join(',')}
  if(state.selectedIndustries&&state.selectedIndustries.length>0)urlParams.industry=state.selectedIndustries.join(',');
  if(state.companySizes&&state.companySizes.length>0){var scaleMap={'0-20人':'301','20-99人':'302','100-499人':'303','500-999人':'304','1000-9999人':'305','10000人以上':'306'};var mapped=state.companySizes.map(function(s){return scaleMap[s]}).filter(Boolean);if(mapped.length)urlParams.scale=mapped.join(',')}
  if(state.fundingStages&&state.fundingStages.length>0){var stageMap={'未融资':'801','天使轮':'802','A轮':'803','B轮':'804','C轮':'805','D轮及以上':'806','已上市':'807','不需要融资':'808'};var mapped=state.fundingStages.map(function(s){return stageMap[s]}).filter(Boolean);if(mapped.length)urlParams.stage=mapped.join(',')}
  if(state.workAreas&&state.workAreas.length>0){
    // BOSS 真实参数 = multiBusinessDistrict=<6位districtCode>,...，区中文名写 district= 无效
    var _cityCode=(state.selectedCities&&state.selectedCities[0])||(state.city&&state.city.code)||'';
    var _dMap=(typeof TAG_DATA!=='undefined'&&TAG_DATA.districtCodes)?TAG_DATA.districtCodes[_cityCode]:null;
    if(_dMap){
      var _codes=state.workAreas.map(function(n){return _dMap[n];}).filter(function(c){return c!=null;});
      if(_codes.length)urlParams.multiBusinessDistrict=_codes.join(',');
    }
  }
  if(state.applyTypes&&state.applyTypes.length>0)urlParams.applyType=state.applyTypes.filter(function(t){return t!=='不限'}).join(',');
  var tags=[];
  if(_allPos.length>0)tags.push.apply(tags,_allPos);
  var selectedFilters={};
  if(state.workAreas&&state.workAreas.length>0)selectedFilters.workAreas=[].concat(state.workAreas);
  if(state.jobTypes&&state.jobTypes.length>0)selectedFilters.jobTypes=[].concat(state.jobTypes);
  if(state.applyTypes&&state.applyTypes.length>0)selectedFilters.applyTypes=[].concat(state.applyTypes);
  if(state.salaryRanges&&state.salaryRanges.length>0)selectedFilters.salaryRanges=[].concat(state.salaryRanges);
  if(state.experience&&state.experience.length>0)selectedFilters.experience=[].concat(state.experience);
  if(state.education&&state.education.length>0)selectedFilters.education=[].concat(state.education);
  if(state.selectedIndustries&&state.selectedIndustries.length>0)selectedFilters.industries=[].concat(state.selectedIndustries);
  if(state.companySizes&&state.companySizes.length>0)selectedFilters.companySizes=[].concat(state.companySizes);
  if(state.fundingStages&&state.fundingStages.length>0)selectedFilters.fundingStages=[].concat(state.fundingStages);
  return {urlParams:urlParams,tags:tags,filters:selectedFilters,selectedPositions:[].concat(state.selectedPositions||[]),customPositions:[].concat(state.customPositions||[]),selectedCities:selectedCities};
};

// ── A 页筛选条件持久化 ──
var _filterPersistTimer = null;
function persistFilterState() {
  clearTimeout(_filterPersistTimer);
  _filterPersistTimer = setTimeout(function () {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    if (typeof STORAGE_KEYS === 'undefined') return;
    try {
      var s = Store.get();
      chrome.storage.local.set({
        [STORAGE_KEYS.UI.FILTER_STATE]: {
          selectedCities: s.selectedCities,
          selectedPositions: s.selectedPositions,
          customPositions: s.customPositions,
          hrActiveFilter: s.hrActiveFilter,
          selectedIndustries: s.selectedIndustries,
          workAreas: s.workAreas,
          jobTypes: s.jobTypes,
          applyTypes: s.applyTypes,
          salaryRanges: s.salaryRanges,
          experience: s.experience,
          education: s.education,
          companySizes: s.companySizes,
          fundingStages: s.fundingStages,
        }
      });
    } catch (e) {}
  }, 300);
}

// ── Image lightbox ──
function showImageLightbox(src) {
  var overlay = document.createElement('div');
  overlay.className = 'img-lightbox-overlay';
  overlay.innerHTML = '<img src="' + src + '" class="img-lightbox">';
  overlay.addEventListener('click', function() {
    overlay.remove();
    document.removeEventListener('keydown', esc);
  });
  function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
  }
  document.addEventListener('keydown', esc);
  document.body.appendChild(overlay);
}
