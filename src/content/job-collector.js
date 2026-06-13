// ════════════════════════════════════════════════════════════
// BossGreet — 岗位采集模块
// DOM 解析 + 无限滚动 + JD 提取
// ════════════════════════════════════════════════════════════

const JobCollector = {
  collected: new Map(), // id → job
  stopped: false,
  scrollDelay: 1500,
  maxPages: 20,

  /**
   * 解析单个岗位卡片
   */
  parseCard(card) {
    const nameEl = card.querySelector(SELECTORS.jobs.jobName);
    const salaryEl = card.querySelector(SELECTORS.jobs.jobSalary);
    const companyEl = card.querySelector(SELECTORS.jobs.company);
    const tags = [...card.querySelectorAll(SELECTORS.jobs.tagList)].map(t => t.textContent.trim());
    const link = card.querySelector('a')?.href || '';
    const id = link.match(/job_detail\/([^.]+)\.html/)?.[1] || link;

    return {
      id,
      jobId: id,
      name: nameEl?.textContent.trim() || '',
      salary: decodeSalary(salaryEl?.textContent || ''),
      company: companyEl?.textContent.trim() || '',
      tags,
      link,
      jobLink: link,
      jd: null, // 稍后由 JD 提取填充
    };
  },

  /**
   * 解析当前页所有卡片
   */
  parseCurrentPage() {
    const cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    let newCount = 0;
    cards.forEach(card => {
      const job = this.parseCard(card);
      if (job.id && !this.collected.has(job.id)) {
        this.collected.set(job.id, job);
        newCount++;
      }
    });
    return newCount;
  },

  /**
   * 无限滚动加载
   */
  async scrollToLoad(progressCb) {
    this.stopped = false;

    // 等首批卡片渲染
    const cardSelector = SELECTORS.jobs.jobCard;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 10000) {
      if (document.querySelectorAll(cardSelector).length > 0) break;
      await sleep(500);
    }

    let page = 0;
    let prevCount = 0;

    while (!this.stopped && page < this.maxPages) {
      this.parseCurrentPage();
      const currentCount = this.collected.size;
      if (currentCount !== prevCount) {
        progressCb({ collected: currentCount });
        prevCount = currentCount;
      }

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(this.scrollDelay);

      const newCards = document.querySelectorAll(SELECTORS.jobs.jobCard);
      if (newCards.length <= currentCount + 1) {
        await sleep(1000);
        this.parseCurrentPage();
        if (this.collected.size === currentCount) break;
      }
      page++;
    }

    this.parseCurrentPage();
  },

  /**
   * 逐个点击卡片提取 JD（搜索页右侧面板）
   * 这是核心改动：即投不提取 JD，我们逐个提取
   */
  async extractJDsFromPanel(progressCb) {
    const jobs = [...this.collected.values()];
    let extracted = 0;

    for (let i = 0; i < jobs.length; i++) {
      if (this.stopped) break;
      const job = jobs[i];

      try {
        // 找到该岗位的卡片并点击
        const card = this._findCardByJobId(job.id);
        if (!card) continue;

        card.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(300);
        card.click();
        await sleep(1500); // 等右侧面板展开

        // 提取 JD
        const panelData = JDExtractor.extractFromPanel();
        if (panelData && panelData.desc) {
          job.jd = {
            desc: panelData.desc,
            tags: panelData.tags,
            complete: panelData.complete,
            keywords: JDExtractor.extractKeywords(panelData.desc),
          };
          job.hrName = panelData.hrName;
          job.hrCompany = panelData.hrCompany;
          job.hrActivity = panelData.activity;
          extracted++;
        }

        if (progressCb) {
          progressCb({ jdExtracted: extracted, jdTotal: jobs.length, current: job.name });
        }
      } catch (e) {
        console.warn('[BossGreet] JD 提取失败:', job.name, e.message);
      }
    }

    return extracted;
  },

  _findCardByJobId(jobId) {
    const cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    for (const card of cards) {
      const link = card.querySelector('a')?.href || '';
      if (link.includes(jobId)) return card;
    }
    return null;
  },

  stop() {
    this.stopped = true;
  },
};

// ── 收集入口 ──
async function runCollection(params, progressCb) {
  JobCollector.collected.clear();

  // Phase 1: 滚动采集所有岗位卡片
  await JobCollector.scrollToLoad(progressCb);
  const jobs = [...JobCollector.collected.values()];

  // Phase 2: 逐个点击提取 JD（核心改动）
  if (progressCb) progressCb({ phase: 'jd_extract', total: jobs.length });
  await JobCollector.extractJDsFromPanel(progressCb);

  const finalJobs = [...JobCollector.collected.values()];

  return {
    jobs: finalJobs,
    count: finalJobs.length,
    withJD: finalJobs.filter(j => j.jd && j.jd.desc).length,
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
