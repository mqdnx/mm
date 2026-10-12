chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === 'background') {
    if (message.type === 'FETCH_IMAGE_BASE64') {
      fetch(message.url)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const mime = res.headers.get('content-type') || 'image/jpeg';
          const buffer = await res.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buffer);
          const chunk = 8192;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          const dataUrl = `data:${mime};base64,${btoa(binary)}`;
          sendResponse({ dataUrl });
        })
        .catch((err) => {
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (message.type === 'SAVE_PDF_DOWNLOAD') {
      try {
        const downloadOptions = {
          url: message.dataUrl,
          filename: message.filename || 'presentation.pdf',
          saveAs: Boolean(message.saveAs),
          conflictAction: 'uniquify'
        };
        chrome.downloads.download(downloadOptions, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn('[Maxitet Master] chrome.downloads.download error:', chrome.runtime.lastError);
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, downloadId });
          }
        });
      } catch (err) {
        console.error('[Maxitet Master] SAVE_PDF_DOWNLOAD error:', err);
        sendResponse({ error: err.message });
      }
      return true;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) {
        sendResponse({ error: 'Нет активной вкладки' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { ...message, target: 'content' }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true;
  }
});
