// BossGreet — Popup 状态管理
const PopupState = {
  page: 'a',
  swState: null,
  apiConfig: {},
  filterState: {
    city: '101280600',
    keyword: '',
    experience: '',
    hrActiveFilter: '不限',
  },

  init() {
    // 从 storage 恢复 filter 状态
    chrome.storage.local.get('ui:filterState', result => {
      if (result['ui:filterState']) {
        Object.assign(this.filterState, result['ui:filterState']);
      }
    });
  },

  saveFilter() {
    chrome.storage.local.set({ 'ui:filterState': this.filterState });
  },
};
