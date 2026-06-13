// ════════════════════════════════════════════════════════════
// BossGreet — PDF 简历文本提取
// 在 Service Worker 中运行，使用 OffscreenCanvas + PDF.js
// ════════════════════════════════════════════════════════════

/**
 * 从 PDF 文件的 ArrayBuffer 提取纯文本
 * 注意：在 SW 中不能用 importScripts 加载 ESM，需要通过 offscreen document
 * 这里提供一个 fallback：直接用 chrome.offscreen 或 fetch + 解码
 */
async function extractPdfText(arrayBuffer) {
  // 方案1：尝试用 PDF.js（如果已加载）
  if (typeof pdfjsLib !== 'undefined') {
    return extractWithPdfJs(arrayBuffer);
  }

  // 方案2：简单文本提取（不依赖 PDF.js，对纯文本 PDF 有效）
  return extractSimpleText(arrayBuffer);
}

async function extractWithPdfJs(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText.trim();
}

/**
 * 简单文本提取 fallback — 直接从 PDF 二进制流中提取可读文本
 * 对纯文本 PDF 有效，对扫描件无效
 */
function extractSimpleText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let text = '';
  let inStream = false;

  // PDF 文本通常在 stream...endstream 之间，用 BT/ET 标记文本块
  // 简化提取：找所有可打印 ASCII 序列
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(bytes);

  // 提取 Tj/TJ 操作符中的文本
  const tjPattern = /\(([^)]{2,})\)\s*Tj/g;
  const tjArrayPattern = /\[(.*?)\]\s*TJ/g;
  let match;
  const texts = [];

  while ((match = tjPattern.exec(raw)) !== null) {
    texts.push(match[1]);
  }
  while ((match = tjArrayPattern.exec(raw)) !== null) {
    // TJ 数组中提取括号内的字符串
    const inner = match[1];
    const strMatches = inner.match(/\(([^)]*)\)/g);
    if (strMatches) {
      texts.push(strMatches.map(s => s.slice(1, -1)).join(''));
    }
  }

  if (texts.length > 0) {
    return texts.join('\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
  }

  // 最终 fallback：提取连续可打印字符段
  const printable = raw.replace(/[^\x20-\x7E一-鿿　-〿＀-￯\n\r]/g, ' ');
  const segments = printable.split(/\s{3,}/).filter(s => s.trim().length > 10);
  return segments.join('\n').trim();
}
