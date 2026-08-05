document.getElementById('toggle')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-sidebar' }).catch(() => {
      // Content script not present (chrome:// pages, web store, etc.)
      document.querySelector('.hint')!.textContent =
        'The assistant cannot run on this page (browser-internal pages are off-limits). Try a normal website.';
    });
    window.close();
  }
});
