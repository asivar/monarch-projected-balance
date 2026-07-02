// Popup actions.
(function () {
  'use strict';
  const api = (typeof browser !== 'undefined') ? browser : chrome;
  // Update this to your repository URL after you create it.
  const REPO = 'https://github.com/asivar/monarch-projected-balance';

  document.getElementById('settings').addEventListener('click', () => {
    if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
    else window.open(api.runtime.getURL('options.html'));
    window.close();
  });
  document.getElementById('github').addEventListener('click', () => {
    if (api.tabs && api.tabs.create) api.tabs.create({ url: REPO });
    else window.open(REPO, '_blank');
    window.close();
  });
})();
