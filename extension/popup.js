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

  // Mode selectors & panels
  const freezeModeLoopBtn = document.getElementById('freeze-mode-loop');
  const freezeModePhotoBtn = document.getElementById('freeze-mode-photo');
  const freezePanelLoop = document.getElementById('freeze-panel-loop');
  const freezePanelPhoto = document.getElementById('freeze-panel-photo');

  // Loop mode controls
  const freezeRecordBtn = document.getElementById('freeze-record-btn');
  const freezeGifFile = document.getElementById('freeze-gif-file');
  const freezeGifBtn = document.getElementById('freeze-gif-btn');
  const freezeLoopLabel = document.getElementById('freeze-loop-label');
  const freezeGifClear = document.getElementById('freeze-gif-clear');

  // Photo mode controls
  const freezeSnapshotBtn = document.getElementById('freeze-snapshot-btn');
  const freezePhotoFile = document.getElementById('freeze-photo-file');
  const freezePhotoBtn = document.getElementById('freeze-photo-btn');
  const freezePhotoLabel = document.getElementById('freeze-photo-label');
  const freezePhotoClear = document.getElementById('freeze-photo-clear');

  let currentFreezeMode = 'loop';

  function updateFreezeCamUI(enabled) {
    if (freezeCamToggle) freezeCamToggle.checked = enabled;
    if (freezeCamBar) freezeCamBar.classList.toggle('disabled', !enabled);
  }

  function setFreezeModeUI(mode) {
    currentFreezeMode = mode || 'loop';
    if (currentFreezeMode === 'photo') {
      if (freezeModePhotoBtn) freezeModePhotoBtn.classList.add('active');
      if (freezeModeLoopBtn) freezeModeLoopBtn.classList.remove('active');
      if (freezePanelPhoto) freezePanelPhoto.style.display = 'block';
      if (freezePanelLoop) freezePanelLoop.style.display = 'none';
    } else {
      if (freezeModeLoopBtn) freezeModeLoopBtn.classList.add('active');
      if (freezeModePhotoBtn) freezeModePhotoBtn.classList.remove('active');
      if (freezePanelLoop) freezePanelLoop.style.display = 'block';
      if (freezePanelPhoto) freezePanelPhoto.style.display = 'none';
    }
  }

  function updateLoopUI(gifName, hasSavedLoop) {
    if (gifName) {
      if (freezeLoopLabel) {
        freezeLoopLabel.textContent = `GIF: ${gifName}`;
        freezeLoopLabel.classList.add('has-custom');
        freezeLoopLabel.title = gifName;
      }
      if (freezeGifClear) freezeGifClear.style.display = 'flex';
      if (freezeGifBtn) {
        const span = freezeGifBtn.querySelector('span');
        if (span) span.textContent = 'Заменить';
      }
    } else if (hasSavedLoop) {
      if (freezeLoopLabel) {
        freezeLoopLabel.textContent = '3-сек запись сохранена';
        freezeLoopLabel.classList.remove('has-custom');
        freezeLoopLabel.title = 'Готовая зацикленная 3-сек запись (пинг-понг)';
      }
      if (freezeGifClear) freezeGifClear.style.display = 'none';
      if (freezeGifBtn) {
        const span = freezeGifBtn.querySelector('span');
        if (span) span.textContent = 'Свой GIF';
      }
    } else {
      if (freezeLoopLabel) {
        freezeLoopLabel.textContent = 'Запись 3 сек (пинг-понг)';
        freezeLoopLabel.classList.remove('has-custom');
        freezeLoopLabel.title = 'Камера запишет 3 секунды и зациклит пинг-понгом';
      }
      if (freezeGifClear) freezeGifClear.style.display = 'none';
      if (freezeGifBtn) {
        const span = freezeGifBtn.querySelector('span');
        if (span) span.textContent = 'Свой GIF';
      }
    }
  }

  function updatePhotoUI(photoName, hasPhoto) {
    if (photoName) {
      if (freezePhotoLabel) {
        freezePhotoLabel.textContent = `Фото: ${photoName}`;
        freezePhotoLabel.classList.add('has-custom');
        freezePhotoLabel.title = photoName;
      }
      if (freezePhotoClear) freezePhotoClear.style.display = 'flex';
      if (freezePhotoBtn) {
        const span = freezePhotoBtn.querySelector('span');
        if (span) span.textContent = 'Заменить';
      }
    } else if (hasPhoto) {
      if (freezePhotoLabel) {
        freezePhotoLabel.textContent = 'Снимок вебки сохранён';
        freezePhotoLabel.classList.remove('has-custom');
        freezePhotoLabel.title = 'Сохранённый статичный стоп-кадр с камеры';
      }
      if (freezePhotoClear) freezePhotoClear.style.display = 'none';
      if (freezePhotoBtn) {
        const span = freezePhotoBtn.querySelector('span');
        if (span) span.textContent = 'Своё фото';
      }
    } else {
      if (freezePhotoLabel) {
        freezePhotoLabel.textContent = 'Стоп-кадр (снимок)';
        freezePhotoLabel.classList.remove('has-custom');
        freezePhotoLabel.title = 'Сделайте снимок с вебки или загрузите фото';
      }
      if (freezePhotoClear) freezePhotoClear.style.display = 'none';
      if (freezePhotoBtn) {
        const span = freezePhotoBtn.querySelector('span');
        if (span) span.textContent = 'Своё фото';
      }
    }
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({
      freezeCam: false,
      freezeCamMode: 'loop',
      freezeCamGifName: null,
      freezeCamPhotoName: null,
      freezeCamHasSavedLoop: false,
      freezeCamPhoto: null,
    }, (res) => {
      updateFreezeCamUI(res.freezeCam);
      setFreezeModeUI(res.freezeCamMode);
      updateLoopUI(res.freezeCamGifName, res.freezeCamHasSavedLoop);
      updatePhotoUI(res.freezeCamPhotoName, Boolean(res.freezeCamPhoto));
    });
  }

  // Переключение режима: Анимация (Loop)
  if (freezeModeLoopBtn) {
    freezeModeLoopBtn.addEventListener('click', () => {
      setFreezeModeUI('loop');
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCamMode: 'loop' });
      }
      sendToContent({ type: 'SET_FREEZE_MODE', mode: 'loop' }).catch(() => {});
    });
  }

  // Переключение режима: Фото (Photo)
  if (freezeModePhotoBtn) {
    freezeModePhotoBtn.addEventListener('click', () => {
      setFreezeModeUI('photo');
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCamMode: 'photo' });
      }
      sendToContent({ type: 'SET_FREEZE_MODE', mode: 'photo' }).catch(() => {});
    });
  }

  // Запись 3 сек (Loop)
  if (freezeRecordBtn) {
    freezeRecordBtn.addEventListener('click', () => {
      updateFreezeCamUI(true);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCam: true, freezeCamMode: 'loop' });
        chrome.storage.local.remove(['freezeCamGif', 'freezeCamGifName']);
      }
      updateLoopUI(null, false);
      sendToContent({ type: 'START_RECORD_FREEZE' }).catch(() => {});
      showToast('Запуск записи 3 секунд...', 'info');
    });
  }

  // Снимок с вебки (Photo)
  if (freezeSnapshotBtn) {
    freezeSnapshotBtn.addEventListener('click', () => {
      updateFreezeCamUI(true);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCam: true, freezeCamMode: 'photo' });
        chrome.storage.local.remove(['freezeCamPhotoName']);
      }
      updatePhotoUI(null, true);
      sendToContent({ type: 'TAKE_FREEZE_PHOTO' }).catch(() => {});
      showToast('Создание снимка с вебки...', 'info');
    });
  }

  // Toggle freeze cam
  if (freezeCamToggle) {
    freezeCamToggle.addEventListener('change', () => {
      const enabled = freezeCamToggle.checked;
      updateFreezeCamUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCam: enabled });
      }
      sendToContent({ type: 'SET_FREEZE_CAM', enabled }).catch(() => {});
      if (enabled) {
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.get({
            freezeCamMode: 'loop',
            freezeCamGifName: null,
            freezeCamPhotoName: null,
            freezeCamHasSavedLoop: false,
            freezeCamPhoto: null,
          }, (res) => {
            if (res.freezeCamMode === 'photo') {
              if (res.freezeCamPhotoName || res.freezeCamPhoto) {
                showToast('Трансляция фото включена', 'success');
              } else {
                showToast('Создание стоп-кадра с вебки...', 'info');
              }
            } else {
              if (res.freezeCamGifName) {
                showToast('Трансляция GIF включена', 'success');
              } else if (res.freezeCamHasSavedLoop) {
                showToast('Зацикленная трансляция включена (3 сек)', 'success');
              } else {
                showToast('Запись 3 секунд вебки...', 'info');
              }
            }
          });
        }
      } else {
        showToast('Вебкамера разморожена', 'info');
      }
    });
  }

  // Загрузка своего GIF/видео
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
          chrome.storage.local.set({
            freezeCamGif: dataUrl,
            freezeCamGifName: name,
            freezeCam: true,
            freezeCamMode: 'loop',
          });
        }
        updateFreezeCamUI(true);
        updateLoopUI(name, true);
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
        chrome.storage.local.get({ freezeCamHasSavedLoop: false }, (r) => {
          updateLoopUI(null, r.freezeCamHasSavedLoop);
        });
      }
      if (freezeGifFile) freezeGifFile.value = '';
      sendToContent({ type: 'SET_FREEZE_GIF', dataUrl: null }).catch(() => {});
      showToast('Сброшено на сохранённую 3-сек запись', 'info');
    });
  }

  // Загрузка своего Фото (JPG/PNG/WebP)
  if (freezePhotoBtn && freezePhotoFile) {
    freezePhotoBtn.addEventListener('click', () => {
      freezePhotoFile.click();
    });

    freezePhotoFile.addEventListener('change', () => {
      const file = freezePhotoFile.files && freezePhotoFile.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const name = file.name;
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            freezeCamPhoto: dataUrl,
            freezeCamPhotoName: name,
            freezeCam: true,
            freezeCamMode: 'photo',
          });
        }
        updateFreezeCamUI(true);
        updatePhotoUI(name, true);
        sendToContent({ type: 'SET_FREEZE_PHOTO', dataUrl }).catch(() => {});
        showToast(`Фото "${name}" загружено для трансляции`, 'success');
      };
      reader.readAsDataURL(file);
    });
  }

  if (freezePhotoClear) {
    freezePhotoClear.addEventListener('click', () => {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(['freezeCamPhotoName']);
        chrome.storage.local.get({ freezeCamPhoto: null }, (r) => {
          updatePhotoUI(null, Boolean(r.freezeCamPhoto));
        });
      }
      if (freezePhotoFile) freezePhotoFile.value = '';
      sendToContent({ type: 'TAKE_FREEZE_PHOTO' }).catch(() => {});
      showToast('Сброшено на снимок с вебки', 'info');
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
  const presetChips = document.querySelectorAll('.preset-chip');
  let currentDarkPreset = 'maxitet';

  function updateDarkModeUI(enabled) {
    if (darkModeToggle) darkModeToggle.checked = enabled;
    if (darkModeBar) darkModeBar.classList.toggle('disabled', !enabled);
  }

  function updatePresetUI(preset) {
    currentDarkPreset = preset || 'maxitet';
    presetChips.forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.preset === currentDarkPreset);
    });
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ smartDarkMode: false, smartDarkPreset: 'maxitet' }, (res) => {
      updateDarkModeUI(res.smartDarkMode);
      updatePresetUI(res.smartDarkPreset);
    });
  }

  sendToContent({ type: 'GET_SMART_DARK_MODE' }).then((res) => {
    if (res && typeof res.isSmartDarkMode === 'boolean') {
      updateDarkModeUI(res.isSmartDarkMode);
    }
    if (res && res.preset) {
      updatePresetUI(res.preset);
    }
  }).catch(() => {});

  if (darkModeToggle) {
    darkModeToggle.addEventListener('change', () => {
      const enabled = darkModeToggle.checked;
      updateDarkModeUI(enabled);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ smartDarkMode: enabled });
      }
      sendToContent({ type: 'SET_SMART_DARK_MODE', enabled, preset: currentDarkPreset }).catch(() => {});
      showToast(
        enabled ? 'Тёмная тема слайдов включена (D)' : 'Тёмная тема слайдов выключена',
        enabled ? 'success' : 'info'
      );
    });
  }

  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const preset = chip.dataset.preset;
      updatePresetUI(preset);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ smartDarkPreset: preset });
      }
      if (darkModeToggle && !darkModeToggle.checked) {
        darkModeToggle.checked = true;
        updateDarkModeUI(true);
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ smartDarkMode: true });
        }
        sendToContent({ type: 'SET_SMART_DARK_MODE', enabled: true, preset }).catch(() => {});
      } else {
        sendToContent({ type: 'SET_SMART_DARK_PRESET', preset }).catch(() => {});
      }
      const chipTitle = chip.querySelector('.chip-name')?.textContent || preset;
      showToast(`Пресет: ${chipTitle}`, 'success');
    });
  });

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
    syncPdfDownloadStatus();

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

  // ─── Presentation PDF Downloader (Background Execution) ───

  const pdfSaveAsToggle = document.getElementById('pdf-save-as-toggle');
  const pdfSubfolderInput = document.getElementById('pdf-subfolder-input');
  const pdfSubfolderRow = document.getElementById('pdf-subfolder-row');

  let pdfPollTimer = null;

  function updateSaveAsUI(saveAs) {
    if (pdfSaveAsToggle) pdfSaveAsToggle.checked = saveAs;
    if (pdfSubfolderRow) {
      pdfSubfolderRow.style.opacity = saveAs ? '0.45' : '1';
      if (pdfSubfolderInput) pdfSubfolderInput.disabled = saveAs;
    }
  }

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ pdfSaveAs: false, pdfSubfolder: 'Maxitet' }, (res) => {
      updateSaveAsUI(res.pdfSaveAs);
      if (pdfSubfolderInput) pdfSubfolderInput.value = res.pdfSubfolder || 'Maxitet';
    });
  }

  if (pdfSaveAsToggle) {
    pdfSaveAsToggle.addEventListener('change', () => {
      const val = pdfSaveAsToggle.checked;
      updateSaveAsUI(val);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pdfSaveAs: val });
      }
    });
  }

  if (pdfSubfolderInput) {
    pdfSubfolderInput.addEventListener('change', () => {
      const val = pdfSubfolderInput.value.trim();
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pdfSubfolder: val });
      }
    });
  }

  function showPdfStatus(text, type = '') {
    if (!pdfStatus) return;
    pdfStatus.textContent = text;
    pdfStatus.style.display = 'block';
    pdfStatus.className = type;
  }

  async function syncPdfDownloadStatus() {
    try {
      const status = await sendToContent({ type: 'GET_PRESENTATION_DOWNLOAD_STATUS' }).catch(() => null);
      if (!status) return;

      const span = downloadBtn ? downloadBtn.querySelector('span') : null;

      if (status.isDownloading) {
        if (downloadBtn) downloadBtn.disabled = true;
        if (span) span.textContent = 'Загрузка в фоне…';
        if (pdfProgressContainer) pdfProgressContainer.style.display = 'block';
        if (pdfStatus) pdfStatus.style.display = 'none';

        const percent = Math.min(100, Math.max(0, status.percent || 0));
        if (pdfProgressFill) {
          pdfProgressFill.style.width = `${percent}%`;
          pdfProgressFill.textContent = `${percent}%`;
        }
        if (pdfProgressText) {
          pdfProgressText.textContent = status.statusText || `Загрузка: ${status.current || 0} из ${status.total || 0} слайдов`;
        }

        if (!pdfPollTimer) {
          pdfPollTimer = setInterval(syncPdfDownloadStatus, 600);
        }
      } else {
        if (pdfPollTimer) {
          clearInterval(pdfPollTimer);
          pdfPollTimer = null;
        }

        if (downloadBtn) downloadBtn.disabled = false;
        if (span) span.textContent = 'Скачать PDF';

        if (status.finished) {
          if (status.success) {
            if (pdfProgressFill) {
              pdfProgressFill.style.width = '100%';
              pdfProgressFill.textContent = '100%';
            }
            showPdfStatus(status.statusText || `Готово! Скачано в файл «${status.fileName}»`, 'success');
          } else if (status.error) {
            showPdfStatus(status.statusText || `Ошибка: ${status.error}`, 'error');
          }
        }
      }
    } catch (e) {
      // Content script not ready or active tab closed
    }
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      const saveAs = pdfSaveAsToggle ? pdfSaveAsToggle.checked : false;
      const subfolder = pdfSubfolderInput ? pdfSubfolderInput.value.trim() : 'Maxitet';

      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ pdfSaveAs: saveAs, pdfSubfolder: subfolder });
      }

      downloadBtn.disabled = true;
      const span = downloadBtn.querySelector('span');
      if (span) span.textContent = 'Запуск…';
      if (pdfProgressContainer) pdfProgressContainer.style.display = 'block';
      if (pdfStatus) pdfStatus.style.display = 'none';
      if (pdfProgressFill) {
        pdfProgressFill.style.width = '0%';
        pdfProgressFill.textContent = '0%';
      }
      if (pdfProgressText) {
        pdfProgressText.textContent = 'Запуск фонового скачивания на странице…';
      }

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('vision.maximumtest.ru')) {
          showPdfStatus('Ошибка: откройте урок на vision.maximumtest.ru', 'error');
          downloadBtn.disabled = false;
          if (span) span.textContent = 'Скачать PDF';
          return;
        }

        const res = await sendToContent({
          type: 'START_PRESENTATION_DOWNLOAD',
          options: { saveAs, subfolder }
        });

        if (res?.error) {
          showPdfStatus(`Ошибка: ${res.error}`, 'error');
          downloadBtn.disabled = false;
          if (span) span.textContent = 'Скачать PDF';
          return;
        }

        if (span) span.textContent = 'Загрузка в фоне…';
        showToast('Скачивание запущено в фоне. Попап можно закрывать!', 'info');

        if (!pdfPollTimer) {
          pdfPollTimer = setInterval(syncPdfDownloadStatus, 600);
        }
      } catch (err) {
        showPdfStatus(`Ошибка: ${err.message}`, 'error');
        downloadBtn.disabled = false;
        if (span) span.textContent = 'Скачать PDF';
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
