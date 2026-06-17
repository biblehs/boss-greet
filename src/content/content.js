// Content Script 入口 — 根据 URL 路由 + 消息监听

// 🔴 发布打包前改为 false：关闭 window.postMessage 测试桥，防同页恶意脚本触发自动投递
const TEST_BRIDGE_ENABLED = true;

// ── 同步诊断：直接写 documentElement.dataset.diagSync ringer（零 await，零 race） ──
// 决策：ErrorLogger.logError 是 async read-modify-write，多个 _dbg 连续调用时后写覆盖前写
// 实测 2026-05-24：click flow 11 个 _dbg 实际只留 5 个，apiCheck/bossInfo/hrExtracted 等中间项被冲掉
// 同步 attribute 写在 isolated world 内单线程同步执行，绝不丢数据；osascript 读 data-diag-sync 即可
function _persistDiag(prefix, info) {
  try {
    var el = document.documentElement;
    if (!el) return;
    var raw = el.getAttribute('data-diag-sync') || '[]';
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push({ t: Date.now(), m: '[' + prefix + '] ' + JSON.stringify(info || {}) });
    if (arr.length > 500) arr = arr.slice(-500);
    el.setAttribute('data-diag-sync', JSON.stringify(arr));
  } catch (e) {}
}

// Self-test 入口：main world (osascript inject) 通过 CustomEvent 跨 world 触发 CS 自己调
// _persistDiag N 次，用于验证「修改后 content.js 已被加载 + 同步诊断写无丢失」。
// 用法：document.dispatchEvent(new CustomEvent('ZITOU_DIAG_TEST', {detail:{n:100}}))
try {
  document.addEventListener('ZITOU_DIAG_TEST', function(e) {
    var n = (e && e.detail && e.detail.n) || 100;
    for (var i = 0; i < n; i++) _persistDiag('test:' + i, { i: i, ts: Date.now() });
  });
} catch (_) {}

// ── JobClicker 内联到 content.js（manifest 中文件顺序有时不可靠）──
async function waitForElHidden(selectors, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  var start = Date.now();
  while (Date.now() - start < timeoutMs) {
    var visible = false;
    for (var si = 0; si < (Array.isArray(selectors) ? selectors : [selectors]).length; si++) {
      var el = document.querySelector((Array.isArray(selectors) ? selectors : [selectors])[si]);
      if (el && el.offsetParent !== null) { visible = true; break; }
    }
    if (!visible) return true;
    await new Promise(function(r) { setTimeout(r, 200); });
  }
  return false;
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

// ── HR 活跃解析 + 阈值判定（Item2，send 期逐岗判定）──
function parseHrActivity(onlineText, activeText){
  if(onlineText && /在线/.test(onlineText)) return {online:true, activeDays:0, desc:'在线'};
  var t=(activeText||'').trim();
  if(!t) return {online:false, activeDays:null, desc:''};
  if(/刚刚|今日|今天/.test(t)) return {online:false, activeDays:1, desc:t};
  var dm=t.match(/(\d+)\s*日内/); if(dm) return {online:false, activeDays:parseInt(dm[1]), desc:t};
  if(/本周/.test(t)) return {online:false, activeDays:7, desc:t};
  var wm=t.match(/(\d+)\s*周内/); if(wm) return {online:false, activeDays:parseInt(wm[1])*7, desc:t};
  if(/本月/.test(t)) return {online:false, activeDays:30, desc:t};
  var mm=t.match(/(\d+)\s*月内/); if(mm) return {online:false, activeDays:parseInt(mm[1])*30, desc:t};
  if(/半年内|近半年/.test(t)) return {online:false, activeDays:180, desc:t};
  if(/半年前|年前|更早/.test(t)) return {online:false, activeDays:999, desc:t};
  return {online:false, activeDays:null, desc:t};
}
// fail-open：未知/读不到→放行（避免读取毛刺误杀）；online 永远通过
function passActivityFilter(filter, act){
  if(!filter || filter==='不限') return true;
  if(filter==='只投在线') return act.online===true;
  var maxMap={'3日内活跃':3,'本周内活跃':7,'本月内活跃':30};
  var max=maxMap[filter]; if(max==null) return true;
  if(act.online) return true;
  if(act.activeDays==null) return true;
  return act.activeDays<=max;
}

var JobClicker = {
  findCardByLink: function(jobLink) {
    var cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    var jobId = (jobLink || '').split('/').pop();
    if (jobId) jobId = jobId.replace('.html', '');
    if (!jobId) return null;
    for (var c = 0; c < cards.length; c++) {
      var links = cards[c].querySelectorAll('a');
      for (var l = 0; l < links.length; l++) {
        if ((links[l].getAttribute('href') || '').includes(jobId)) return cards[c];
      }
    }
    return null;
  },
  findCardByText: function(positionName, companyName) {
    var cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    for (var c = 0; c < cards.length; c++) {
      var nameEl = cards[c].querySelector(SELECTORS.jobs.jobName);
      var companyEl = cards[c].querySelector(SELECTORS.jobs.company);
      if (!nameEl || !companyEl) continue;
      if (nameEl.textContent.trim() === positionName && companyEl.textContent.trim().includes(companyName)) return cards[c];
    }
    return null;
  },

  // v5: 只点"立即沟通"，提取HR信息，关闭弹窗，不导航页面
  clickImmediateChat: async function(jobLink, positionName, companyName, hrActiveFilter) {
    // 同步诊断 _persistDiag 是真相源（dataset 写无 race）；ErrorLogger 保留双写仅作 SW 侧回看。
    // 2026-05-24 修复：ErrorLogger.logError 多写 race 导致中间项丢失 → _persistDiag 同步直写 dataset 永不丢。
    var _dbg = function(s, i) {
      _persistDiag(s, i);
      try { chrome.runtime.sendMessage({ type: 'CS_DBG', stage: s, info: i || {} }).catch(function(){}); } catch (_) {}
      try {
        if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
          ErrorLogger.logError('[' + s + '] ' + JSON.stringify(i || {}), '', 'click.diag');
        }
      } catch (_) {}
    };
    _dbg('click:start', { jobLink: jobLink, positionName: positionName });
    // 硬中止：每个 await 边界前后检查 stopped，停了立即 bail（不点卡片/不点立即沟通/不开弹窗）
    var _isStopped = function() { return typeof JobCollector !== 'undefined' && JobCollector.stopped; };
    if (_isStopped()) { _dbg('click:bail', { at: 'start' }); return { success: false, stopped: true }; }
    var card = null;
    if (jobLink) card = this.findCardByLink(jobLink);
    if (!card && positionName && companyName) card = this.findCardByText(positionName, companyName);
    _dbg('click:findCard', { found: !!card, byLink: !!(jobLink && this.findCardByLink(jobLink)) });
    if (!card) return { success: false, error: '未找到岗位卡片: ' + (positionName || jobLink) };
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise(function(r) { setTimeout(r, 200); });
    if (_isStopped()) { _dbg('click:bail', { at: 'beforeCardClick' }); return { success: false, stopped: true }; }
    _dbg('click:beforeCardClick', { urlBefore: location.href });
    card.click();
    await new Promise(function(r) { setTimeout(r, 800); });
    if (_isStopped()) { _dbg('click:bail', { at: 'afterCardClick' }); return { success: false, stopped: true }; }
    _dbg('click:afterCardClick', { urlAfter: location.href });
    if (typeof detectCaptcha === 'function' && detectCaptcha().detected) {
      _dbg('click:captcha', {});
      return { success: false, error: 'captcha detected after clicking card' };
    }

    // 提取HR信息（详情面板 .job-boss-info）
    var bossInfo = document.querySelector('.job-boss-info');
    _dbg('click:bossInfo', { found: !!bossInfo });
    var hrName = '';
    var hrCompany = '';
    if (bossInfo) {
      var nameH2 = bossInfo.querySelector('h2.name, .name');
      if (nameH2) {
        for (var ci = 0; ci < nameH2.childNodes.length; ci++) {
          var node = nameH2.childNodes[ci];
          if (node.nodeType === 3) { hrName += node.nodeValue; }
          else if (node.nodeType === 1 && node.tagName !== 'I') break;
        }
        hrName = hrName.trim();
      }
      var attrEl = bossInfo.querySelector('.boss-info-attr');
      if (attrEl) {
        var attrText = attrEl.textContent.trim();
        hrCompany = (attrText.split(' · ')[0] || '').trim();
      }
    }
    _dbg('click:hrExtracted', { hrName: hrName, hrCompany: hrCompany });
    if (!hrName) return { success: false, error: '无法提取HR信息' };

    // HR 活跃筛选：复用已打开的 .job-boss-info 面板，零额外请求；不达标则跳过、不发起联系
    var _act = parseHrActivity(
      (bossInfo.querySelector('.boss-online-tag') || {}).textContent || '',
      (bossInfo.querySelector('.boss-active-time') || {}).textContent || ''
    );
    if (!passActivityFilter(hrActiveFilter, _act)) {
      _dbg('click:activitySkip', { filter: hrActiveFilter, desc: _act.desc });
      return { success: false, skipped: true, skipReason: 'HR活跃不符', activeDesc: _act.desc };
    }

    // 点击"立即沟通"
    if (_isStopped()) { _dbg('click:bail', { at: 'beforeWaitChatBtn' }); return { success: false, stopped: true }; }
    _dbg('click:waitChatBtn', {});
    var chatBtn = await waitForElement(SELECTORS.jobs.immediateChatBtn, 5000);
    _dbg('click:chatBtnFound', { found: !!chatBtn });
    if (!chatBtn) return { success: false, error: '未找到立即沟通按钮' };
    // 关键：等到按钮后若已停止，绝不点击「立即沟通」、不发起联系
    if (_isStopped()) { _dbg('click:bail', { at: 'beforeChatClick' }); return { success: false, stopped: true }; }

    // 诊断：click 前后 diff performance resource entries，看 BOSS conv create wapi 是否真被调用
    // 2026-05-25 实测根因：单独 chatBtn.click() 只触发 dapCommon 上报，不触发 friend/add.json
    // → BOSS Vue add friend handler 监 mousedown+mouseup+click 完整序列；单 click 事件不足
    // → 改为完整鼠标序列（osascript inject 3 连点实测 3/3 add.json 全发出）
    var _apiBefore = (performance.getEntriesByType('resource') || []).length;
    var _mOpts = { bubbles: true, cancelable: true, view: window, button: 0 };
    chatBtn.dispatchEvent(new MouseEvent('mousedown', _mOpts));
    chatBtn.dispatchEvent(new MouseEvent('mouseup', _mOpts));
    chatBtn.dispatchEvent(new MouseEvent('click', _mOpts));
    await new Promise(function(r) { setTimeout(r, 800); });
    try {
      var _all = performance.getEntriesByType('resource') || [];
      var _newOnes = _all.slice(_apiBefore);
      var _wapiNew = _newOnes.filter(function(e) { return /wapi/.test(e.name || ''); }).map(function(e) {
        return {
          url: (e.name || '').replace('https://www.zhipin.com', '').substring(0, 150),
          dur: Math.round(e.duration || 0),
          size: e.transferSize || 0,
        };
      }).slice(0, 10);
      _persistDiag('click:apiCheck', {
        hrName: hrName,
        hrCompany: hrCompany,
        wapiNewCount: _wapiNew.length,
        wapiNew: _wapiNew,
      });
      if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
        ErrorLogger.logError('[click:apiCheck] ' + JSON.stringify({
          hrName: hrName,
          hrCompany: hrCompany,
          wapiNewCount: _wapiNew.length,
          wapiNew: _wapiNew,
        }), '', 'click.diag');
      }
    } catch (_) {}

    // 关闭打招呼弹窗（可能是普通弹窗，也可能是同HR多岗位弹窗）
    if (_isStopped()) { _dbg('click:bail', { at: 'beforeCloseDialog' }); return { success: false, stopped: true }; }
    _dbg('click:beforeCloseDialog', {});
    await this._closeGreetDialog();
    _dbg('click:afterCloseDialog', {});

    return { success: true, hrName: hrName, hrCompany: hrCompany };
  },

  _closeGreetDialog: async function() {
    // 委托给共用函数（stage1 提取 与 stage2 发送/补发 单一来源）
    await closeBlockingDialogs(3);
  },
};

// ── 关闭挡路弹窗（打招呼/同HR多岗位/沟通次数上限/投递成功率较低/温馨提示 等）──
// 两层策略：先 `.icon-close.click()`，剩余仍可见的弹窗 fallback `.remove()`。
// 决策依据（2026-05-25 实测：osascript inject 4 连点对照矩阵）：
//   - `.remove()` 单用：1/4 add（第 1 个 add 后弹「招呼输入框」被 remove → Vue 状态保留
//     「该 HR 正在打招呼」→ 后续岗位 card.click 切换后 chatBtn 直接 disabled，add API 不发）
//   - `.icon-close.click()` 单用：3/3 add（走 Vue close handler 正常释放 BOSS 内部业务状态）
//   - chat-block-dialog 无 .icon-close → 该弹窗为业务异常（限速/超额），无 add 流程不会污染状态
//     用 fallback .remove() 兜底安全（不触发 sure-btn 跳转副作用）
// 旧版「.remove() 零副作用」结论是单弹窗实测，没覆盖「连续多岗位 add」场景下的 Vue 状态污染。
async function closeBlockingDialogs(maxRounds) {
  maxRounds = maxRounds || 3;
  for (var round = 0; round < maxRounds; round++) {
    await new Promise(function(r) { setTimeout(r, 400); });

    // Step 1: 优先 .icon-close.click() 走 Vue close handler（释放 BOSS 业务状态）
    var closers = document.querySelectorAll('.icon-close');
    var clicked = 0;
    for (var ci = 0; ci < closers.length; ci++) {
      if (closers[ci].offsetHeight > 0) {
        try { closers[ci].click(); clicked++; } catch (e) {}
      }
    }
    await new Promise(function(r) { setTimeout(r, 300); });

    // Step 2: 仍可见的弹窗（如 chat-block-dialog 无 .icon-close）→ fallback .remove()
    var dialogs = document.querySelectorAll('[class*="dialog"]');
    var removed = 0;
    for (var i = 0; i < dialogs.length; i++) {
      if (dialogs[i].offsetHeight > 0) {
        try { dialogs[i].remove(); removed++; } catch (e) {}
      }
    }
    if (clicked > 0 || removed > 0) {
      console.log('[即投] closeBlockingDialogs: round=' + (round + 1) + ' iconClicked=' + clicked + ' fallbackRemoved=' + removed);
    }
    await new Promise(function(r) { setTimeout(r, 300); });
    var stillOpen = false;
    var nodes = document.querySelectorAll('[class*="dialog"]');
    for (var j = 0; j < nodes.length; j++) {
      if (nodes[j].offsetHeight > 0) { stillOpen = true; break; }
    }
    if (!stillOpen) return true;
  }
  var leftover = document.querySelectorAll('[class*="dialog"]');
  for (var k = 0; k < leftover.length; k++) {
    if (leftover[k].offsetHeight > 0) {
      console.warn('[即投] closeBlockingDialogs: 多轮后弹窗仍在，cls=' +
        leftover[k].className + ' text=' + (leftover[k].textContent || '').trim().substring(0, 100));
      return false;
    }
  }
  return true;
}

// ── 聊天页辅助：根据HR名字+公司名查找对话 ──
function findChatConversation(hrName, hrCompany) {
  var items = document.querySelectorAll('.user-list-content li, .friend-content-warp');
  hrName = (hrName || '').trim();
  hrCompany = (hrCompany || '').trim();
  console.log('[即投] findChatConversation: 在', items.length, '个对话中搜索 hrName="' + hrName + '" hrCompany="' + hrCompany + '"');

  for (var i = 0; i < items.length; i++) {
    var nameEl = items[i].querySelector('.name-text');
    if (!nameEl) continue;
    var nameText = nameEl.textContent.trim();
    if (!nameText.includes(hrName) && hrName !== nameText) continue;
    // 检查公司名匹配
    var nameBox = items[i].querySelector('.name-box');
    if (nameBox) {
      var spans = nameBox.querySelectorAll('span');
      for (var s = 0; s < spans.length; s++) {
        if (spans[s].classList.contains('name-text')) continue;
        var companyText = spans[s].textContent.trim();
        if (companyText.includes(hrCompany) || hrCompany === companyText) {
          console.log('[即投] findChatConversation: 找到匹配对话 idx=' + i + ' name="' + nameText + '"');
          // 必须返回 .friend-content（内层div），不能返回 .friend-content-warp（外层div）
          // BOSS Vue 2 的 click handler 绑在 .friend-content 上
          // JS .click() 事件从目标元素开始，只向上冒泡，不向下传递到子元素
          // 如果点 .friend-content-warp，事件不会到达 .friend-content，handler 不触发
          if (items[i].tagName === 'LI') {
            return items[i].querySelector('.friend-content, [class*="friend-content"]') || items[i].querySelector('.friend-content-warp') || items[i];
          }
          if (items[i].classList.contains('friend-content-warp')) {
            return items[i].querySelector('.friend-content') || items[i];
          }
          return items[i];
        }
      }
      // 公司名不匹配，跳过这个 item
      continue;
    }
  }
  // 兜底：只按名字匹配（公司名可能对不上）
  for (var j = 0; j < items.length; j++) {
    var nEl = items[j].querySelector('.name-text');
    if (nEl) {
      var nText = nEl.textContent.trim();
      if (nText.includes(hrName) || hrName === nText) {
        console.log('[即投] findChatConversation: 兜底匹配 idx=' + j + ' name="' + nText + '"');
        if (items[j].tagName === 'LI') {
          return items[j].querySelector('.friend-content, [class*="friend-content"]') || items[j].querySelector('.friend-content-warp') || items[j];
        }
        if (items[j].classList.contains('friend-content-warp')) {
          return items[j].querySelector('.friend-content') || items[j];
        }
        return items[j];
      }
    }
  }
  try {
    if (typeof ErrorLogger !== 'undefined' && ErrorLogger.logError) {
      var _listNames = [];
      for (var d = 0; d < items.length && _listNames.length < 20; d++) {
        var _ne = items[d].querySelector('.name-text');
        if (_ne) _listNames.push(_ne.textContent.trim());
      }
      ErrorLogger.logError('[findConv:diag] ' + JSON.stringify({
        searchHrName: hrName,
        searchHrCompany: hrCompany,
        listCount: items.length,
        listNames: _listNames,
        url: location.href,
      }), '', 'findConv.diag');
    }
  } catch (e) {}
  console.warn('[即投] findChatConversation: 未找到匹配对话');
  return null;
}

(async () => {
  const href = window.location.href;

  // ── 全局错误捕获 ──
  self.addEventListener('error', (event) => {
    if (typeof ErrorLogger !== 'undefined') {
      ErrorLogger.logError(event.message, event.filename + ':' + event.lineno, 'Content script global error');
    }
  });
  self.addEventListener('unhandledrejection', (event) => {
    if (typeof ErrorLogger !== 'undefined') {
      ErrorLogger.logError(event.reason?.message || String(event.reason), event.reason?.stack, 'Content script unhandled rejection');
    }
  });

  // ── 初始化：把已存储的错误日志同步到 DOM ──
  if (typeof ErrorLogger !== 'undefined') {
    ErrorLogger.getErrors().then(function(errors) {
      if (document.documentElement) {
        if (errors.length > 0) {
          document.documentElement.setAttribute('data-error-log', JSON.stringify(errors));
        }
      }
    }).catch(function(){});
  }

  // ── window.postMessage 监听 ──
  if (TEST_BRIDGE_ENABLED) {
  window.addEventListener('message', function(event) {
    if (!event.data || !event.data.type) return;

    function setSplitAttr(baseName, data) {
      var json = JSON.stringify(data);
      if (json.length <= 10240) {
        document.documentElement.setAttribute('data-' + baseName, json);
        return;
      }
      var idx = 0;
      while (idx * 10240 < json.length) {
        document.documentElement.setAttribute(
          'data-' + baseName + '-' + idx,
          json.slice(idx * 10240, (idx + 1) * 10240)
        );
        idx++;
      }
    }

    switch (event.data.type) {
      case 'GET_ERROR_LOG':
        if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.syncToDOM === 'function') {
          ErrorLogger.syncToDOM();
        }
        break;

      case 'GET_EXTENSION_STATE':
        chrome.storage.local.get(['sw:phase', 'sw:jobs', 'sw:greetings', 'sw:sendProgress', 'sw:sentJobIds', 'sw:sendResults', 'ui:filterState'], function(items) {
          setSplitAttr('ext-state', items);
        });
        break;

      case 'TRIGGER_GREETING_GEN':
        chrome.runtime.sendMessage({ type: 'REGENERATE_GREETING' }, function(resp) {
          setTimeout(function() {
            chrome.storage.local.get(['sw:greetings'], function(data) {
              var result = { response: resp, greetings: data['sw:greetings'] };
              if (typeof ErrorLogger !== 'undefined') {
                ErrorLogger.getErrors().then(function(errors) {
                  result.errorLog = errors;
                  setSplitAttr('greeting-result', result);
                }).catch(function() {
                  setSplitAttr('greeting-result', result);
                });
              } else {
                setSplitAttr('greeting-result', result);
              }
            });
          }, 5000);
        });
        break;

      case 'RELOAD_EXTENSION':
        // 全自动开发重载（零抢屏）：content script 无 chrome.runtime.reload 特权，故转发给 SW 执行。
        // SW 置 __pending_tab_reload flag 后 reload；扩展重启后 SW top-level 读 flag 原地
        // chrome.tabs.reload 所有 BOSS tab → Chrome 自动注入新版 CS（不开新 tab、不切焦点）。
        try {
          chrome.runtime.sendMessage({ type: 'RELOAD_EXT_SELF' });
          document.documentElement.setAttribute('data-ext-cmd-result', 'reload_requested');
        }
        catch(e) { document.documentElement.setAttribute('data-ext-cmd-result', 'reload_failed: ' + e.message); }
        break;

      case 'CLEAR_ERRORS':
        if (typeof ErrorLogger !== 'undefined' && typeof ErrorLogger.clearErrors === 'function') {
          ErrorLogger.clearErrors().then(function() {
            document.documentElement.setAttribute('data-ext-cmd-result', 'errors_cleared');
          }).catch(function() {
            document.documentElement.setAttribute('data-ext-cmd-result', 'error_clear_failed');
          });
        } else {
          document.documentElement.setAttribute('data-ext-cmd-result', 'error_logger_unavailable');
        }
        break;

      case 'GET_SEND_STATUS':
        chrome.storage.local.get(['sw:sendProgress', 'sw:sentJobIds', 'sw:sendResults', 'sw:phase'], function(data) {
          setSplitAttr('send-status', data);
        });
        break;

      case 'TRIGGER_COLLECT': {
        var params = event.data.params;
        if (!params) {
          params = {};
          try {
            var urlParams = new URLSearchParams(window.location.search);
            urlParams.forEach(function(value, key) { params[key] = value; });
          } catch (e) {
            if (typeof ErrorLogger !== 'undefined') {
              ErrorLogger.logError(e.message, e.stack, 'TRIGGER_COLLECT parseURL');
            }
          }
        }
        chrome.runtime.sendMessage({ type: 'START_COLLECT', params: params }, function(resp) {
          if (chrome.runtime.lastError) {
            document.documentElement.setAttribute('data-ext-cmd-result', JSON.stringify({ success: false, error: chrome.runtime.lastError.message }));
            if (typeof ErrorLogger !== 'undefined') {
              ErrorLogger.logError(chrome.runtime.lastError.message, null, 'TRIGGER_COLLECT sendMessage');
            }
            return;
          }
          document.documentElement.setAttribute('data-ext-cmd-result', JSON.stringify(resp || {}));
        });
        break;
      }

      case 'SET_GREETING':
        chrome.storage.local.set({'sw:greetings': event.data.greetings}, function() {
          document.documentElement.setAttribute('data-greeting-set', 'done');
        });
        break;

      // 测试桥：把一张简历图写进 resumeImages storage（产品发送路径 _sendResumeImages 读的同一个 key）。
      // 复刻 A 页上传 events-a.js 写入的 storage 条目形状 {name,type,data,id,thumb,fullSrc} + 原子 get-then-set
      // （等价 helpers.js atomicUpdateResumeImages），保证发送路径能读到、popup 重载后缩略图也能渲染。
      // 仅测试用：osascript 够不到 chrome.storage / file picker 需可信用户手势，无此桥无法自动喂图。产品流程永不发此消息。
      case 'EXT_TEST_SET_RESUME': {
        try {
          var _du = event.data.dataUrl || '';
          var _comma = _du.indexOf(',');
          var _meta = _comma >= 0 ? _du.slice(0, _comma) : '';
          var _b64 = _comma >= 0 ? _du.slice(_comma + 1) : _du;
          var _typeM = _meta.match(/data:([^;]+)/);
          var _type = (_typeM && _typeM[1]) || 'image/jpeg';
          var _bin = atob(_b64);
          var _data = new Array(_bin.length);
          for (var _i = 0; _i < _bin.length; _i++) _data[_i] = _bin.charCodeAt(_i);
          var _name = event.data.name || 'resume.jpg';
          var _id = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          var _entry = { name: _name, type: _type, data: _data, id: _id, thumb: _du, fullSrc: _du };
          chrome.storage.local.get('resumeImages', function(r) {
            var arr = r.resumeImages || [];
            arr.push(_entry);
            chrome.storage.local.set({ resumeImages: arr }, function() {
              document.documentElement.setAttribute('data-ext-set-resume', JSON.stringify({ success: true, count: arr.length, bytes: _data.length }));
            });
          });
        } catch (e) {
          document.documentElement.setAttribute('data-ext-set-resume', JSON.stringify({ success: false, error: e && e.message }));
        }
        break;
      }

      case 'CLEAR_SENT_JOB_IDS':
        chrome.runtime.sendMessage({type:'CLEAR_SENT_JOB_IDS'});
        chrome.storage.local.remove('sw:sentJobIds');
        chrome.storage.local.remove('sw:sendResults');
        document.documentElement.setAttribute('data-ext-cmd-result','sent_job_ids_cleared');
        break;

      case 'TRIGGER_SEND_V4': {
        var jobIds = event.data.jobIds;
        var _testHrFilter = event.data.hrActiveFilter || '不限';
        var doSend = function(ids) {
          chrome.runtime.sendMessage({ type: 'START_SEND', jobIds: ids, hrActiveFilter: _testHrFilter }, function(resp) {
            if (chrome.runtime.lastError) {
              document.documentElement.setAttribute('data-ext-cmd-result', JSON.stringify({ success: false, error: chrome.runtime.lastError.message }));
              if (typeof ErrorLogger !== 'undefined') {
                ErrorLogger.logError(chrome.runtime.lastError.message, null, 'TRIGGER_SEND_V4 sendMessage');
              }
              return;
            }
            document.documentElement.setAttribute('data-ext-cmd-result', JSON.stringify(resp || {}));
          });
        };
        if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
          chrome.storage.local.get(['sw:jobs'], function(items) {
            var jobs = items['sw:jobs'] || [];
            if (jobs.length > 0) {
              doSend([jobs[0].id]);
            } else {
              document.documentElement.setAttribute('data-ext-cmd-result', JSON.stringify({ success: false, error: 'No jobs found in storage' }));
            }
          });
        } else {
          doSend(jobIds);
        }
        break;
      }

      case 'EXT_TEST_OPEN_POPUP':
        chrome.runtime.sendMessage({ type: '__TEST_OPEN_POPUP__' }, function(resp) {
          if (chrome.runtime.lastError) {
            document.documentElement.setAttribute('data-test-popup-tab-id', JSON.stringify({ success: false, error: chrome.runtime.lastError.message }));
            return;
          }
          document.documentElement.setAttribute('data-test-popup-tab-id', JSON.stringify(resp || { success: false, error: 'no response' }));
        });
        break;

      case 'EXT_TEST_CLOSE_POPUP':
        chrome.runtime.sendMessage({ type: '__TEST_CLOSE_POPUP__', tabId: event.data.tabId }, function(resp) {
          if (chrome.runtime.lastError) {
            document.documentElement.setAttribute('data-test-popup-close', JSON.stringify({ success: false, error: chrome.runtime.lastError.message }));
            return;
          }
          document.documentElement.setAttribute('data-test-popup-close', JSON.stringify(resp || { success: false, error: 'no response' }));
        });
        break;

      case 'EXT_TEST_OPEN_TAB':
        // 测试桥：SW 用 chrome.tabs.create({active:false}) 开后台 BOSS tab（不抢屏）。
        chrome.runtime.sendMessage({ type: '__TEST_OPEN_TAB__', url: event.data.url }, function(resp) {
          if (chrome.runtime.lastError) {
            document.documentElement.setAttribute('data-test-open-tab', JSON.stringify({ success: false, error: chrome.runtime.lastError.message }));
            return;
          }
          document.documentElement.setAttribute('data-test-open-tab', JSON.stringify(resp || { success: false, error: 'no response' }));
        });
        break;
    }
  });
  }

  // ── 消息监听 ──
  try { chrome.runtime.sendMessage({ type: 'CS_DBG', stage: 'cs:listenerRegister', info: { url: location.href, msgKeys: Object.keys(MSG || {}).length, doBatchExtract: MSG && MSG.DO_BATCH_EXTRACT } }).catch(function(){}); } catch (_) {}
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 全消息桥到 SW：诊断 case 是否命中
    if (msg && msg.type !== 'CS_DBG') {
      try { chrome.runtime.sendMessage({ type: 'CS_DBG', stage: 'cs:onMessage', info: { rcvType: msg.type, isDoBatchExtract: msg.type === MSG.DO_BATCH_EXTRACT, isPing: msg.type === MSG.PING } }).catch(function(){}); } catch (_) {}
    }
    if (msg.type === MSG.PING) {
      sendResponse({ type: MSG.PONG });
      return true;
    }

    switch (msg.type) {
      case MSG.DO_COLLECT:
        handleCollect(msg.params).then(
          (result) => sendResponse({ success: true, ...result }),
          (e) => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.DO_SEND:
        handleSend(msg.jobIds).then(
          (result) => sendResponse({ success: true, ...result }),
          (e) => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.DO_START_CHAT:
        // v5: 搜索页点"立即沟通"，返回 HR 信息
        handleStartChat(msg).then((result) => {
          sendResponse(result);
        }, (e) => {
          sendResponse({ success: false, error: e.message });
        });
        return true;

      case MSG.DO_SEND_CHAT:
        // v5: 聊天页匹配对话 + 发送消息
        handleSendChat(msg).then(
          (result) => sendResponse(result),
          (e) => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.DO_STOP:
        if (typeof JobCollector !== 'undefined') JobCollector.stopped = true;
        if (typeof JobSender !== 'undefined') JobSender.stop();
        if (typeof ChatListMonitor !== 'undefined') ChatListMonitor.stop();
        sendResponse({ success: true });
        break;

      case MSG.DO_BATCH_EXTRACT:
        console.log('[即投] DO_BATCH_EXTRACT 到达 CS, queueLen:', msg.queue?.length, 'url:', location.href);
        _persistDiag('DO_BATCH_EXTRACT:rcv', { queueLen: msg.queue?.length, url: location.href });
        handleBatchExtract(msg).then(
          (result) => sendResponse(result),
          (e) => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.WORKER_ACTIVATE:
        handleWorkerActivate(msg).then(
          (result) => sendResponse(result),
          (e) => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.WORKER_SEND:
        handleWorkerSend(msg).then(
          (result) => sendResponse(result),
          (e) => sendResponse({ success: false, error: e.message })
        );
        return true;

      case MSG.WORKER_REPAIR:
        handleWorkerRepair(msg).then(
          (result) => sendResponse(result),
          (e) => sendResponse({ complete: false, error: e.message })
        );
        return true;

      case MSG.QUEUE_EMPTY:
        // 不再自动关闭 tab — 留给用户手动关闭，确保消息有充足时间发送完毕
        return;

      case 'GET_ERROR_LOG':
        if (typeof ErrorLogger !== 'undefined') {
          ErrorLogger.getErrors()
            .then(errors => sendResponse({ success: true, errors }))
            .catch(() => sendResponse({ success: false, error: 'Failed to read error log' }));
        } else {
          sendResponse({ success: false, error: 'ErrorLogger not available' });
        }
        return true;
    }
  });

  // ── 路由 ──
  if (href.includes('/web/geek/jobs')) {
    console.log('[即投] 岗位搜索页已就绪 (v5 双页并行)');
  } else if (href.includes('/web/geek/chat')) {
    if (typeof ChatListMonitor !== 'undefined') ChatListMonitor.start();
    console.log('[即投] 聊天页已就绪 (v5 双页并行)');
  } else if (href.includes('/job_detail/')) {
    console.log('[即投] 岗位详情页已就绪');
  }

  // ── 通知 SW：CS 注入完成（携带角色信息）──
  var role = '';
  if (href.includes('/web/geek/jobs')) {
    role = 'search';
  } else if (href.includes('/web/geek/chat')) {
    role = 'worker';
  }
  chrome.runtime.sendMessage({ type: MSG.CS_READY, url: href, role: role }).catch(() => {});
})();

// ── 处理收集 ──
async function handleCollect(params) {
  const result = await runCollection(params, (progress) => {
    chrome.runtime.sendMessage({ type: MSG.COLLECT_PROGRESS, ...progress });
  });
  chrome.runtime.sendMessage({
    type: MSG.JOBS_COLLECTED,
    jobs: result.jobs,
    clusters: result.clusters,
    jdSamples: result.jdSamples,
  });
  return result;
}

// ── 处理发送（按 jobIds 逐个调用 sendSingle）──
async function handleSend(jobIds) {
  const stateResp = await chrome.runtime.sendMessage({ type: MSG.GET_STATE });
  const { greetings, jobs } = stateResp.state;
  let sent = 0, failed = 0;
  for (const id of jobIds) {
    const job = jobs.find((j) => j.id === id);
    const category = job?.tags?.[0] || '其他';
    const greeting = greetings[category] || '';
    try {
      const result = await JobSender.sendSingle(greeting, id);
      if (result.success) sent++; else failed++;
      chrome.runtime.sendMessage({
        type: MSG.SEND_ITEM_RESULT,
        payload: { jobId: id, ...result },
      }).catch(() => {});
      chrome.runtime.sendMessage({
        type: MSG.SEND_PROGRESS,
        payload: { sent, failed, total: jobIds.length, current: id },
      }).catch(() => {});
      if (result.captchaDetected) break;
    } catch (e) {
      failed++;
      if (typeof ErrorLogger !== 'undefined') { ErrorLogger.logError(e.message, e.stack, 'handleSend'); }
      chrome.runtime.sendMessage({
        type: MSG.SEND_ITEM_RESULT,
        payload: { jobId: id, success: false, error: e.message },
      }).catch(() => {});
      chrome.runtime.sendMessage({
        type: MSG.SEND_PROGRESS,
        payload: { sent, failed, total: jobIds.length, current: id },
      }).catch(() => {});
    }
  }
  const result = { sent, total: jobIds.length, failed };
  chrome.runtime.sendMessage({ type: MSG.SEND_COMPLETE, ...result }).catch(() => {});
  return result;
}

// ── v5: 搜索页点"立即沟通"，提取HR信息 ──
async function handleStartChat(msg) {
  try {
    const result = await JobClicker.clickImmediateChat(msg.jobLink, msg.positionName, msg.companyName);
    return result;
  } catch (e) {
    if (typeof ErrorLogger !== 'undefined') { ErrorLogger.logError(e.message, e.stack, 'handleStartChat'); }
    return { success: false, error: e.message };
  }
}

// ── v5: 聊天页匹配对话 + 发送消息 ──
async function handleSendChat(msg) {
  try {
    // v6: hrName 为空时直接返回，禁止盲目发送
    if (!msg.hrName) {
      return { success: false, error: 'HR名称为空，无法匹配对话' };
    }

    // 先等对话列表容器渲染（异步 AJAX 挂载），否则 findChatConversation 查到 0 节点。
    var listContainer = await waitForElement('.user-list-content', 10000);
    if (!listContainer) {
      return { success: false, error: '对话列表容器未加载' };
    }

    var conversation = findChatConversation(msg.hrName, msg.hrCompany);
    if (!conversation) {
      // 轮询等待：每 500ms 查一次，最多 5s
      for (var retry = 0; retry < 10 && !conversation; retry++) {
        await new Promise(function(r) { setTimeout(r, 500); });
        conversation = findChatConversation(msg.hrName, msg.hrCompany);
      }
    }
    if (!conversation) {
      return { success: false, error: '未找到对话: ' + msg.hrName + ' / ' + (msg.hrCompany || '') };
    }
    conversation.click();
    await new Promise(function(r) { setTimeout(r, 2000); });

    const result = await JobSender.sendSingle(msg.greeting, msg.jobId);
    chrome.runtime.sendMessage({
      type: MSG.SEND_ITEM_RESULT,
      payload: { jobId: msg.jobId, ...result },
    }).catch(() => {});
    return result;
  } catch (e) {
    if (typeof ErrorLogger !== 'undefined') { ErrorLogger.logError(e.message, e.stack, 'handleSendChat'); }
    return { success: false, error: e.message };
  }
}

// ── v6: 搜索页批量提取 HR 信息 ──
function _csDbg(stage, info) {
  try { chrome.runtime.sendMessage({ type: 'CS_DBG', stage: stage, info: info || {} }).catch(function(){}); } catch (_) {}
}

async function handleBatchExtract(msg) {
  var queue = msg.queue || [];
  if (typeof JobCollector !== 'undefined') JobCollector.stopped = false;
  if (typeof JobSender !== 'undefined') JobSender.stopped = false; // 新一批发送开始：重置硬中止标志，杜绝上一轮 stop 残留致本批 bail 不发文/图
  _csDbg('batchExtract:start', { queueLen: queue.length, url: location.href });
  console.log('[即投] handleBatchExtract: 开始，队列长度=', queue.length);
  var results = [];
  var skipped = [];
  var captchaDetected = false;

  for (var i = 0; i < queue.length; i++) {
    if (typeof JobCollector !== 'undefined' && JobCollector.stopped) {
      _csDbg('batchExtract:stopped', { i: i });
      break;
    }
    var item = queue[i];
    _csDbg('batchExtract:itemStart', { i: i, jobId: item.jobId, jobLink: item.jobLink, positionName: item.positionName });
    var tStart = Date.now();
    try {
      // 单 item 15s 硬 timeout 防永挂
      var clickResult = await Promise.race([
        JobClicker.clickImmediateChat(item.jobLink, item.positionName, item.companyName, msg.hrActiveFilter),
        new Promise(function(_, rej) { setTimeout(function() { rej(new Error('clickImmediateChat 15s timeout')); }, 15000); })
      ]);
      _csDbg('batchExtract:itemDone', { i: i, ms: Date.now() - tStart, success: clickResult.success, error: clickResult.error, hrName: clickResult.hrName });
      if (clickResult.success && clickResult.hrName) {
        results.push({
          jobId: item.jobId,
          hrName: clickResult.hrName,
          hrCompany: clickResult.hrCompany,
          greeting: item.greeting,
          positionName: item.positionName,
          companyName: item.companyName,
          alreadyChatted: !!clickResult.alreadyChatted,
        });
      } else if (clickResult.skipped) {
        skipped.push({ jobId: item.jobId, activeDesc: clickResult.activeDesc });
      }
      // 检测验证码
      if (typeof detectCaptcha === 'function') {
        var captcha = detectCaptcha();
        if (captcha.detected) {
          _csDbg('batchExtract:captcha', { i: i });
          captchaDetected = true;
          chrome.runtime.sendMessage({ type: MSG.CAPTCHA_DETECTED }).catch(function(){});
          break;
        }
      }
    } catch (e) {
      _csDbg('batchExtract:itemError', { i: i, ms: Date.now() - tStart, msg: e.message });
      if (typeof ErrorLogger !== 'undefined') {
        ErrorLogger.logError(e.message, e.stack, 'handleBatchExtract item=' + i);
      }
    }

    chrome.runtime.sendMessage({
      type: MSG.EXTRACT_PROGRESS,
      done: i + 1,
      total: queue.length,
      extracted: results.length,
    }).catch(function(){});
  }

  _csDbg('batchExtract:complete', { resultsLen: results.length, captcha: captchaDetected, url: location.href });
  chrome.runtime.sendMessage({
    type: MSG.EXTRACT_COMPLETE,
    success: true,
    results: results,
    skipped: skipped,
    captchaDetected: captchaDetected,
  }).catch(function(){});
  return { success: true, results: results, skipped: skipped, captchaDetected: captchaDetected };
}

// ── v6: 聊天页 worker 激活，只找对话返回坐标（点击由 SW 通过 CDP 发真实鼠标事件）──
async function handleWorkerActivate(msg) {
  var job = msg.job || {};
  var jobId = job.jobId;
  var positionName = job.positionName;
  var companyName = job.companyName;
  // 同步诊断：worker tab 认领映射。每 zhipin tab 的 data-diag-sync 序列即该 worker 处理的岗位列表。
  _persistDiag('worker:claim', {
    jobId: jobId,
    positionName: positionName,
    companyName: companyName,
    hrName: job.hrName,
    hrCompany: job.hrCompany,
  });
  console.log('[即投] handleWorkerActivate: jobId=' + jobId + ' hrName=' + job.hrName + ' hrCompany=' + job.hrCompany);

  if (!job.hrName) {
    return { success: false, jobId: jobId, error: 'HR名称为空', positionName: positionName, companyName: companyName };
  }

  // 硬中止：停止后绝不进对话、不发起任何动作
  if (typeof JobSender !== 'undefined' && JobSender.stopped) {
    return { success: false, stopped: true, jobId: jobId, error: 'stopped', positionName: positionName, companyName: companyName };
  }

  // worker tab 后台打开 + /web/geek/chat 列表 Vue 异步 AJAX 挂载，进名字匹配 retry 前
  // 先等列表容器 .user-list-content 出现，否则 findChatConversation 查到 0 节点直接空。
  var listContainer = await waitForElement('.user-list-content', 10000);
  if (!listContainer) {
    return { success: false, jobId: jobId, error: '对话列表容器未加载', positionName: positionName, companyName: companyName };
  }

  var conversation = findChatConversation(job.hrName, job.hrCompany);
  for (var retry = 0; retry < 12 && !conversation; retry++) {
    await sleep(500);
    conversation = findChatConversation(job.hrName, job.hrCompany);
  }
  if (!conversation) {
    return { success: false, jobId: jobId, error: '未找到对话', positionName: positionName, companyName: companyName };
  }

  // 确保拿到可点击的元素（必须是 .friend-content，不能是 .friend-content-warp 或 li）
  // BOSS Vue 2 click handler 绑在 .friend-content 上，点外层不会触发
  var clickEl = conversation;
  if (conversation.tagName === 'LI') {
    clickEl = conversation.querySelector('.friend-content, [class*="friend-content"]') || conversation.querySelector('.friend-content-warp') || conversation;
  } else if (conversation.classList.contains('friend-content-warp')) {
    clickEl = conversation.querySelector('.friend-content') || conversation;
  }

  // 点击对话（不做"已选中"判断——class 可能不在当前元素上）
  if (typeof JobSender !== 'undefined' && JobSender.stopped) {
    return { success: false, stopped: true, jobId: jobId, error: 'stopped', positionName: positionName, companyName: companyName };
  }
  console.log('[即投] handleWorkerActivate: 点击对话 hrName=' + job.hrName + ' tagName=' + clickEl.tagName + ' class=' + clickEl.className);
  clickEl.click();

  // 等待对话加载完成：轮询 chat-input，与 sendText 使用完全一致的可见性检查，最长 10s
  var chatLoaded = false;
  var waited = 0;
  while (waited < 50) {
    await sleep(200);
    waited++;
    // 与 sendText 的 waitForElement 保持一致的 offsetParent 检查（修复固定定位容器内输入框不可见的问题）
    var input = document.querySelector(SELECTORS.chatDetail.chatInput);
    if (input && (input.offsetParent !== null || getComputedStyle(input).position === 'fixed')) {
      console.log('[即投] handleWorkerActivate: 对话加载完成，等待=' + (waited * 200) + 'ms');
      chatLoaded = true;
      break;
    }
    var msgs = document.querySelectorAll('.msg-content, .message, [class*="message"]');
    if (msgs.length > 0) {
      console.log('[即投] handleWorkerActivate: 对话加载完成（消息列表），等待=' + (waited * 200) + 'ms');
      chatLoaded = true;
      break;
    }
  }

  if (!chatLoaded) {
    console.warn('[即投] handleWorkerActivate: 点击后对话未加载，input可见=', !!document.querySelector('.chat-input'));
    return { success: false, jobId: jobId, error: '点击对话后未加载聊天详情', positionName: positionName, companyName: companyName };
  }

  // 进对话后可能弹「同HR多岗位（选之前岗位/新岗位）」「打招呼」等弹窗，挡住输入框 →
  // 不关掉 sendText 会卡住。stage2 发送与补发都经此函数，统一在这里关弹窗。
  // closeBlockingDialogs 多轮轮询（~2s），能接住延迟弹出的弹窗；持续不灭也不阻塞，
  // 让后续 sendText 去如实失败，而不是在这里死等。
  await closeBlockingDialogs(3);

  return {
    success: true,
    jobId: jobId
  };
}

// ── v6: 聊天页 worker 发送（在 CDP 点击后调用）──
async function handleWorkerSend(msg) {
  var job = msg.job || {};
  var jobId = job.jobId;
  console.log('[即投] handleWorkerSend: 开始发送，greeting长度=' + (job.greeting || '').length);
  try {
    // worker 阶段 fail-fast：文字 3s 图片 4s 各单次不重试，未确认即转补发队列。
    // 旧版 sendText 死等 8s + 重试 3 次 = ~28s/岗位 → 招呼语发 3 次（errorLog 实证 baseline=4）；
    // sendImage 同款 3 次重试。worker 阶段抢同账号 WS，重试纯浪费——补发兜底（单连接干净环境）。
    var sendResult = await JobSender.sendSingle(
      job.greeting, jobId,
      { timeoutMs: 4000, maxAttempts: 1 },  // imgOpts
      { timeoutMs: 3000, maxAttempts: 1 }   // textOpts
    );
    console.log('[即投] handleWorkerSend: sendSingle 结果', sendResult);
    return { success: true, jobId: jobId, positionName: job.positionName, companyName: job.companyName, ...sendResult };
  } catch (e) {
    return { success: false, jobId: jobId, error: e.message };
  }
}

// ── v6 补发：在全新沟通页里重进对话、核对服务器历史、缺啥补啥（单连接、安静期）──
async function handleWorkerRepair(msg) {
  var job = msg.job || {};
  var jobId = job.jobId;
  // 复用 activate 的导航逻辑：找到并进入该 HR 对话，等历史加载
  var act = await handleWorkerActivate(msg);
  if (!act || !act.success) {
    // 对话没建起来 → 补不了（属「未找到对话」独立 bug），如实回报
    return {
      complete: false, foundConv: false, jobId: jobId,
      error: (act && act.error) || '补发时未找到对话',
      positionName: job.positionName, companyName: job.companyName,
    };
  }
  // 等服务器历史 AJAX 渲染稳定再 hasTextInHistory/hasImageInHistory，否则 DOM 没渲染完
  // 误判 hadText:false → 重发招呼语（双发）。上轮 1000→500 过激进引入回归，本轮回退到 1500。
  await sleep(1500);
  try {
    // 补发阶段单连接干净环境无 WS 风暴：5s 单图超时 + 最多 2 次重试 + 600ms 重连间隔，比 worker 耐心
    // 但比 legacy 默认（15s×3）激进得多。补发还会先查服务器历史，已成功的图不会重发（天然防双发）。
    var r = await JobSender.repairSingle(
      job.greeting, jobId,
      { timeoutMs: 5000, maxAttempts: 2, retryDelayMs: 600 }, // imgOpts
      { timeoutMs: 5000, maxAttempts: 2, retryDelayMs: 600 }  // textOpts (跟 imgOpts 同保守值)
    );
    return {
      jobId: jobId, foundConv: true,
      positionName: job.positionName, companyName: job.companyName,
      ...r,
    };
  } catch (e) {
    return { complete: false, foundConv: true, jobId: jobId, error: e.message };
  }
}
