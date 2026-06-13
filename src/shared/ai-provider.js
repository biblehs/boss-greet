// ════════════════════════════════════════════════════════════
// BossGreet — 多模型 AI 抽象层
// ════════════════════════════════════════════════════════════

const AIProvider = {
  /**
   * 调用 AI API（统一接口）
   * @param {string} provider - 'qwen' | 'openai' | 'claude'
   * @param {string} apiKey
   * @param {string} model
   * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
   * @param {Object} opts - {maxTokens, temperature, timeoutMs}
   * @returns {Promise<string>} AI 返回的文本
   */
  async call(provider, apiKey, model, messages, opts = {}) {
    const p = AI_PROVIDERS[provider];
    if (!p) throw new Error('不支持的 AI 提供商: ' + provider);
    if (!apiKey) throw new Error('请先配置 API Key');

    const timeoutMs = opts.timeoutMs || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(p.endpoint, {
        method: 'POST',
        headers: p.headers(apiKey),
        body: JSON.stringify(p.buildBody(model || p.defaultModel, messages, opts)),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API 错误 ${resp.status}: ${errText.substring(0, 200)}`);
      }

      const data = await resp.json();
      return p.parseContent(data);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`请求超时（${timeoutMs / 1000}秒），请检查网络`);
      }
      throw err;
    }
  },

  /**
   * 测试 API 连通性
   */
  async test(provider, apiKey, model) {
    return this.call(provider, apiKey, model, [
      { role: 'user', content: '你好，请回复"连接成功"' },
    ], { maxTokens: 20, timeoutMs: 10000 });
  },
};
