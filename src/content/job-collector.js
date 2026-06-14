// ════════════════════════════════════════════════════════════
// BossGreet — Opportunity Collector Module
// DOM parsing + infinite scroll + JD extraction
// ════════════════════════════════════════════════════════════

const JobCollector = {
  collected: new Map(),
  stopped: false,
  scrollDelay: 1500,
  maxPages: 20,

  /**
   * Parse a single opportunity card
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
      jd: null,
    };
  },

  /**
   * Parse all cards on current page
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
   * Infinite scroll loading
   */
  async scrollToLoad(progressCb) {
    this.stopped = false;

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
   * Extract JDs by clicking each card (right-side panel)
   */
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

  stop() {
    this.stopped = true;
  },
};

// Collection entry point
async function runCollection(params, progressCb) {
  JobCollector.collected.clear();

  // Phase 1: Scroll and collect all opportunity cards
  await JobCollector.scrollToLoad(progressCb);
  const jobs = [...JobCollector.collected.values()];

  // Phase 2: Extract JD from each card's panel
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
