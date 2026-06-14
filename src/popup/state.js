// BossGreet — Popup state management
const PopupState = {
  page: 'a',
  swState: null,
  apiConfig: {},
  filterState: {
    city: '101280600',
    keyword: '',
    experience: '',
    hrActiveFilter: 'any',
  },

  init() {
    // Restore filter state from storage
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
