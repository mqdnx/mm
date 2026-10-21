function sanitizeDownloadFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'presentation.pdf';
  // Нормализация слэшей
  let clean = filename.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
  // Защита от Path Traversal (../ и .)
  const segments = clean.split('/').filter((s) => s && s !== '.' && s !== '..');
  if (segments.length === 0) return 'presentation.pdf';
  // Удаление недопустимых символов в именах файлов
  const safeSegments = segments.map((seg) => seg.replace(/[\x00-\x1F\x7F:*?"<>|]/g, '').trim());
  clean = safeSegments.filter(Boolean).join('/');
  if (!clean || !/\.(pdf|png|jpe?g|webp)$/i.test(clean)) {
    clean = (clean ? clean.replace(/\.[^.]+$/, '') : 'presentation') + '.pdf';
  }
  return clean;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Допускаем вызовы только от собственного расширения (popup / content)
  if (sender.id !== chrome.runtime.id) return;

  if (message.target === 'background') {
    if (message.type === 'FETCH_IMAGE_BASE64') {
      const rawUrl = message.url;
      if (!rawUrl || typeof rawUrl !== 'string') {
        sendResponse({ error: 'URL не указан' });
        return true;
      }

      let parsed;
      try {
        const fullUrl = rawUrl.startsWith('http')
          ? rawUrl
          : `https://vision.maximumtest.ru${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        parsed = new URL(fullUrl);
      } catch (e) {
        sendResponse({ error: 'Некорректный формат URL' });
        return true;
      }

      // Защита от SSRF: только HTTPS (или HTTP для домена vision.maximumtest.ru)
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'vision.maximumtest.ru')) {
        sendResponse({ error: 'Запрещенный протокол (разрешен только https)' });
        return true;
      }

      // Блокировка доступа к loopback, локальным IP и cloud metadata (SSRF)
      const host = parsed.hostname.toLowerCase();
      const isPrivateOrLoopback =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '[::1]' ||
        host === '::1' ||
        host === '169.254.169.254' ||
        host.endsWith('.localhost') ||
        /^127\.\d+\.\d+\.\d+$/.test(host) ||
        /^10\.\d+\.\d+\.\d+$/.test(host) ||
        /^192\.168\.\d+\.\d+$/.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);

      if (isPrivateOrLoopback) {
        sendResponse({ error: 'Запрещен доступ к локальным и приватным адресам' });
        return true;
      }

      // Разрешаем скачивание изображений строго с доменов М.Класс и Yandex Cloud Storage
      const isAllowedDomain =
        host === 'maximumtest.ru' ||
        host.endsWith('.maximumtest.ru') ||
        host === 'yandexcloud.net' ||
        host.endsWith('.yandexcloud.net');

      if (!isAllowedDomain) {
        sendResponse({ error: 'Запрещенный домен для загрузки' });
        return true;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      fetch(parsed.href, { signal: controller.signal })
        .then(async (res) => {
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const mime = res.headers.get('content-type') || 'image/jpeg';
          if (!mime.startsWith('image/') && !mime.startsWith('application/octet-stream') && !mime.startsWith('binary/')) {
            throw new Error(`Недопустимый тип контента: ${mime}`);
          }
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
          clearTimeout(timeoutId);
          sendResponse({ error: err.message });
        });
      return true;
    }

    if (message.type === 'SAVE_PDF_DOWNLOAD') {
      try {
        const isSafeDataUrl = typeof message.dataUrl === 'string' && (
          message.dataUrl.startsWith('data:application/pdf') ||
          message.dataUrl.startsWith('data:image/') ||
          message.dataUrl.startsWith('blob:')
        );
        if (!isSafeDataUrl) {
          sendResponse({ error: 'Недопустимый формат данных файла' });
          return true;
        }

        const safeFilename = sanitizeDownloadFilename(message.filename);
        const downloadOptions = {
          url: message.dataUrl,
          filename: safeFilename,
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
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.id) {
        sendResponse({ error: 'Нет активной вкладки' });
        return;
      }
      if (!activeTab.url || !activeTab.url.includes('maximumtest.ru')) {
        sendResponse({ error: 'Активная вкладка не является страницей М.Класс' });
        return;
      }
      chrome.tabs.sendMessage(activeTab.id, { ...message, target: 'content' }, (response) => {
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
