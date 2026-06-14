// BossGreet — Page A event bindings (Settings)
function bindEventsA() {
  // PDF resume upload
  $('#resumePdfInput')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      // Extract text with PDF.js in popup (via offscreen or direct parsing)
      const text = await extractPdfInPopup(arrayBuffer);
      if (text) {
        await sendMessage({ type: 'EXTRACT_RESUME', data: text, format: 'text' });
        updateResumeStatus();
        showToast('PDF resume parsed successfully', 2000);
      } else {
        showToast('PDF parsing failed, please paste text manually');
      }
    } catch (err) {
      showToast('PDF parsing error: ' + err.message);
    }
    e.target.value = '';
  });

  // Image resume upload
  $('#resumeImgInput')?.addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const images = [];
    for (const file of files.slice(0, 5)) {
      const dataUrl = await readFileAsDataUrl(file);
      const bytes = dataUrlToBytes(dataUrl);
      images.push({ name: file.name, type: file.type, data: bytes, id: Date.now() + '_' + Math.random().toString(36).slice(2, 6), thumb: dataUrl, fullSrc: dataUrl });
    }
    // Merge with existing images
    const { 'ui:resumeImages': existing = [] } = await new Promise(r => chrome.storage.local.get('ui:resumeImages', r));
    const merged = [...existing, ...images].slice(0, 5);
    chrome.storage.local.set({ 'ui:resumeImages': merged });
    updateResumeStatus();
    showToast(`${images.length} image(s) uploaded`, 2000);
    e.target.value = '';
  });

  // Manual paste resume text
  $('#saveResumeText')?.addEventListener('click', async () => {
    const text = $('#resumeTextInput').value.trim();
    if (!text) { showToast('Please enter resume text'); return; }
    await sendMessage({ type: 'EXTRACT_RESUME', data: text, format: 'text' });
    updateResumeStatus();
    showToast('Resume text saved', 2000);
  });

  // Save API configuration
  $('#saveApiConfig')?.addEventListener('click', async () => {
    const config = {
      provider: $('#aiProvider').value,
      apiKey: $('#apiKey').value.trim(),
      model: $('#aiModel').value.trim(),
    };
    if (!config.apiKey) { showToast('Please enter an API Key'); return; }
    await sendMessage({ type: 'SAVE_API_CONFIG', config });
    PopupState.apiConfig = config;
    showToast('Settings saved', 2000);
  });

  // Test API connection
  $('#testApi')?.addEventListener('click', async () => {
    const config = {
      provider: $('#aiProvider').value,
      apiKey: $('#apiKey').value.trim(),
      model: $('#aiModel').value.trim(),
    };
    if (!config.apiKey) { showToast('Please enter an API Key first'); return; }
    const resultEl = $('#api-test-result');
    resultEl.textContent = 'Testing...';
    resultEl.style.color = '';
    try {
      const resp = await sendMessage({ type: 'TEST_GREETING', config });
      if (resp?.success) {
        resultEl.textContent = 'Connected! Sample output: ' + (resp.result || '').slice(0, 80) + '...';
        resultEl.style.color = '#2ecc71';
      } else {
        resultEl.textContent = 'Failed: ' + (resp?.error || 'Unknown error');
        resultEl.style.color = '#e74c3c';
      }
    } catch (err) {
      resultEl.textContent = 'Error: ' + err.message;
      resultEl.style.color = '#e74c3c';
    }
  });

  // Filter changes -> auto-save
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

// PDF parsing (runs in popup)
async function extractPdfInPopup(arrayBuffer) {
  try {
    // Try using PDF.js if available
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

  // Fallback: simple text extraction
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
