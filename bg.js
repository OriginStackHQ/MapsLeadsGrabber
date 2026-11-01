/**
 * bg.js - minimal service worker: clicking the toolbar icon opens the
 * dashboard (there is deliberately no popup).
 */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[MLG] Maps Lead Grabber installed.');
  }
});
