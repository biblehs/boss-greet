// ════════════════════════════════════════════════════════════
// BossGreet — Job Description Extractor
// Extracts full JD text from search panel / detail pages
// ════════════════════════════════════════════════════════════

const JDExtractor = {
  /**
   * Extract JD from the right-side panel on search page (fast path)
   * @returns {{desc: string, tags: string[], hrName: string, hrCompany: string, activity: Object, complete: boolean} | null}
   */
  extractFromPanel() {
    const descEl = document.querySelector(SELECTORS.jobPanel.jobDesc);
    const desc = descEl ? descEl.textContent.trim() : '';

    const tagEls = document.querySelectorAll(SELECTORS.jobPanel.jobTags);
    const tags = [...tagEls].map(el => el.textContent.trim()).filter(Boolean);

    const bossInfo = document.querySelector(SELECTORS.jobPanel.bossInfo);
    let hrName = '', hrCompany = '';
    if (bossInfo) {
      const nameEl = bossInfo.querySelector('h2.name, .name');
      if (nameEl) {
        for (const node of nameEl.childNodes) {
          if (node.nodeType === 3) hrName += node.nodeValue;
          else if (node.nodeType === 1 && node.tagName !== 'I') break;
        }
        hrName = hrName.trim();
      }
      const attrEl = bossInfo.querySelector('.boss-info-attr');
      if (attrEl) hrCompany = (attrEl.textContent.trim().split(' · ')[0] || '').trim();
    }

    const onlineEl = bossInfo?.querySelector('.boss-online-tag');
    const activeEl = bossInfo?.querySelector('.boss-active-time');
    const activity = this._parseActivity(
      onlineEl?.textContent || '',
      activeEl?.textContent || ''
    );

    return {
      desc, tags, hrName, hrCompany, activity,
      complete: desc.length >= CONFIG.JD_MIN_LENGTH,
    };
  },

  /**
   * Extract full JD from detail page
   * @returns {{fullDesc: string, sections: Object}}
   */
  extractFromDetailPage() {
    const descEl = document.querySelector(SELECTORS.jobDetail.jobSecText)
      || document.querySelector(SELECTORS.jobDetail.container);
    const fullDesc = descEl ? descEl.textContent.trim() : '';
    const sections = this._parseSections(fullDesc);

    const jobName = document.querySelector(SELECTORS.jobDetail.jobName)?.textContent.trim() || '';
    const company = document.querySelector(SELECTORS.jobDetail.companyName)?.textContent.trim() || '';
    const salary = document.querySelector(SELECTORS.jobDetail.salary)?.textContent.trim() || '';
    const tagEls = document.querySelectorAll(SELECTORS.jobDetail.tags);
    const tags = [...tagEls].map(el => el.textContent.trim()).filter(Boolean);

    return { fullDesc, sections, jobName, company, salary, tags };
  },

  /**
   * Parse JD into structured sections
   */
  _parseSections(text) {
    if (!text) return {};
    const sections = {};
    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
    let current = 'overview';

    const sectionPatterns = [
      { pattern: /^(Responsibilities|Key Responsibilities|What You'll Do|Role Overview|Your Impact)[：:]/i, key: 'responsibilities' },
      { pattern: /^(Requirements|Qualifications|What We're Looking For|Must Have|Basic Requirements)[：:]/i, key: 'requirements' },
      { pattern: /^(Nice to Have|Bonus|Preferred|Preferred Qualifications)[：:]/i, key: 'bonus' },
      { pattern: /^(Benefits|Perks|What We Offer|Compensation)[：:]/i, key: 'benefits' },
      { pattern: /^(岗位职责|工作内容|工作职责|职责描述|你将负责)[：:]/, key: 'responsibilities' },
      { pattern: /^(任职要求|岗位要求|职位要求|我们希望你|必备条件|基本要求)[：:]/, key: 'requirements' },
      { pattern: /^(加分项|优先条件|优先考虑|加分条件)[：:]/, key: 'bonus' },
      { pattern: /^(福利待遇|我们提供|薪资福利|公司福利)[：:]/, key: 'benefits' },
    ];

    for (const line of lines) {
      let matched = false;
      for (const sp of sectionPatterns) {
        if (sp.pattern.test(line)) {
          current = sp.key;
          const afterColon = line.replace(/^.{2,20}[：:]\s*/, '');
          if (afterColon) {
            if (!sections[current]) sections[current] = [];
            sections[current].push(afterColon);
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (!sections[current]) sections[current] = [];
        sections[current].push(line);
      }
    }
    return sections;
  },

  /**
   * Parse recruiter activity status
   */
  _parseActivity(onlineText, activeText) {
    if (onlineText && /online|在线/i.test(onlineText)) return { online: true, activeDays: 0, desc: 'Online' };
    const t = (activeText || '').trim();
    if (!t) return { online: false, activeDays: null, desc: '' };
    if (/just now|today|今日|今天/i.test(t)) return { online: false, activeDays: 1, desc: t };
    const dm = t.match(/(\d+)\s*days?\s*ago|(\d+)\s*日内/);
    if (dm) return { online: false, activeDays: parseInt(dm[1] || dm[2]), desc: t };
    if (/this week|本周/i.test(t)) return { online: false, activeDays: 7, desc: t };
    const wm = t.match(/(\d+)\s*weeks?\s*ago|(\d+)\s*周内/);
    if (wm) return { online: false, activeDays: parseInt(wm[1] || wm[2]) * 7, desc: t };
    if (/this month|本月/i.test(t)) return { online: false, activeDays: 30, desc: t };
    const mm = t.match(/(\d+)\s*months?\s*ago|(\d+)\s*月内/);
    if (mm) return { online: false, activeDays: parseInt(mm[1] || mm[2]) * 30, desc: t };
    return { online: false, activeDays: null, desc: t };
  },

  /**
   * Extract keywords from JD text for resume matching
   */
  extractKeywords(jdText) {
    if (!jdText) return [];
    const patterns = [
      /[A-Za-z][A-Za-z0-9.#+]+(?:\s*\d+(?:\.\d+)?(?:\s*y(?:ears?)?)?(?:\+)?(?:\s*exp(?:erience)?)?)/gi,
      /(?:familiar with|proficient in|experience (?:with|in)|knowledge of|skilled in|expertise in)\s+([^.,]{2,40})/gi,
      /(?:熟悉|精通|掌握|了解|熟练|擅长|具备)\s*([^，。,.]{2,30})/g,
      /(?:tech stack|skills|requirements)[：:]\s*([^。.]{5,100})/gi,
    ];
    const keywords = new Set();
    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(jdText)) !== null) {
        keywords.add(match[1] || match[0]);
      }
    }
    const techMatch = jdText.match(/[一-鿿]+[（(]([A-Za-z][A-Za-z0-9.#+]+)[）)]/g);
    if (techMatch) {
      techMatch.forEach(m => {
        const inner = m.match(/[（(]([A-Za-z][A-Za-z0-9.#+]+)[）)]/);
        if (inner) keywords.add(inner[1]);
      });
    }
    return [...keywords].slice(0, 20);
  },
};
