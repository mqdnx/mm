(() => {
  'use strict';

  // ─── Elements ─────────────────────────────────────────────
  const videoList = document.getElementById('video-list');
  const loading = document.getElementById('loading');
  const noVideos = document.getElementById('no-videos');
  const errorState = document.getElementById('error-state');

  const stealthToggle = document.getElementById('stealth-toggle');
  const stealthBar = document.querySelector('.stealth-bar');

  const downloadBtn = document.getElementById('download-pdf-btn');
  const pdfProgressContainer = document.getElementById('pdf-progress-container');
  const pdfProgressFill = document.getElementById('pdf-progress-fill');
  const pdfProgressText = document.getElementById('pdf-progress-text');
  const pdfStatus = document.getElementById('pdf-status');

  let currentVideos = [];
  let activeVideoIndex = -1;
  let activeWindowType = null; // 'pip' | 'window'

  // ─── Stealth Mode (Default: OFF) ──────────────────────────

  function updateStealthUI(enabled) {
    if (stealthToggle) stealthToggle.checked = enabled;
    if (stealthBar) stealthBar.classList.toggle('disabled', !enabled);
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ stealthMode: false }, (res) => {
      updateStealthUI(res.stealthMode);
    });
  }

  if (stealthToggle) {
    stealthToggle.addEventListener('change', () => {
      const enabled = stealthToggle.checked;
      updateStealthUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ stealthMode: enabled });
      }
      sendToContent({ type: 'SET_STEALTH', enabled }).catch(() => {});
      showToast(
        enabled ? 'Режим невидимки включён' : 'Режим невидимки выключен',
        enabled ? 'success' : 'info'
      );
    });
  }

  // ─── Microphone Guard (Default: ON) ───────────────────────

  const micGuardToggle = document.getElementById('mic-guard-toggle');
  const micGuardBar = document.querySelector('.mic-guard-bar');

  function updateMicGuardUI(enabled) {
    if (micGuardToggle) micGuardToggle.checked = enabled;
    if (micGuardBar) micGuardBar.classList.toggle('disabled', !enabled);
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ micGuard: true }, (res) => {
      updateMicGuardUI(res.micGuard);
    });
  }

  if (micGuardToggle) {
    micGuardToggle.addEventListener('change', () => {
      const enabled = micGuardToggle.checked;
      updateMicGuardUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ micGuard: enabled });
      }
      sendToContent({ type: 'SET_MIC_GUARD', enabled }).catch(() => {});
      showToast(
        enabled ? 'Предохранитель включён' : 'Предохранитель выключен',
        enabled ? 'success' : 'info'
      );
    });
  }

  // ─── Freeze Cam (Default: OFF) ────────────────────────────

  const freezeCamToggle = document.getElementById('freeze-cam-toggle');
  const freezeCamBar = document.querySelector('.freeze-cam-bar');
  const freezeRecordBtn = document.getElementById('freeze-record-btn');
  const freezeGifFile = document.getElementById('freeze-gif-file');
  const freezeGifBtn = document.getElementById('freeze-gif-btn');
  const freezeGifLabel = document.getElementById('freeze-gif-label');
  const freezeGifClear = document.getElementById('freeze-gif-clear');

  function updateFreezeCamUI(enabled) {
    if (freezeCamToggle) freezeCamToggle.checked = enabled;
    if (freezeCamBar) freezeCamBar.classList.toggle('disabled', !enabled);
  }

  function updateGifUI(gifName) {
    if (gifName) {
      if (freezeGifLabel) {
        freezeGifLabel.textContent = `GIF: ${gifName}`;
        freezeGifLabel.classList.add('has-custom');
        freezeGifLabel.title = gifName;
      }
      if (freezeGifClear) freezeGifClear.style.display = 'flex';
      if (freezeGifBtn) {
        const span = freezeGifBtn.querySelector('span');
        if (span) span.textContent = 'Заменить';
      }
    } else {
      if (freezeGifLabel) {
        freezeGifLabel.textContent = 'Запись 3 сек (пинг-понг)';
        freezeGifLabel.classList.remove('has-custom');
        freezeGifLabel.title = 'Камера запишет 3 секунды и зациклит пинг-понгом (1 2 3 2 1)';
      }
      if (freezeGifClear) freezeGifClear.style.display = 'none';
      if (freezeGifBtn) {
        const span = freezeGifBtn.querySelector('span');
        if (span) span.textContent = 'Свой GIF';
      }
    }
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ freezeCam: false, freezeCamGifName: null }, (res) => {
      updateFreezeCamUI(res.freezeCam);
      updateGifUI(res.freezeCamGifName);
    });
  }

  if (freezeRecordBtn) {
    freezeRecordBtn.addEventListener('click', () => {
      updateFreezeCamUI(true);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCam: true });
        chrome.storage.local.remove(['freezeCamGif', 'freezeCamGifName']);
      }
      updateGifUI(null);
      sendToContent({ type: 'START_RECORD_FREEZE' }).catch(() => {});
      showToast('Запуск записи 3 секунд...', 'info');
    });
  }

  if (freezeCamToggle) {
    freezeCamToggle.addEventListener('change', () => {
      const enabled = freezeCamToggle.checked;
      updateFreezeCamUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCam: enabled });
      }
      sendToContent({ type: 'SET_FREEZE_CAM', enabled }).catch(() => {});
      if (enabled) {
        chrome.storage.local.get({ freezeCamGifName: null }, (res) => {
          if (!res.freezeCamGifName) {
            showToast('Запись 3 секунд вебки...', 'info');
          } else {
            showToast('Трансляция GIF включена', 'success');
          }
        });
      } else {
        showToast('Вебкамера разморожена', 'info');
      }
    });
  }

  if (freezeGifBtn && freezeGifFile) {
    freezeGifBtn.addEventListener('click', () => {
      freezeGifFile.click();
    });

    freezeGifFile.addEventListener('change', () => {
      const file = freezeGifFile.files && freezeGifFile.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const name = file.name;
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ freezeCamGif: dataUrl, freezeCamGifName: name });
        }
        updateGifUI(name);
        sendToContent({ type: 'SET_FREEZE_GIF', dataUrl }).catch(() => {});
        showToast(`GIF "${name}" загружен для трансляции`, 'success');
      };
      reader.readAsDataURL(file);
    });
  }

  if (freezeGifClear) {
    freezeGifClear.addEventListener('click', () => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(['freezeCamGif', 'freezeCamGifName']);
      }
      if (freezeGifFile) freezeGifFile.value = '';
      updateGifUI(null);
      sendToContent({ type: 'SET_FREEZE_GIF', dataUrl: null }).catch(() => {});
      showToast('Сброшено на живую зацикловку вебки', 'info');
    });
  }

  // ─── Quick Screenshot Button ──────────────────────────────

  const quickScreenshotBtn = document.getElementById('quick-screenshot-btn');
  if (quickScreenshotBtn) {
    quickScreenshotBtn.addEventListener('click', async () => {
      quickScreenshotBtn.disabled = true;
      try {
        const res = await sendToContent({ type: 'TAKE_SCREENSHOT' });
        if (res?.error) {
          showToast(res.error, 'error');
        } else if (res?.dataUrl) {
          // Если контент-скрипт не смог скопировать из-за потери фокуса страницы, попап (будучи в фокусе) копирует в буфер
          let wroteToClipboard = res.copied;
          if (!wroteToClipboard && navigator.clipboard && navigator.clipboard.write) {
            try {
              const resp = await fetch(res.dataUrl);
              const blob = await resp.blob();
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              wroteToClipboard = true;
            } catch (err) {}
          }

          if (wroteToClipboard) {
            showToast('Скриншот скопирован в буфер', 'success');
          } else {
            const a = document.createElement('a');
            a.href = res.dataUrl;
            a.download = `maxitet_slide_${Date.now()}.png`;
            a.click();
            showToast('Скриншот сохранён в Загрузки', 'info');
          }
        } else {
          showToast('Скриншот скопирован в буфер', 'success');
        }
      } catch (e) {
        showToast('Ошибка создания скриншота', 'error');
      } finally {
        setTimeout(() => { quickScreenshotBtn.disabled = false; }, 800);
      }
    });
  }

  // ─── Zen Mode (Default: OFF) ──────────────────────────────

  const zenToggle = document.getElementById('zen-toggle');
  const zenBar = document.querySelector('.zen-bar');

  function updateZenUI(enabled) {
    if (zenToggle) zenToggle.checked = enabled;
    if (zenBar) zenBar.classList.toggle('disabled', !enabled);
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ zenMode: false }, (res) => {
      updateZenUI(res.zenMode);
    });
  }

  sendToContent({ type: 'GET_ZEN_MODE' }).then((res) => {
    if (res && typeof res.isZen === 'boolean') {
      updateZenUI(res.isZen);
    }
  }).catch(() => {});

  if (zenToggle) {
    zenToggle.addEventListener('change', () => {
      const enabled = zenToggle.checked;
      updateZenUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ zenMode: enabled });
      }
      sendToContent({ type: 'SET_ZEN_MODE', enabled }).catch(() => {});
      showToast(
        enabled ? 'Режим Дзен включён (Z)' : 'Режим Дзен выключен',
        enabled ? 'success' : 'info'
      );
    });
  }

  // ─── Smart Dark Mode (Default: OFF) ───────────────────────

  const darkModeToggle = document.getElementById('dark-mode-toggle');
  const darkModeBar = document.querySelector('.dark-mode-bar');

  function updateDarkModeUI(enabled) {
    if (darkModeToggle) darkModeToggle.checked = enabled;
    if (darkModeBar) darkModeBar.classList.toggle('disabled', !enabled);
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ smartDarkMode: false }, (res) => {
      updateDarkModeUI(res.smartDarkMode);
    });
  }

  sendToContent({ type: 'GET_SMART_DARK_MODE' }).then((res) => {
    if (res && typeof res.isSmartDarkMode === 'boolean') {
      updateDarkModeUI(res.isSmartDarkMode);
    }
  }).catch(() => {});

  if (darkModeToggle) {
    darkModeToggle.addEventListener('change', () => {
      const enabled = darkModeToggle.checked;
      updateDarkModeUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ smartDarkMode: enabled });
      }
      sendToContent({ type: 'SET_SMART_DARK_MODE', enabled }).catch(() => {});
      showToast(
        enabled ? 'Тёмная тема слайдов включена (D)' : 'Тёмная тема слайдов выключена',
        enabled ? 'success' : 'info'
      );
    });
  }

  // ─── Vector SVG Icons ─────────────────────────────────────

  function getVideoIcon(type) {
    if (type === 'screen' || type === 'screen-guess') {
      return `<svg class="video-label-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
    }
    if (type === 'host-cam') {
      return `<svg class="video-label-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`;
    }
    if (type === 'self-cam' || type === 'participant-cam') {
      return `<svg class="video-label-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    }
    return `<svg class="video-label-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>`;
  }

  const SVG_BTN_WINDOW = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`;
  const SVG_BTN_PIP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><rect width="8" height="5" x="12" y="10" rx="1"/></svg>`;
  const SVG_BTN_CLOSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // ─── Video List & Streams ─────────────────────────────────

  async function init() {
    showLoading();

    try {
      const response = await sendToContent({ type: 'GET_VIDEOS' });

      if (response?.error) {
        showError(response.error);
        return;
      }

      const videos = response?.videos || [];
      currentVideos = videos;
      activeVideoIndex = response?.activeVideoIndex !== undefined ? response.activeVideoIndex : -1;
      activeWindowType = response?.activeWindowType || null;

      if (videos.length === 0) {
        showNoVideos();
        return;
      }

      renderVideoList(videos);
    } catch (e) {
      showError('Не удалось связаться со страницей занятия. Обновите вкладку и попробуйте снова.');
    }
  }

  function renderVideoList(videos) {
    loading.style.display = 'none';
    noVideos.style.display = 'none';
    errorState.style.display = 'none';

    videoList.querySelectorAll('.video-card').forEach((c) => c.remove());

    videos.forEach((video) => {
      const card = document.createElement('div');
      const isScreen = video.type === 'screen' || video.type === 'screen-guess';
      card.className = `video-card${isScreen ? ' screen-share' : ''}`;

      const isCurrentActive = String(activeVideoIndex) === String(video.index);
      const isWindowActive = isCurrentActive && activeWindowType === 'window';
      const isPipActive = isCurrentActive && activeWindowType === 'pip';

      const cleanLabel = (video.label || 'Видео').replace(/^[\p{Emoji}\s]+/u, '').trim();
      const icon = getVideoIcon(video.type);

      card.innerHTML = `
        <div class="video-header">
          <div class="video-label">
            ${icon}
            <span>${cleanLabel}</span>
            ${isScreen ? '<span class="badge">REC</span>' : ''}
          </div>
          <div class="video-meta">${video.width}×${video.height}</div>
        </div>
        <div class="video-thumb-container">
          ${
            video.thumbnail
              ? `<img class="video-thumb" src="${video.thumbnail}" alt="preview">`
              : `<div class="video-thumb-placeholder">Загрузка кадра…</div>`
          }
        </div>
        <div class="video-actions">
          <button class="btn btn-window${isWindowActive ? ' active' : ''}" data-index="${video.index}" title="Отдельное чистое окно: можно развернуть на 100% экрана или разделить экран с IDE (Win + стрелочки)">
            ${isWindowActive ? `${SVG_BTN_CLOSE}<span>Закрыть</span>` : `${SVG_BTN_WINDOW}<span>Окно (100% / Сплит)</span>`}
          </button>
          <button class="btn btn-pip${isPipActive ? ' active' : ''}" data-index="${video.index}" title="Плавающее окно поверх всех окон (Always on top)">
            ${isPipActive ? `${SVG_BTN_CLOSE}<span>Закрыть</span>` : `${SVG_BTN_PIP}<span>PiP</span>`}
          </button>
        </div>
      `;

      videoList.appendChild(card);
    });

    videoList.querySelectorAll('.btn-window').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn, 'window'));
    });
    videoList.querySelectorAll('.btn-pip').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(btn, 'pip'));
    });
  }

  async function handleAction(btn, actionType) {
    const rawIndex = btn.dataset.index;
    const videoIndex = rawIndex === 'presentation' ? 'presentation' : parseInt(rawIndex, 10);
    const isAlreadyActive = String(activeVideoIndex) === String(videoIndex) && activeWindowType === actionType;

    if (isAlreadyActive) {
      try {
        await sendToContent({ type: 'CLOSE_ACTIVE' });
      } catch (e) {}
      activeVideoIndex = -1;
      activeWindowType = null;
      renderVideoList(currentVideos);
      showToast('Окно закрыто', 'info');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Открытие…';

    const msgType = actionType === 'window' ? 'OPEN_WINDOW' : 'OPEN_PIP';

    try {
      const result = await sendToContent({ type: msgType, videoIndex });

      if (result?.error) {
        showToast(result.error, 'error');
        btn.disabled = false;
        renderVideoList(currentVideos);
        return;
      }

      activeVideoIndex = videoIndex;
      activeWindowType = actionType;
      renderVideoList(currentVideos);

      if (actionType === 'window') {
        showToast('Чистое окно открыто! Нажмите [口] для 100% или Win + стрелочки для сплита', 'success');
      } else {
        showToast('Плавающий PiP открыт поверх окон!', 'success');
      }

      setTimeout(() => window.close(), 700);
    } catch (e) {
      showToast('Ошибка: ' + e.message, 'error');
      renderVideoList(currentVideos);
    }
  }

  // ─── Presentation PDF Downloader ──────────────────────────

  function updatePdfProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    pdfProgressFill.style.width = `${percent}%`;
    pdfProgressFill.textContent = `${percent}%`;
    pdfProgressText.textContent = `Загрузка: ${current} из ${total} слайдов`;
  }

  function showPdfStatus(text, type = '') {
    pdfStatus.textContent = text;
    pdfStatus.style.display = 'block';
    pdfStatus.className = type;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      pdfProgressContainer.style.display = 'block';
      pdfStatus.style.display = 'none';
      pdfProgressFill.style.width = '0%';
      pdfProgressFill.textContent = '0%';
      pdfProgressText.textContent = 'Поиск презентации на странице…';

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('vision.maximumtest.ru')) {
          showPdfStatus('Ошибка: откройте урок на vision.maximumtest.ru', 'error');
          downloadBtn.disabled = false;
          return;
        }

        // 1. Запрашиваем информацию о презентации через content.js (читает Pinia store и DOM)
        const presInfo = await sendToContent({ type: 'GET_PRESENTATION_INFO' }).catch(() => null);

        let srcTemplate = presInfo?.srcTemplate;
        let knownPagesCount = presInfo?.pagesCount || 0;
        let currentSrc = presInfo?.currentSrc;

        // Fallback через прямой опрос DOM страницы, если скрипт не ответил
        if (!srcTemplate && !currentSrc) {
          const injection = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const img = document.querySelector('.viewer-main-img__img') || document.querySelector('.viewer img');
              return img ? (img.currentSrc || img.src) : null;
            },
          }).catch(() => null);
          currentSrc = injection?.[0]?.result;
        }

        if (!srcTemplate && currentSrc) {
          const match = currentSrc.match(/^(.*?(?:page[._-]?|slide[._-]?|\/))(\d+)(\.[a-zA-Z0-9]+(?:\?.*)?)$/i);
          if (match) {
            srcTemplate = `${match[1]}{{pageNumer}}${match[3]}`;
          }
        }

        if (!srcTemplate && !currentSrc) {
          showPdfStatus('Слайды не найдены. Убедитесь, что преподаватель включил презентацию.', 'error');
          downloadBtn.disabled = false;
          return;
        }

        function getPageUrl(pageNum) {
          if (srcTemplate) {
            return srcTemplate.replace('{{pageNumer}}', pageNum);
          }
          return currentSrc;
        }

        showPdfStatus('Сканирование и загрузка слайдов презентации…', '');

        // Проверяем jsPDF
        if (typeof window.jspdf === 'undefined' && typeof jspdf === 'undefined') {
          showPdfStatus('Ошибка: библиотека jsPDF не найдена', 'error');
          downloadBtn.disabled = false;
          return;
        }
        const jsPDFConstructor = window.jspdf ? window.jspdf.jsPDF : jspdf.jsPDF;

        const downloadedSlides = []; // { pageNum, blob }

        if (knownPagesCount > 0) {
          // Точное количество известно из Pinia Store М.Класс
          pdfProgressText.textContent = `Загрузка: 0 из ${knownPagesCount} слайдов`;
          for (let p = 1; p <= knownPagesCount; p++) {
            const pageUrl = getPageUrl(p);
            try {
              const resp = await fetch(pageUrl);
              if (resp.ok) {
                const blob = await resp.blob();
                downloadedSlides.push({ pageNum: p, blob });
              }
            } catch (err) {
              console.warn(`Ошибка скачивания слайда ${p}:`, err);
            }
            updatePdfProgress(p, knownPagesCount);
          }
        } else {
          // Сканируем страницы последовательно до 3 промахов подряд
          let pageNum = 1;
          let consecutiveFails = 0;
          while (consecutiveFails < 3 && pageNum <= 300) {
            const pageUrl = getPageUrl(pageNum);
            try {
              const resp = await fetch(pageUrl);
              if (resp.ok) {
                const blob = await resp.blob();
                downloadedSlides.push({ pageNum, blob });
                consecutiveFails = 0;
                pdfProgressText.textContent = `Собрано: ${downloadedSlides.length} слайдов (проверка стр. ${pageNum}…)`;
              } else {
                consecutiveFails++;
              }
            } catch (e) {
              consecutiveFails++;
            }
            pageNum++;
          }
        }

        if (downloadedSlides.length === 0) {
          showPdfStatus('Ошибка: не удалось скачать ни одного слайда. Проверьте сеть или обновите вкладку.', 'error');
          downloadBtn.disabled = false;
          return;
        }

        showPdfStatus(`Собрано ${downloadedSlides.length} слайдов. Формирование PDF…`, '');
        updatePdfProgress(0, downloadedSlides.length);

        const pdf = new jsPDFConstructor('l', 'mm', 'a4');

        for (let i = 0; i < downloadedSlides.length; i++) {
          const item = downloadedSlides[i];
          updatePdfProgress(i + 1, downloadedSlides.length);

          try {
            const b64 = await blobToBase64(item.blob);
            if (i > 0) {
              pdf.addPage('a4', 'landscape');
            }
            const imgObj = await loadImage(b64);
            const sw = imgObj.width;
            const sh = imgObj.height;
            const scale = Math.min(297 / sw, 210 / sh);
            const dw = sw * scale;
            const dh = sh * scale;
            const dx = (297 - dw) / 2;
            const dy = (210 - dh) / 2;

            pdf.addImage(b64, 'JPEG', dx, dy, dw, dh);
          } catch (err) {
            console.error(`Ошибка добавления страницы ${item.pageNum} в PDF:`, err);
          }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `maxitet_presentation_${timestamp}.pdf`;
        pdf.save(fileName);

        showPdfStatus(`Готово! Скачано ${downloadedSlides.length} слайдов в файл ${fileName}`, 'success');
      } catch (err) {
        console.error('Ошибка создания PDF:', err);
        showPdfStatus(`Ошибка: ${err.message}`, 'error');
      } finally {
        downloadBtn.disabled = false;
      }
    });
  }

  // ─── Helpers & Communication ──────────────────────────────

  function sendToContent(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
          reject(new Error('Нет активной вкладки'));
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { ...message, target: 'content' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    });
  }

  function showLoading() {
    loading.style.display = 'flex';
    noVideos.style.display = 'none';
    errorState.style.display = 'none';
  }

  function showNoVideos() {
    loading.style.display = 'none';
    noVideos.style.display = 'flex';
    errorState.style.display = 'none';
  }

  function showError(msg) {
    loading.style.display = 'none';
    noVideos.style.display = 'none';
    errorState.style.display = 'flex';
    errorState.querySelector('.error-text').textContent = msg;
  }

  function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  init();
})();
