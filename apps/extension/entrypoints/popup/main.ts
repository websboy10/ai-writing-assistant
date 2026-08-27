document.getElementById('toggle')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-sidebar' });
  } catch {
    // No content script here: chrome://, the Web Store, PDF viewer, a new tab.
    //
    // window.close() used to run on this path too, so the explanation below
    // was written into the DOM and the popup shut before anyone could read it.
    // Clicking the only button on a chrome:// page did nothing at all, which
    // is the first thing a new user does when the panel has not appeared yet.
    const hint = document.querySelector('.hint');
    if (hint) {
      hint.textContent = 'Assistenten virker ikke på browserens egne sider. Åbn en almindelig hjemmeside og prøv igen.';
      hint.setAttribute('role', 'status');
    }
    return;
  }
  window.close();
});
