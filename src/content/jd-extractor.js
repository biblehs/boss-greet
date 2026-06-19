// ════════════════════════════════════════════════════════════
// BossGreet — JD 提取器
// 从 BOSS 直聘右侧面板提取职位描述、HR 信息、关键词
// ════════════════════════════════════════════════════════════

const JDExtractor = {
  /**
   * 从右侧面板提取 JD 和 HR 信息
   * @returns {Object} { desc, hrName, hrCompany, activity, keywords, tags }
   */
  extractFromPanel() {
    const result = {
      desc: '',
      hrName: '',
      hrCompany: '',
      activity: null,
      keywords: [],
      tags: [],
      complete: false,
    };

    try {
      // 提取职位描述
      const descEl = document.querySelector('.job-sec-text, .job-detail .text, .job-detail-box .text');
      if (descEl) {
        result.desc = descEl.textContent.trim();
      }

      // 提取 HR 信息
      const bossInfo = document.querySelector('.job-boss-info, .boss-info');
      if (bossInfo) {
        const nameEl = bossInfo.querySelector('.name, h2.name');
        if (nameEl) result.hrName = nameEl.textContent.trim();

        const companyEl = bossInfo.querySelector('.boss-info-attr, .company-name');
        if (companyEl) result.hrCompany = companyEl.textContent.trim();
      }

      // 提取 HR 活跃状态
      const activeEl = document.querySelector('.boss-active-time, .boss-online-tag');
      if (activeEl) {
        const text = activeEl.textContent.trim();
        result.activity = this.parseActivity(text);
      }

      // 提取标签
      const tagEls = document.querySelectorAll('.job-tags span, .tag-list li');
      tagEls.forEach(el => {
        const tag = el.textContent.trim();
        if (tag) result.tags.push(tag);
      });

      // 提取关键词
      if (result.desc) {
        result.keywords = this.extractKeywords(result.desc);
      }

      result.complete = result.desc.length > 50;
    } catch (e) {
      console.warn('[BossGreet] JD extraction error:', e.message);
    }

    return result;
  },

  /**
   * 解析 HR 活跃状态
   */
  parseActivity(text) {
    if (!text) return { online: false, activeDays: null, desc: '' };
    if (/在线/.test(text)) return { online: true, activeDays: 0, desc: '在线' };
    if (/刚刚|今日|今天/.test(text)) return { online: false, activeDays: 1, desc: text };
    const dm = text.match(/(\d+)\s*日内/);
    if (dm) return { online: false, activeDays: parseInt(dm[1]), desc: text };
    if (/本周/.test(text)) return { online: false, activeDays: 7, desc: text };
    const wm = text.match(/(\d+)\s*周内/);
    if (wm) return { online: false, activeDays: parseInt(wm[1]) * 7, desc: text };
    if (/本月/.test(text)) return { online: false, activeDays: 30, desc: text };
    const mm = text.match(/(\d+)\s*月内/);
    if (mm) return { online: false, activeDays: parseInt(mm[1]) * 30, desc: text };
    if (/半年内|近半年/.test(text)) return { online: false, activeDays: 180, desc: text };
    if (/半年前|年前|更早/.test(text)) return { online: false, activeDays: 999, desc: text };
    return { online: false, activeDays: null, desc: text };
  },

  /**
   * 从 JD 文本中提取关键词
   */
  extractKeywords(desc) {
    if (!desc) return [];
    const keywords = new Set();

    // 技术栈关键词
    const techPatterns = [
      /React|Vue|Angular|Svelte|Next\.js|Nuxt/i,
      /TypeScript|JavaScript|Python|Java|Go|Rust|C\+\+/i,
      /Node\.js|Express|Koa|Nest|Django|Flask|Spring/i,
      /MySQL|PostgreSQL|MongoDB|Redis|Elasticsearch/i,
      /Docker|K8s|Kubernetes|AWS|Azure|GCP/i,
      /Git|CI\/CD|Jenkins|GitHub Actions/i,
      /Webpack|Vite|Rollup|Babel|ESLint/i,
      /HTML|CSS|SASS|LESS|Tailwind/i,
      /REST|GraphQL|gRPC|WebSocket/i,
      /微服务|分布式|高并发|高可用/i,
      /性能优化|架构设计|系统设计/i,
      /机器学习|深度学习|NLP|CV|大模型/i,
    ];

    techPatterns.forEach(pattern => {
      const matches = desc.match(new RegExp(pattern.source, 'gi'));
      if (matches) matches.forEach(m => keywords.add(m));
    });

    // 经验要求
    const expMatch = desc.match(/(\d+)[\s-]*年[以上]*[经验|工作]/);
    if (expMatch) keywords.add(expMatch[0]);

    // 学历要求
    const eduMatch = desc.match(/本科|硕士|博士|大专/);
    if (eduMatch) keywords.add(eduMatch[0]);

    return Array.from(keywords).slice(0, 15);
  },
};
