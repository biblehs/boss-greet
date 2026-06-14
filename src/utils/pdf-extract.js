// ════════════════════════════════════════════════════════════
// BossGreet — PDF Resume Text Extraction
// Runs in Service Worker using OffscreenCanvas + PDF.js
// ════════════════════════════════════════════════════════════

/**
 * Extract plain text from a PDF file's ArrayBuffer
 * Note: cannot use importScripts to load ESM in SW, needs offscreen document
 * Provides a fallback: uses chrome.offscreen or fetch + decode
 */
async function extractPdfText(arrayBuffer) {
  // Method 1: Try using PDF.js if loaded
  if (typeof pdfjsLib !== 'undefined') {
    return extractWithPdfJs(arrayBuffer);
  }

  // Method 2: Simple text extraction (no PDF.js dependency, works for plain text PDFs)
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
 * Simple text extraction fallback — extracts readable text directly from the PDF binary stream
 * Works for plain text PDFs, does not work for scanned documents
 */
function extractSimpleText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let text = '';
  let inStream = false;

  // PDF text is typically between stream...endstream, marked by BT/ET text blocks
  // Simplified extraction: find all printable ASCII sequences
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = decoder.decode(bytes);

  // Extract text from Tj/TJ operators
  const tjPattern = /\(([^)]{2,})\)\s*Tj/g;
  const tjArrayPattern = /\[(.*?)\]\s*TJ/g;
  let match;
  const texts = [];

  while ((match = tjPattern.exec(raw)) !== null) {
    texts.push(match[1]);
  }
  while ((match = tjArrayPattern.exec(raw)) !== null) {
    // Extract strings inside parentheses from the TJ array
    const inner = match[1];
    const strMatches = inner.match(/\(([^)]*)\)/g);
    if (strMatches) {
      texts.push(strMatches.map(s => s.slice(1, -1)).join(''));
    }
  }

  if (texts.length > 0) {
    return texts.join('\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
  }

  // Final fallback: extract consecutive printable character segments
  const printable = raw.replace(/[^\x20-\x7E一-鿿　-〿＀-￯\n\r]/g, ' ');
  const segments = printable.split(/\s{3,}/).filter(s => s.trim().length > 10);
  return segments.join('\n').trim();
}
