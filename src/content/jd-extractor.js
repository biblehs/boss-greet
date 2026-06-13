// ════════════════════════════════════════════════════════════
// BossGreet — JD 正文提取器
// 从搜索页右侧面板 / 详情页提取完整的岗位描述
// ════════════════════════════════════════════════════════════

const JDExtractor = {
  /**
   * 从搜索页右侧详情面板提取 JD（快速路径）
   * 点击岗位卡片后右侧面板展开，包含部分 JD 内容
   * @returns {{desc: string, tags: string[], hrName: string, hrCompany: string, complete: boolean} | null}
   */
  extractFromPanel() {
    // 提取 JD 正文
    const descEl = document.querySelector(SELECTORS.jobPanel.jobDesc);
    const desc = descEl ? descEl.textContent.trim() : '';

    // 提取标签
    const tagEls = document.querySelectorAll(SELECTORS.jobPanel.jobTags);
    const tags = [...tagEls].map(el => el.textContent.trim()).filter(Boolean);

    // 提取 HR 信息
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

    // HR 活跃状态
    const onlineEl = bossInfo?.querySelector('.boss-online-tag');
    const activeEl = bossInfo?.querySelector('.boss-active-time');
    const activity = this._parseActivity(
      onlineEl?.textContent || '',
      activeEl?.textContent || ''
    );

    return {
      desc,
      tags,
      hrName,
      hrCompany,
      activity,
      complete: desc.length >= CONFIG.JD_MIN_LENGTH,
    };
  },

  /**
   * 从详情页提取完整 JD
   * @returns {{fullDesc: string, sections: Object}}
   */
  extractFromDetailPage() {
    const descEl = document.querySelector(SELECTORS.jobDetail.jobSecText)
      || document.querySelector(SELECTORS.jobDetail.container);
    const fullDesc = descEl ? descEl.textContent.trim() : '';
    const sections = this._parseSections(fullDesc);

    // 提取页面上的其他信息
    const jobName = document.querySelector(SELECTORS.jobDetail.jobName)?.textContent.trim() || '';
    const company = document.querySelector(SELECTORS.jobDetail.companyName)?.textContent.trim() || '';
    const salary = document.querySelector(SELECTORS.jobDetail.salary)?.textContent.trim() || '';
    const tagEls = document.querySelectorAll(SELECTORS.jobDetail.tags);
    const tags = [...tagEls].map(el => el.textContent.trim()).filter(Boolean);

    return { fullDesc, sections, jobName, company, salary, tags };
  },

  /**
   * 解析 JD 结构化段落
   * BOSS 的 JD 通常是一大段文本，包含职责、要求等
   */
  _parseSections(text) {
    if (!text) return {};
    const sections = {};
    const lines = text.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
    let current = 'overview';

    for (const line of lines) {
      // 识别段落标题
      if (/^(岗位职责|工作内容|工作职责|职责描述|你将负责)[：:]/.test(line)) {
        current = 'responsibilities';
        const afterColon = line.replace(/^.{2,8}[：:]\s*/, '');
        if (afterColon) {
          if (!sections[current]) sections[current] = [];
          sections[current].push(afterColon);
        }
        continue;
      }
      if (/^(任职要求|岗位要求|职位要求|我们希望你|必备条件|基本要求)[：:]/.test(line)) {
        current = 'requirements';
        const afterColon = line.replace(/^.{2,8}[：:]\s*/, '');
        if (afterColon) {
          if (!sections[current]) sections[current] = [];
          sections[current].push(afterColon);
        }
        continue;
      }
      if (/^(加分项|优先条件|优先考虑|加分条件)[：:]/.test(line)) {
        current = 'bonus';
        const afterColon = line.replace(/^.{2,8}[：:]\s*/, '');
        if (afterColon) {
          if (!sections[current]) sections[current] = [];
          sections[current].push(afterColon);
        }
        continue;
      }
      if (/^(福利待遇|我们提供|薪资福利|公司福利)[：:]/.test(line)) {
        current = 'benefits';
        const afterColon = line.replace(/^.{2,8}[：:]\s*/, '');
        if (afterColon) {
          if (!sections[current]) sections[current] = [];
          sections[current].push(afterColon);
        }
        continue;
      }

      if (!sections[current]) sections[current] = [];
      sections[current].push(line);
    }
    return sections;
  },

  /**
   * 解析 HR 活跃状态
   */
  _parseActivity(onlineText, activeText) {
    if (onlineText && /在线/.test(onlineText)) return { online: true, activeDays: 0, desc: '在线' };
    const t = (activeText || '').trim();
    if (!t) return { online: false, activeDays: null, desc: '' };
    if (/刚刚|今日|今天/.test(t)) return { online: false, activeDays: 1, desc: t };
    const dm = t.match(/(\d+)\s*日内/);
    if (dm) return { online: false, activeDays: parseInt(dm[1]), desc: t };
    if (/本周/.test(t)) return { online: false, activeDays: 7, desc: t };
    const wm = t.match(/(\d+)\s*周内/);
    if (wm) return { online: false, activeDays: parseInt(wm[1]) * 7, desc: t };
    if (/本月/.test(t)) return { online: false, activeDays: 30, desc: t };
    const mm = t.match(/(\d+)\s*月内/);
    if (mm) return { online: false, activeDays: parseInt(mm[1]) * 30, desc: t };
    return { online: false, activeDays: null, desc: t };
  },

  /**
   * 从 JD 正文中提取关键词（用于匹配简历）
   */
  extractKeywords(jdText) {
    if (!jdText) return [];
    // 技术关键词模式
    const patterns = [
      /[A-Za-z][A-Za-z0-9.#+]+(?:\s*\d+(?:\.\d+)?(?:\s*年)?(?:以上经验)?)/g,  // "React 3年"
      /(?:熟悉|精通|掌握|了解|熟练|擅长|具备)\s*([^，。,.]{2,30})/g,
      /(?:技术栈|要求|技能)[：:]\s*([^。]{5,100})/g,
    ];
    const keywords = new Set();
    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(jdText)) !== null) {
        keywords.add(match[1] || match[0]);
      }
    }
    // 提取括号里的英文技术名词
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
