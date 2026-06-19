// 岗位收集模块 — DOM 解析 + 无限滚动 + 标签聚类 + URL 筛选
const JobCollector = {
  collected: new Map(), // id → job
  stopped: false,
  scrollDelay: 1500,
  maxPages: 20, // 最多翻20页

  // ── 卡片解析 ──
  parseCard(card) {
    const nameEl = card.querySelector(SELECTORS.jobs.jobName);
    const salaryEl = card.querySelector(SELECTORS.jobs.jobSalary);
    const companyEl = card.querySelector(SELECTORS.jobs.company);
    const tags = [...card.querySelectorAll(SELECTORS.jobs.tagList)].map((t) => t.textContent.trim());
    const link = card.querySelector('a')?.href || '';
    const id = link.match(/job_detail\/([^.]+)\.html/)?.[1] || link;

    return {
      id,
      name: nameEl?.textContent.trim() || '',
      salary: decodeSalary(salaryEl?.textContent || ''),
      company: companyEl?.textContent.trim() || '',
      tags,
      link,
    };
  },

  // ── 解析当前页所有卡片 ──
  parseCurrentPage() {
    const cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    let newCount = 0;
    cards.forEach((card) => {
      const job = this.parseCard(card);
      if (job.id && !this.collected.has(job.id)) {
        this.collected.set(job.id, job);
        newCount++;
      }
    });
    return newCount;
  },

  // ── 获取当前筛选标签 ──
  getActiveTags() {
    const tags = [];
    const synthesis = document.querySelector(SELECTORS.jobs.synthesis);
    if (synthesis) tags.push({ type: 'recommend', name: synthesis.textContent.trim() });

    document.querySelectorAll(SELECTORS.jobs.expectItemText).forEach((el) => {
      tags.push({ type: 'expect', name: el.textContent.trim() });
    });
    return tags;
  },

  // ── 无限滚动 ──
  async scrollToLoad(progressCb) {
    this.stopped = false;

    // 等首批卡片渲染（页面刚跳转 AJAX 未回时，避免立即 break 退出）
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

      // 滚动到底
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(this.scrollDelay);

      // 检测是否有新内容加载
      const newCards = document.querySelectorAll(SELECTORS.jobs.jobCard);
      if (newCards.length <= currentCount + 1) {
        // 可能没有更多了
        await sleep(1000);
        this.parseCurrentPage();
        if (this.collected.size === currentCount) break;
      }
      page++;
    }

    // 最终解析
    this.parseCurrentPage();
  },

  // ── 按标签聚类 ──
  clusterByTag() {
    const clusters = {};
    for (const job of this.collected.values()) {
      const primaryTag = job.tags[0] || '其他';
      if (!clusters[primaryTag]) clusters[primaryTag] = [];
      clusters[primaryTag].push(job);
    }
    return clusters;
  },

  // ── 取每类代表性 JD ──
  sampleJDs(clusters, perCluster = 5) {
    const samples = {};
    for (const [tag, jobs] of Object.entries(clusters)) {
      samples[tag] = jobs.slice(0, perCluster).map((j) => ({
        title: j.name,
        tags: j.tags,
        desc: j.name, // JD 详情需额外抓取
      }));
    }
    return samples;
  },

  // ── 按标签分组顺序发送计划 ──
  buildSendPlan(clusters, greetings) {
    const plan = [];
    for (const [tag, jobs] of Object.entries(clusters)) {
      for (const job of jobs) {
        plan.push({
          jobId: job.id,
          category: tag,
          greeting: greetings[tag] || '',
        });
      }
    }
    return plan;
  },

  // ── 提取完整 JD（点击卡片，从右侧面板提取）──
  async extractJDsFromPanel(progressCb) {
    const jobs = [...this.collected.values()];
    let extracted = 0;

    for (let i = 0; i < jobs.length; i++) {
      if (this.stopped) break;
      const job = jobs[i];

      try {
        const card = this._findCardByJobId(job.id);
        if (!card) continue;

        card.scrollIntoView({ block: 'center', behavior: 'instant' });
        await sleep(300);
        card.click();
        await sleep(1500);

        // 使用 JDExtractor 提取完整 JD
        if (typeof JDExtractor !== 'undefined') {
          const panelData = JDExtractor.extractFromPanel();
          if (panelData && panelData.desc) {
            job.jd = {
              desc: panelData.desc,
              fullDesc: panelData.desc,
              tags: panelData.tags,
              complete: panelData.complete,
              keywords: panelData.keywords || [],
            };
            job.hrName = panelData.hrName;
            job.hrCompany = panelData.hrCompany;
            job.hrActivity = panelData.activity;
            extracted++;
          }
        }

        if (progressCb) {
          progressCb({ jdExtracted: extracted, jdTotal: jobs.length, current: job.name });
        }
      } catch (e) {
        console.warn('[BossGreet] JD extraction failed:', job.name, e.message);
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
};

// ── 收集入口 ──
// 注意：导航逻辑已移至 service worker，避免页面重载销毁 content script 执行上下文
async function runCollection(params, progressCb) {
  JobCollector.collected.clear();
  JobCollector.stopped = false;

  // Phase 1: 滚动收集所有卡片
  console.log('[BossGreet] Phase 1: Scrolling to load cards...');
  await JobCollector.scrollToLoad(progressCb);
  const jobs = [...JobCollector.collected.values()];
  console.log('[BossGreet] Phase 1 complete:', jobs.length, 'cards found');

  if (jobs.length === 0) {
    return { jobs: [], clusters: {}, count: 0, jdSamples: {} };
  }

  // Phase 2: 提取完整 JD
  console.log('[BossGreet] Phase 2: Extracting JDs...');
  if (progressCb) progressCb({ phase: 'jd_extract', jdTotal: jobs.length });

  // 设置超时保护（最多 5 分钟）
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('JD extraction timeout')), 5 * 60 * 1000);
  });

  try {
    await Promise.race([
      JobCollector.extractJDsFromPanel(progressCb),
      timeoutPromise,
    ]);
  } catch (e) {
    console.warn('[BossGreet] JD extraction timeout or error:', e.message);
  }

  const finalJobs = [...JobCollector.collected.values()];
  const clusters = JobCollector.clusterByTag();

  console.log('[BossGreet] Collection complete:', finalJobs.length, 'jobs,', finalJobs.filter(j => j.jd).length, 'with JD');

  return {
    jobs: finalJobs,
    clusters,
    count: finalJobs.length,
    jdSamples: JobCollector.sampleJDs(clusters),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
