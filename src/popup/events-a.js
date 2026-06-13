// BossGreet — A 页事件绑定（配置页）
function bindEventsA() {
  // ── PDF 简历上传 ──
  $('#resumePdfInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      // 用 popup 内的 PDF.js 提取文本（通过 offscreen 或直接解析）
      const text = await extractPdfInPopup(arrayBuffer);
      if (text) {
        await sendMessage({ type: 'EXTRACT_RESUME', data: text, type: 'text' });
        updateResumeStatus();
        showToast('PDF 简历解析成功', 2000);
      } else {
        showToast('PDF 解析失败，请手动粘贴文本');
      }
    } catch (err) {
      showToast('PDF 解析错误: ' + err.message);
    }
    e.target.value = '';
  });

  // ── 图片简历上传 ──
  $('#resumeImgInput')?.addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const images = [];
    for (const file of files.slice(0, 5)) {
      const dataUrl = await readFileAsDataUrl(file);
      const bytes = dataUrlToBytes(dataUrl);
      images.push({ name: file.name, type: file.type, data: bytes, id: Date.now() + '_' + Math.random().toString(36).slice(2, 6), thumb: dataUrl, fullSrc: dataUrl });
    }
    // 合并到已有图片
    const { 'ui:resumeImages': existing = [] } = await new Promise(r => chrome.storage.local.get('ui:resumeImages', r));
    const merged = [...existing, ...images].slice(0, 5);
    chrome.storage.local.set({ 'ui:resumeImages': merged });
    updateResumeStatus();
    showToast(`已上传 ${images.length} 张图片`, 2000);
    e.target.value = '';
  });

  // ── 手动粘贴简历文本 ──
  $('#saveResumeText')?.addEventListener('click', async () => {
    const text = $('#resumeTextInput').value.trim();
    if (!text) { showToast('请输入简历文本'); return; }
    await sendMessage({ type: 'EXTRACT_RESUME', data: text, type: 'text' });
    updateResumeStatus();
    showToast('简历文本已保存', 2000);
  });

  // ── 保存 API 配置 ──
  $('#saveApiConfig')?.addEventListener('click', async () => {
    const config = {
      provider: $('#aiProvider').value,
      apiKey: $('#apiKey').value.trim(),
      model: $('#aiModel').value.trim(),
    };
    if (!config.apiKey) { showToast('请输入 API Key'); return; }
    await sendMessage({ type: 'SAVE_API_CONFIG', config });
    PopupState.apiConfig = config;
    showToast('配置已保存', 2000);
  });

  // ── 测试 API 连接 ──
  $('#testApi')?.addEventListener('click', async () => {
    const config = {
      provider: $('#aiProvider').value,
      apiKey: $('#apiKey').value.trim(),
      model: $('#aiModel').value.trim(),
    };
    if (!config.apiKey) { showToast('请先输入 API Key'); return; }
    const resultEl = $('#api-test-result');
    resultEl.textContent = '测试中...';
    resultEl.style.color = '';
    try {
      const resp = await sendMessage({ type: 'TEST_GREETING', config });
      if (resp?.success) {
        resultEl.textContent = '连接成功！示例输出: ' + (resp.result || '').slice(0, 80) + '...';
        resultEl.style.color = '#2ecc71';
      } else {
        resultEl.textContent = '失败: ' + (resp?.error || '未知错误');
        resultEl.style.color = '#e74c3c';
      }
    } catch (err) {
      resultEl.textContent = '错误: ' + err.message;
      resultEl.style.color = '#e74c3c';
    }
  });

  // ── 筛选条件变更 → 自动保存 ──
  ['#citySelect', '#searchKeyword', '#experienceSelect', '#hrActiveFilter'].forEach(sel => {
    $(sel)?.addEventListener('change', () => {
      PopupState.filterState.city = $('#citySelect').value;
      PopupState.filterState.keyword = $('#searchKeyword').value;
      PopupState.filterState.experience = $('#experienceSelect').value;
      PopupState.filterState.hrActiveFilter = $('#hrActiveFilter').value;
      PopupState.saveFilter();
    });
  });
}

// ── PDF 解析（popup 中运行）──
async function extractPdfInPopup(arrayBuffer) {
  try {
    // 尝试用 PDF.js（如果可用）
    if (typeof pdfjsLib !== 'undefined') {
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      return text.trim();
    }
  } catch (_) {}

  // fallback: 简单文本提取
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(new Uint8Array(arrayBuffer));
  const texts = [];
  let match;
  const tjPattern = /\(([^)]{2,})\)\s*Tj/g;
  while ((match = tjPattern.exec(raw)) !== null) texts.push(match[1]);
  const tjArrayPattern = /\[(.*?)\]\s*TJ/g;
  while ((match = tjArrayPattern.exec(raw)) !== null) {
    const inner = match[1];
    const strMatches = inner.match(/\(([^)]*)\)/g);
    if (strMatches) texts.push(strMatches.map(s => s.slice(1, -1)).join(''));
  }
  return texts.length > 0 ? texts.join('\n').trim() : '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
