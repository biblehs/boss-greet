// ════════════════════════════════════════════════════════════
// BossGreet — Multi-Model AI Abstraction Layer
// ════════════════════════════════════════════════════════════

const AIProvider = {
  /**
   * Call AI API (unified interface)
   * @param {string} provider - 'qwen' | 'mimo' | 'openai' | 'claude'
   * @param {string} apiKey
   * @param {string} model
   * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
   * @param {Object} opts - {maxTokens, temperature, timeoutMs}
   * @returns {Promise<string>} AI response text
   */
  async call(provider, apiKey, model, messages, opts = {}) {
    const p = AI_PROVIDERS[provider];
    if (!p) throw new Error('Unsupported provider: ' + provider);
    apiKey = (apiKey || '').trim();
    if (!apiKey) throw new Error('Please configure your API Key first');

    const timeoutMs = opts.timeoutMs || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = p.getEndpoint ? p.getEndpoint(apiKey) : p.endpoint;
      const resp = await fetch(url, {
        method: 'POST',
        headers: p.headers(apiKey),
        body: JSON.stringify(p.buildBody(model || p.defaultModel, messages, opts)),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API Error ${resp.status}: ${errText.substring(0, 200)}`);
      }

      const data = await resp.json();
      return p.parseContent(data);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out (${timeoutMs / 1000}s), please check your network`);
      }
      throw err;
    }
  },

  /**
   * Test API connectivity
   */
  async test(provider, apiKey, model) {
    return this.call(provider, apiKey, model, [
      { role: 'user', content: 'Hello, please reply "Connection successful"' },
    ], { maxTokens: 20, timeoutMs: 10000 });
  },
};
