(() => {
  'use strict';

  // ─── Subframe (iframe) Hotkey & Context Menu Forwarder ──────
  if (window !== window.top) {
    const isInput = (el) => el && (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable ||
      (typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]'))
    );

    const handleSubframeKeyDown = (e) => {
      const target = e.target;
      const activeEl = document.activeElement;
      if (isInput(target)) return;
      if (isInput(activeEl)) {
        if (activeEl && typeof activeEl.blur === 'function') activeEl.blur();
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const code = e.code;
      const key = (e.key || '').toLowerCase();

      if (
        code === 'KeyZ' || key === 'z' || key === 'я' ||
        code === 'KeyD' || key === 'd' || key === 'в' ||
        code === 'KeyS' || key === 's' || key === 'ы'
      ) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        try {
          window.top.postMessage({
            type: 'MAXITET_FORWARD_HOTKEY',
            code: code,
            key: key,
          }, '*');
        } catch (_) {}
      }
    };

    window.addEventListener('keydown', handleSubframeKeyDown, true);
    document.addEventListener('keydown', handleSubframeKeyDown, true);

    const unblockSubframeCtx = (e) => {
      e.stopImmediatePropagation();
    };
    window.addEventListener('contextmenu', unblockSubframeCtx, true);
    document.addEventListener('contextmenu', unblockSubframeCtx, true);

    return; // Subframe завершает работу здесь
  }

  // ─── State ────────────────────────────────────────────────
  let activeWindow = null;       // активное окно (PiP или Clean Window)
  let activeWindowType = null;   // 'pip' | 'window'
  let renderFrameId = null;
  let activeSourceMedia = null;  // { type: 'video' | 'presentation', element, label }
  let activeVideoIndex = -1;     // number | 'presentation'
  let activeViewerUpdateDarkMode = () => {};
  let isSmartDarkModeActive = false;
  let currentSmartDarkPreset = 'maxitet';
  let handleKeyDown = null;

  const SMART_DARK_PRESETS = {
    maxitet: {
      id: 'maxitet',
      name: 'Maxitet',
      title: 'Фирменный Maxitet',
      filter: 'url(#maxitet-dark-maxitet)',
      bgColor: '#0f1015'
    },
    contrast: {
      id: 'contrast',
      name: 'Контраст',
      title: 'Глубокий чёрный',
      filter: 'url(#maxitet-dark-contrast)',
      bgColor: '#000000'
    },
    soft: {
      id: 'soft',
      name: 'Мягкий',
      title: 'Мягкий тёмный',
      filter: 'url(#maxitet-dark-soft)',
      bgColor: '#181b22'
    },
    invert: {
      id: 'invert',
      name: 'Инверсия',
      title: 'Классический негатив',
      filter: 'invert(0.9) hue-rotate(180deg) contrast(1.1) brightness(0.95)',
      bgColor: '#0c0c10'
    }
  };

  function injectSvgFilters(targetDoc = document) {
    if (!targetDoc) return;
    if (targetDoc.getElementById('maxitet-dark-filters')) return;
    const svg = targetDoc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'maxitet-dark-filters';
    svg.setAttribute('style', 'position: absolute; width: 0; height: 0; pointer-events: none; overflow: hidden;');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <defs>
        <filter id="maxitet-dark-maxitet" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="
            -0.1142  0.0523 -0.8181 0 0.9400
            -2.1488  1.8963 -0.6275 0 0.9400
            -1.1229 -0.0009  0.2638 0 0.9400
            0        0       0       1 0" />
        </filter>
        <filter id="maxitet-dark-contrast" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="
            -0.3258  0.2277 -0.9019 0 1.0000
            -2.3363  2.0177 -0.6814 0 1.0000
            -1.5245  0.2381  0.2864 0 1.0000
            0        0       0       1 0" />
        </filter>
        <filter id="maxitet-dark-soft" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="
            -0.1442  0.0471 -0.6529 0 0.8500
            -1.8900  1.6126 -0.4726 0 0.8600
            -0.8919 -0.0194  0.1713 0 0.8800
            0        0       0       1 0" />
        </filter>
      </defs>
    `;
    const root = targetDoc.body || targetDoc.documentElement;
    if (root) root.appendChild(svg);
  }

  // View state (в координатах видео / слайда)
  const view = {
    zoom: 1,
    cropX: 0,
    cropY: 0,
    cropW: 0,
    cropH: 0,
  };

  // Кеш данных презентации из Pinia store (передаются из stealth.js через postMessage)
  let cachedPresentationStore = null;

  // ─── Toasts & Notifications ───────────────────────────────
  const SVG_TOAST_CAMERA = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  const SVG_TOAST_LOCK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const SVG_TOAST_ZEN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  const SVG_TOAST_FREEZE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`;
  const SVG_TOAST_MOON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  const SVG_TOAST_SUN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const SVG_TOAST_DOWNLOAD = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  function showFloatingToast(msg, iconSvg = SVG_TOAST_LOCK) {
    const existing = document.getElementById('maxitet-floating-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'maxitet-floating-toast';

    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = 'display:inline-flex;align-items:center;opacity:0.85;';
    iconSpan.innerHTML = iconSvg;

    const textSpan = document.createElement('span');
    textSpan.textContent = msg;

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    toast.style.cssText = `
      position: fixed;
      bottom: 85px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(28, 30, 31, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.16);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12.5px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 2147483647;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.7);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: opacity 0.25s ease, transform 0.25s ease;
      letter-spacing: -0.1px;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(4px)';
      setTimeout(() => toast.remove(), 250);
    }, 2200);
  }

  function showMicToast(msg) {
    showFloatingToast(msg, SVG_TOAST_LOCK);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'MAXITET_PRESENTATION_STORE_DATA') {
      cachedPresentationStore = event.data.data;
    }
    if (event.data.type === 'MAXITET_RECORD_STATUS') {
      if (event.data.status === 'recording') {
        showFloatingToast(`Запись вебки: ${event.data.secondsLeft} сек...`, SVG_TOAST_FREEZE);
      } else if (event.data.status === 'done') {
        showFloatingToast('Вебкамера зациклена и сохранена (3 сек)', SVG_TOAST_FREEZE);
      } else if (event.data.status === 'waiting_camera') {
        showFloatingToast('Включите камеру в вебинаре для записи 3 сек', SVG_TOAST_FREEZE);
      }
    }
    if (event.data.type === 'MAXITET_SAVE_LOOP_FRAMES' && Array.isArray(event.data.frames)) {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          freezeCamLoopFrames: event.data.frames,
          freezeCamHasSavedLoop: true,
        });
      }
    }
    if (event.data.type === 'MAXITET_PHOTO_STATUS') {
      if (event.data.status === 'done') {
        showFloatingToast('Стоп-кадр вебки сохранён', SVG_TOAST_FREEZE);
      } else if (event.data.status === 'waiting_camera') {
        showFloatingToast('Включите камеру в вебинаре для снимка', SVG_TOAST_FREEZE);
      }
    }
    if (event.data.type === 'MAXITET_SAVE_PHOTO' && event.data.dataUrl) {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          freezeCamPhoto: event.data.dataUrl,
        });
      }
    }
    if (event.data.type === 'MAXITET_FORWARD_HOTKEY') {
      const fakeEvent = {
        code: event.data.code,
        key: event.data.key,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        target: document.body,
        preventDefault: () => {},
        stopPropagation: () => {},
      };
      if (typeof handleKeyDown === 'function') {
        handleKeyDown(fakeEvent);
      }
    }
  });

  function requestPresentationStore() {
    window.postMessage({ type: 'MAXITET_GET_PRESENTATION_STORE' }, '*');
  }
  setInterval(requestPresentationStore, 2000);
  requestPresentationStore();

  // ─── Video & Presentation Discovery & Classification ──────

  function isElementVisible(el) {
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      el = el.parentElement;
    }
    return true;
  }

  function getActivePresentationElement() {
    // В М.Класс активная страница презентации находится в .viewer-main-img__img или .viewer img
    const img = document.querySelector('.viewer-main-img__img') || document.querySelector('.viewer img');
    if (img && isElementVisible(img) && (img.src || img.currentSrc)) {
      return img;
    }
    return null;
  }

  function classifyVideo(video) {
    // М.Класс (vision.maximumtest.ru)
    if (video.classList.contains('sharing__screen-share-video')) {
      return { label: 'Демонстрация экрана', type: 'screen', priority: 0 };
    }
    if (video.closest('.users-area__self-frame')) {
      return { label: 'Моя вебка', type: 'self-cam', priority: 3 };
    }
    if (video.closest('.users-area__host-frame')) {
      return { label: 'Вебка преподавателя', type: 'host-cam', priority: 1 };
    }
    if (video.classList.contains('user-frame__self-video')) {
      return { label: 'Вебка участника', type: 'participant-cam', priority: 2 };
    }
    if (video.classList.contains('virtual-background__video-el')) {
      return { label: 'Виртуальный фон', type: 'virtual-bg', priority: 4 };
    }

    // Google Meet
    if (video.closest('[data-participant-id]')) {
      return { label: 'Участник (Meet)', type: 'participant-cam', priority: 2 };
    }
    if (video.closest('[data-self-name]')) {
      return { label: 'Моя вебка (Meet)', type: 'self-cam', priority: 3 };
    }

    // Универсальная эвристика по размеру
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    const viewportArea = window.innerWidth * window.innerHeight;

    if (area > viewportArea * 0.3) {
      return { label: 'Большое видео (демонстрация)', type: 'screen-guess', priority: 0 };
    }
    if (area > viewportArea * 0.05) {
      return { label: 'Среднее видео', type: 'medium', priority: 2 };
    }
    return { label: 'Малое видео', type: 'small', priority: 3 };
  }

  function discoverVideos() {
    const result = [];

    // 1. Презентация М.Класс (если открыта в режиме слайдов)
    const presImg = getActivePresentationElement();
    if (presImg) {
      const rect = presImg.getBoundingClientRect();
      result.push({
        index: 'presentation',
        label: 'Презентация урока',
        type: 'screen',
        priority: -1,
        width: presImg.naturalWidth || Math.round(rect.width) || 1920,
        height: presImg.naturalHeight || Math.round(rect.height) || 1080,
      });
    }

    // 2. Видеопотоки WebRTC (вебкамеры, шаринг экрана)
    const allVideos = document.querySelectorAll('video');
    allVideos.forEach((video, index) => {
      if (!isElementVisible(video)) return;
      const hasContent = video.readyState >= 1 || video.srcObject || video.src;
      if (!hasContent) return;

      const classification = classifyVideo(video);
      const rect = video.getBoundingClientRect();

      result.push({
        index,
        label: classification.label,
        type: classification.type,
        priority: classification.priority,
        width: video.videoWidth || Math.round(rect.width),
        height: video.videoHeight || Math.round(rect.height),
      });
    });

    result.sort((a, b) => a.priority - b.priority);
    return result;
  }

  function captureFrame(videoIndex) {
    if (videoIndex === 'presentation') {
      const presImg = getActivePresentationElement();
      if (!presImg) return null;

      try {
        const canvas = document.createElement('canvas');
        const thumbWidth = 280;
        const pw = presImg.naturalWidth || presImg.clientWidth || 280;
        const ph = presImg.naturalHeight || presImg.clientHeight || 158;
        const aspect = pw / ph;

        canvas.width = thumbWidth;
        canvas.height = Math.round(thumbWidth / aspect);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(presImg, 0, 0, canvas.width, canvas.height);

        // Накладываем белую доску (рисование преподавателя), если доступна
        try {
          const frame = document.getElementById('paint-frame');
          const paintCanvas = frame?.contentDocument?.getElementById('paint-canvas');
          if (paintCanvas && paintCanvas.width > 0 && paintCanvas.height > 0) {
            ctx.drawImage(paintCanvas, 0, 0, canvas.width, canvas.height);
          }
        } catch (e) {}

        return canvas.toDataURL('image/jpeg', 0.7);
      } catch (e) {
        return presImg.currentSrc || presImg.src || null;
      }
    }

    const allVideos = document.querySelectorAll('video');
    const video = allVideos[videoIndex];
    if (!video) return null;

    try {
      const canvas = document.createElement('canvas');
      const thumbWidth = 280;
      const vw = video.videoWidth || video.clientWidth || 280;
      const vh = video.videoHeight || video.clientHeight || 158;
      const aspect = vw / vh;

      canvas.width = thumbWidth;
      canvas.height = Math.round(thumbWidth / aspect);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      return null;
    }
  }

  // ─── Window Lifecycle ────────────────────────────────────

  function getActiveSourceDims() {
    if (activeSourceMedia) {
      if (activeSourceMedia.type === 'presentation') {
        const img = getActivePresentationElement() || activeSourceMedia.element;
        return {
          w: img.naturalWidth || img.clientWidth || 1920,
          h: img.naturalHeight || img.clientHeight || 1080,
        };
      } else if (activeSourceMedia.element) {
        return {
          w: activeSourceMedia.element.videoWidth || 1920,
          h: activeSourceMedia.element.videoHeight || 1080,
        };
      }
    }
    return { w: 1920, h: 1080 };
  }

  function resetView() {
    const dims = getActiveSourceDims();
    view.zoom = 1;
    view.cropX = 0;
    view.cropY = 0;
    view.cropW = dims.w;
    view.cropH = dims.h;
  }

  function closeActiveWindow() {
    document.body.classList.remove('maxitet-pip-active');
    if (renderFrameId) {
      if (activeWindow && !activeWindow.closed) {
        try { activeWindow.cancelAnimationFrame(renderFrameId); } catch (e) {}
      }
      try { cancelAnimationFrame(renderFrameId); } catch (e) {}
      renderFrameId = null;
    }
    if (activeWindow && !activeWindow.closed) {
      activeWindow.close();
    }
    activeWindow = null;
    activeWindowType = null;
    activeSourceMedia = null;
    activeVideoIndex = -1;
    activeViewerUpdateDarkMode = () => {};
    resetView();
  }

  // ─── 1. Open Clean Window (100% / Snap / Resizable) ─────

  function openCleanWindow(videoIndex) {
    let sourceMedia = null;
    let label = 'Видео';

    if (videoIndex === 'presentation') {
      const presImg = getActivePresentationElement();
      if (!presImg) return { error: 'Презентация не найдена на странице' };
      sourceMedia = { type: 'presentation', element: presImg, label: 'Презентация урока' };
      label = 'Презентация урока';
    } else {
      const allVideos = document.querySelectorAll('video');
      const sourceVideo = allVideos[videoIndex];
      if (!sourceVideo) return { error: 'Видео не найдено' };
      const classification = classifyVideo(sourceVideo);
      sourceMedia = { type: 'video', element: sourceVideo, label: classification.label };
      label = classification.label;
    }

    closeActiveWindow();

    activeSourceMedia = sourceMedia;
    activeVideoIndex = videoIndex;
    activeWindowType = 'window';
    resetView();

    const dims = getActiveSourceDims();
    const vw = dims.w;
    const vh = dims.h;
    const aspect = vw / vh;

    // Начальный размер — 80% от экрана или половина экрана под IDE
    const screenW = window.screen.availWidth;
    const screenH = window.screen.availHeight;
    const initW = Math.min(1600, Math.round(screenW * 0.75));
    const initH = Math.min(screenH, Math.round(initW / aspect));
    const left = Math.round((screenW - initW) / 2);
    const top = Math.round((screenH - initH) / 2);

    const win = window.open(
      '',
      '_blank',
      `popup=yes,width=${initW},height=${initH},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
    );

    if (!win) {
      closeActiveWindow();
      return {
        error: 'Всплывающее окно заблокировано браузером. Нажмите на значок щита/замка в адресной строке и разрешите всплывающие окна для этого сайта.'
      };
    }

    activeWindow = win;
    document.body.classList.add('maxitet-pip-active');
    win.document.title = 'Lecture — ' + label;
    setupViewer(win, sourceMedia, false);

    win.addEventListener('beforeunload', () => {
      closeActiveWindow();
    });

    return { success: true };
  }

  // ─── 2. Open Document PiP (Always on Top) ───────────────

  async function openPiP(videoIndex) {
    if (!('documentPictureInPicture' in window)) {
      return { error: 'Document PiP API не поддерживается (нужен Brave/Chrome 116+)' };
    }

    let sourceMedia = null;
    let label = 'Видео';

    if (videoIndex === 'presentation') {
      const presImg = getActivePresentationElement();
      if (!presImg) return { error: 'Презентация не найдена на странице' };
      sourceMedia = { type: 'presentation', element: presImg, label: 'Презентация урока' };
      label = 'Презентация урока';
    } else {
      const allVideos = document.querySelectorAll('video');
      const sourceVideo = allVideos[videoIndex];
      if (!sourceVideo) return { error: 'Видео не найдено' };
      const classification = classifyVideo(sourceVideo);
      sourceMedia = { type: 'video', element: sourceVideo, label: classification.label };
      label = classification.label;
    }

    closeActiveWindow();

    activeSourceMedia = sourceMedia;
    activeVideoIndex = videoIndex;
    activeWindowType = 'pip';
    resetView();

    const dims = getActiveSourceDims();
    const vw = dims.w;
    const vh = dims.h;
    const aspect = vw / vh;

    const maxW = Math.round(window.screen.availWidth * 0.8);
    const maxH = Math.round(window.screen.availHeight * 0.8);

    let initW = maxW;
    let initH = Math.round(initW / aspect);
    if (initH > maxH) {
      initH = maxH;
      initW = Math.round(initH * aspect);
    }

    try {
      const win = await window.documentPictureInPicture.requestWindow({
        width: initW,
        height: initH,
        preferInitialWindowPlacement: true,
      });

      activeWindow = win;
      document.body.classList.add('maxitet-pip-active');
      setupViewer(win, sourceMedia, true);

      win.addEventListener('pagehide', () => {
        closeActiveWindow();
      });

      return { success: true };
    } catch (e) {
      closeActiveWindow();
      return { error: `Не удалось открыть PiP: ${e.message}` };
    }
  }

  // ─── Setup Shared Viewer UI & Events ─────────────────────

  function setupViewer(win, sourceMedia, isPiP) {
    const doc = win.document;
    injectSvgFilters(doc);

    // Стили
    const style = doc.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      #maxitet-side-dock { display: none !important; }
      html, body {
        width: 100%;
        height: 100%;
        background: #0d0d12;
        overflow: hidden;
        user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #container {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #canvas {
        display: block;
        width: 100%;
        height: 100%;
        cursor: default;
      }
      #canvas.can-drag { cursor: grab; }
      #canvas.is-dragging { cursor: grabbing; }
      #canvas.crop-mode { cursor: crosshair; }

      /* Прямоугольник выделения области */
      #crop-selection {
        position: absolute;
        border: 2px dashed #ff8c32;
        background: rgba(255, 140, 50, 0.18);
        pointer-events: none;
        display: none;
        z-index: 50;
      }

      /* Панель управления */
      #toolbar {
        position: fixed;
        bottom: 14px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(18, 18, 28, 0.92);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 140, 50, 0.35);
        border-radius: 12px;
        padding: 6px 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75);
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 100;
        pointer-events: none;
        max-width: calc(100% - 20px);
        overflow-x: auto;
        scrollbar-width: none;
      }
      #toolbar::-webkit-scrollbar { display: none; }
      body:hover #toolbar, body.toolbar-pinned #toolbar {
        opacity: 1;
        pointer-events: auto;
      }

      .btn {
        height: 28px;
        padding: 0 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.08);
        color: #e0e0e0;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.15s;
        white-space: nowrap;
      }
      .btn:hover {
        background: rgba(255, 140, 50, 0.25);
        border-color: rgba(255, 140, 50, 0.45);
        color: #fff;
      }
      .btn:active { transform: scale(0.97); }
      .btn.active {
        background: #ff8c32;
        color: #000;
        border-color: #ff8c32;
        font-weight: 600;
      }

      .btn-icon {
        width: 28px;
        padding: 0;
        justify-content: center;
        font-size: 14px;
      }

      .zoom-indicator {
        color: #ff8c32;
        font-size: 12px;
        font-weight: 600;
        min-width: 44px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .separator {
        width: 1px;
        height: 18px;
        background: rgba(255, 255, 255, 0.15);
      }

      #crop-hint {
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 140, 50, 0.95);
        color: #000;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        display: none;
        z-index: 100;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      }

      #win-toast {
        position: fixed;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(18, 18, 28, 0.95);
        color: #ff8c32;
        border: 1px solid rgba(255, 140, 50, 0.4);
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        display: none;
        z-index: 100;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        transition: opacity 0.25s ease;
      }
    `;
    doc.head.appendChild(style);

    // Разметка
    doc.body.innerHTML = `
      <div id="container">
        <canvas id="canvas"></canvas>
        <div id="crop-selection"></div>
        <div id="crop-hint">Зажмите ЛКМ и выделите область кода</div>
        <div id="win-toast"></div>

        <div id="toolbar">
          <button id="btn-crop" class="btn" title="Выделить прямоугольником нужную область кадра">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>
            <span>Область</span>
          </button>
          <div class="separator"></div>
          <button id="btn-zoom-out" class="btn btn-icon" title="Отдалить (−) [шаг 1%, Shift — 5%]">−</button>
          <span id="zoom-label" class="zoom-indicator">100%</span>
          <button id="btn-zoom-in" class="btn btn-icon" title="Приблизить (+) [шаг 1%, Shift — 5%]">+</button>
          <button id="btn-reset" class="btn btn-icon" title="Сбросить масштаб и кроп">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          </button>
          <div class="separator"></div>
          <button id="btn-fit-mode" class="btn btn-icon active" title="Режим: Без чёрных полос (Заполнение окна) [F]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
          </button>
          <button id="btn-dark-mode" class="btn btn-icon" title="Тёмная тема слайдов (D)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
          </button>
          <button id="btn-screenshot" class="btn btn-icon" title="Сделать скриншот в буфер обмена (S)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
        </div>
      </div>
    `;

    // Для видеопотока в отдельном окне создаём локальный video с тем же MediaStream
    let videoToRender = null;
    if (sourceMedia.type === 'video') {
      const sourceVideo = sourceMedia.element;
      videoToRender = sourceVideo;
      if (sourceVideo.srcObject) {
        try {
          const localVideo = doc.createElement('video');
          localVideo.muted = true;
          localVideo.autoplay = true;
          localVideo.playsInline = true;
          localVideo.style.display = 'none';
          doc.body.appendChild(localVideo);
          localVideo.srcObject = sourceVideo.srcObject;
          localVideo.play().catch(() => {});
          videoToRender = localVideo;
        } catch (e) {
          videoToRender = sourceVideo;
        }
      }
    }

    const canvas = doc.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const selection = doc.getElementById('crop-selection');
    const cropHint = doc.getElementById('crop-hint');
    const btnCrop = doc.getElementById('btn-crop');
    const btnZoomIn = doc.getElementById('btn-zoom-in');
    const btnZoomOut = doc.getElementById('btn-zoom-out');
    const btnReset = doc.getElementById('btn-reset');
    const zoomLabel = doc.getElementById('zoom-label');

    let isCropMode = false;
    let isSelecting = false;
    let selStartX = 0, selStartY = 0;

    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let dragStartCropX = 0, dragStartCropY = 0;

    let lastDraw = { dx: 0, dy: 0, dw: 0, dh: 0 };

    function getCurrentMediaDims() {
      if (sourceMedia.type === 'presentation') {
        const currentImg = getActivePresentationElement() || sourceMedia.element;
        return {
          w: currentImg.naturalWidth || currentImg.clientWidth || 1920,
          h: currentImg.naturalHeight || currentImg.clientHeight || 1080,
        };
      }
      const v = videoToRender || sourceMedia.element;
      return {
        w: v.videoWidth || sourceMedia.element.videoWidth || 1920,
        h: v.videoHeight || sourceMedia.element.videoHeight || 1080,
      };
    }

    let fitMode = 'cover'; // 'cover' (без чёрных полос, заполняет всё окно) | 'contain' (с полосами, весь кадр)

    function getBaseCropDims(vw, vh, winW, winH, mode) {
      if (mode === 'contain') {
        return { w: vw, h: vh };
      }
      const winAspect = winW / winH;
      const mediaAspect = vw / vh;
      if (winAspect < mediaAspect) {
        // Окно более вертикальное/узкое, чем видео (например, 9:16 окно на 16:9 видео)
        return { w: Math.round(vh * winAspect), h: vh };
      } else {
        // Окно шире, чем видео (например, 21:9 окно на 16:9 видео)
        return { w: vw, h: Math.round(vw / winAspect) };
      }
    }

    function resetView() {
      const dims = getCurrentMediaDims();
      const vw = dims.w;
      const vh = dims.h;
      const winW = win.innerWidth;
      const winH = win.innerHeight;

      view.zoom = 1;
      const base = getBaseCropDims(vw, vh, winW, winH, fitMode);
      view.cropW = base.w;
      view.cropH = base.h;
      view.cropX = Math.max(0, Math.round((vw - base.w) / 2));
      view.cropY = Math.max(0, Math.round((vh - base.h) / 2));
    }

    function syncCropToWindow() {
      const dims = getCurrentMediaDims();
      const vw = dims.w;
      const vh = dims.h;
      const winW = win.innerWidth;
      const winH = win.innerHeight;
      if (winW <= 0 || winH <= 0 || vw <= 0 || vh <= 0) return;

      const base = getBaseCropDims(vw, vh, winW, winH, fitMode);
      const currentCenterX = view.cropW > 0 ? (view.cropX + view.cropW / 2) : (vw / 2);
      const currentCenterY = view.cropH > 0 ? (view.cropY + view.cropH / 2) : (vh / 2);

      const newCropW = Math.min(vw, Math.max(20, Math.round(base.w / view.zoom)));
      const newCropH = Math.min(vh, Math.max(20, Math.round(base.h / view.zoom)));

      const maxCropX = Math.max(0, vw - newCropW);
      const maxCropY = Math.max(0, vh - newCropH);

      view.cropW = newCropW;
      view.cropH = newCropH;
      view.cropX = Math.max(0, Math.min(maxCropX, Math.round(currentCenterX - newCropW / 2)));
      view.cropY = Math.max(0, Math.min(maxCropY, Math.round(currentCenterY - newCropH / 2)));
      updateZoomUI();
    }

    function canPanNow() {
      const dims = getCurrentMediaDims();
      return !isCropMode && (view.zoom > 1 || (dims.w - view.cropW) > 1 || (dims.h - view.cropH) > 1);
    }

    function updateZoomUI() {
      zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
      canvas.classList.toggle('can-drag', canPanNow());
    }

    // ─── Рендеринг ──────────────────────────────────────────

    function render() {
      if (win.closed) {
        closeActiveWindow();
        return;
      }

      const dims = getCurrentMediaDims();
      const vw = dims.w;
      const vh = dims.h;
      const winW = win.innerWidth;
      const winH = win.innerHeight;

      if (canvas.width !== winW || canvas.height !== winH) {
        canvas.width = winW;
        canvas.height = winH;
      }

      const presetCfg = SMART_DARK_PRESETS[currentSmartDarkPreset] || SMART_DARK_PRESETS.maxitet;
      ctx.fillStyle = isSmartDarkModeActive && sourceMedia.type === 'presentation'
        ? presetCfg.bgColor
        : '#0d0d12';
      ctx.fillRect(0, 0, winW, winH);

      if (view.cropW === 0 || view.cropH === 0) {
        resetView();
      }

      const scale = fitMode === 'cover'
        ? Math.max(winW / view.cropW, winH / view.cropH)
        : Math.min(winW / view.cropW, winH / view.cropH);

      const dw = view.cropW * scale;
      const dh = view.cropH * scale;
      const dx = (winW - dw) / 2;
      const dy = (winH - dh) / 2;

      lastDraw = { dx, dy, dw, dh };

      if (sourceMedia.type === 'presentation') {
        const currentImg = getActivePresentationElement() || sourceMedia.element;
        if (isSmartDarkModeActive) {
          canvas.style.filter = presetCfg.filter;
        } else {
          canvas.style.filter = 'none';
        }
        ctx.filter = 'none';
        try {
          ctx.drawImage(
            currentImg,
            view.cropX, view.cropY, view.cropW, view.cropH,
            dx, dy, dw, dh
          );
        } catch (e) {}

        // Белая доска учителя
        try {
          const frame = document.getElementById('paint-frame');
          const paintCanvas = frame?.contentDocument?.getElementById('paint-canvas');
          if (paintCanvas && paintCanvas.width > 0 && paintCanvas.height > 0) {
            ctx.drawImage(
              paintCanvas,
              view.cropX, view.cropY, view.cropW, view.cropH,
              dx, dy, dw, dh
            );
          }
        } catch (e) {}
      } else {
        canvas.style.filter = 'none';
        ctx.filter = 'none';
        const v = videoToRender || sourceMedia.element;
        try {
          ctx.drawImage(
            v,
            view.cropX, view.cropY, view.cropW, view.cropH,
            dx, dy, dw, dh
          );
        } catch (e) {}
      }

      // requestAnimationFrame вызывается именно у ПОПАП-ОКНА (win)
      renderFrameId = win.requestAnimationFrame(render);
    }

    resetView();
    render();

    win.addEventListener('resize', () => {
      syncCropToWindow();
      render();
    });

    // ─── Зум в точку курсора (шаг 1%) ───────────────────────

    function zoomAtPoint(clientX, clientY, targetZoomOrFactor, isFactor = false) {
      const dims = getCurrentMediaDims();
      const vw = dims.w;
      const vh = dims.h;
      const winW = win.innerWidth;
      const winH = win.innerHeight;

      const relX = clientX - lastDraw.dx;
      const relY = clientY - lastDraw.dy;

      const normX = lastDraw.dw > 0 ? Math.max(0, Math.min(1, relX / lastDraw.dw)) : 0.5;
      const normY = lastDraw.dh > 0 ? Math.max(0, Math.min(1, relY / lastDraw.dh)) : 0.5;

      const videoX = view.cropX + normX * view.cropW;
      const videoY = view.cropY + normY * view.cropH;

      let newZoom = isFactor ? (view.zoom * targetZoomOrFactor) : targetZoomOrFactor;
      newZoom = Math.round(newZoom * 100) / 100;
      newZoom = Math.max(1, Math.min(10, newZoom));

      if (newZoom <= 1 && fitMode === 'contain') {
        resetView();
        updateZoomUI();
        return;
      }

      const base = getBaseCropDims(vw, vh, winW, winH, fitMode);
      const newCropW = Math.min(vw, Math.max(20, Math.round(base.w / newZoom)));
      const newCropH = Math.min(vh, Math.max(20, Math.round(base.h / newZoom)));

      let newCropX = Math.round(videoX - normX * newCropW);
      let newCropY = Math.round(videoY - normY * newCropH);

      const maxCropX = Math.max(0, vw - newCropW);
      const maxCropY = Math.max(0, vh - newCropH);

      newCropX = Math.max(0, Math.min(maxCropX, newCropX));
      newCropY = Math.max(0, Math.min(maxCropY, newCropY));

      view.zoom = newZoom;
      view.cropW = newCropW;
      view.cropH = newCropH;
      view.cropX = newCropX;
      view.cropY = newCropY;

      updateZoomUI();
    }

    // ─── Колёсико мыши — зум в курсор (шаг 1%, Shift — 5%) ───

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (isCropMode) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      const targetZoom = e.deltaY < 0 ? (view.zoom + step) : (view.zoom - step);
      zoomAtPoint(e.clientX, e.clientY, targetZoom, false);
    }, { passive: false });

    // ─── Перетаскивание кадра / Выделение рамки ────────────

    canvas.addEventListener('mousedown', (e) => {
      if (isCropMode) {
        isSelecting = true;
        selStartX = e.clientX;
        selStartY = e.clientY;
        selection.style.left = `${selStartX}px`;
        selection.style.top = `${selStartY}px`;
        selection.style.width = '0px';
        selection.style.height = '0px';
        selection.style.display = 'block';
        return;
      }

      if (canPanNow() && e.button === 0) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartCropX = view.cropX;
        dragStartCropY = view.cropY;
        canvas.classList.add('is-dragging');
      }
    });

    doc.addEventListener('mousemove', (e) => {
      if (isSelecting) {
        const curX = e.clientX;
        const curY = e.clientY;
        const left = Math.min(selStartX, curX);
        const top = Math.min(selStartY, curY);
        const width = Math.abs(curX - selStartX);
        const height = Math.abs(curY - selStartY);

        selection.style.left = `${left}px`;
        selection.style.top = `${top}px`;
        selection.style.width = `${width}px`;
        selection.style.height = `${height}px`;
        return;
      }

      if (isDragging) {
        const dims = getCurrentMediaDims();
        const vw = dims.w;
        const vh = dims.h;
        const scale = lastDraw.dw / view.cropW;

        const deltaVideoX = (e.clientX - dragStartX) / scale;
        const deltaVideoY = (e.clientY - dragStartY) / scale;

        let newX = dragStartCropX - deltaVideoX;
        let newY = dragStartCropY - deltaVideoY;

        newX = Math.max(0, Math.min(vw - view.cropW, newX));
        newY = Math.max(0, Math.min(vh - view.cropH, newY));

        view.cropX = newX;
        view.cropY = newY;
      }
    });

    doc.addEventListener('mouseup', (e) => {
      if (isSelecting) {
        isSelecting = false;
        selection.style.display = 'none';

        const curX = e.clientX;
        const curY = e.clientY;
        const boxLeft = Math.min(selStartX, curX);
        const boxTop = Math.min(selStartY, curY);
        const boxW = Math.abs(curX - selStartX);
        const boxH = Math.abs(curY - selStartY);

        if (boxW > 20 && boxH > 20) {
          applyCropBox(boxLeft, boxTop, boxW, boxH);
        }
        setCropMode(false);
        return;
      }

      if (isDragging) {
        isDragging = false;
        canvas.classList.remove('is-dragging');
      }
    });

    // ─── Применение кропа ──────────────────────────────────

    function applyCropBox(boxLeft, boxTop, boxW, boxH) {
      const dims = getCurrentMediaDims();
      const vw = dims.w;
      const vh = dims.h;
      const winW = win.innerWidth;
      const winH = win.innerHeight;

      const normLeft = Math.max(0, (boxLeft - lastDraw.dx) / lastDraw.dw);
      const normTop = Math.max(0, (boxTop - lastDraw.dy) / lastDraw.dh);
      const normW = Math.min(1 - normLeft, boxW / lastDraw.dw);
      const normH = Math.min(1 - normTop, boxH / lastDraw.dh);

      if (normW <= 0.02 || normH <= 0.02) return;

      const targetX = view.cropX + normLeft * view.cropW;
      const targetY = view.cropY + normTop * view.cropH;
      const targetW = normW * view.cropW;
      const targetH = normH * view.cropH;

      const base = getBaseCropDims(vw, vh, winW, winH, fitMode);
      const winAspect = winW / winH;

      let finalCropW, finalCropH;
      if (fitMode === 'cover') {
        const selAspect = targetW / targetH;
        if (selAspect > winAspect) {
          finalCropW = targetW;
          finalCropH = targetW / winAspect;
        } else {
          finalCropH = targetH;
          finalCropW = targetH * winAspect;
        }
      } else {
        const zoomX = vw / targetW;
        const zoomY = vh / targetH;
        const newZoom = Math.min(10, Math.max(1, Math.min(zoomX, zoomY)));
        finalCropW = vw / newZoom;
        finalCropH = vh / newZoom;
      }

      if (finalCropW > vw) {
        finalCropW = vw;
        finalCropH = fitMode === 'cover' ? vw / winAspect : vh;
      }
      if (finalCropH > vh) {
        finalCropH = vh;
        finalCropW = fitMode === 'cover' ? vh * winAspect : vw;
      }

      finalCropW = Math.round(finalCropW);
      finalCropH = Math.round(finalCropH);

      const centerTargetX = targetX + targetW / 2;
      const centerTargetY = targetY + targetH / 2;

      let finalCropX = Math.round(centerTargetX - finalCropW / 2);
      let finalCropY = Math.round(centerTargetY - finalCropH / 2);

      finalCropX = Math.max(0, Math.min(vw - finalCropW, finalCropX));
      finalCropY = Math.max(0, Math.min(vh - finalCropH, finalCropY));

      const newZoom = Math.min(10, Math.max(1, Math.round((base.w / finalCropW) * 100) / 100));

      view.zoom = newZoom;
      view.cropW = finalCropW;
      view.cropH = finalCropH;
      view.cropX = finalCropX;
      view.cropY = finalCropY;

      updateZoomUI();
    }

    function setCropMode(enabled) {
      isCropMode = enabled;
      btnCrop.classList.toggle('active', enabled);
      cropHint.style.display = enabled ? 'block' : 'none';
      canvas.classList.toggle('crop-mode', enabled);
      canvas.classList.toggle('can-drag', canPanNow() && !enabled);
    }

    btnCrop.addEventListener('click', () => {
      setCropMode(!isCropMode);
    });

    btnZoomIn.addEventListener('click', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      zoomAtPoint(win.innerWidth / 2, win.innerHeight / 2, view.zoom + step, false);
    });

    btnZoomOut.addEventListener('click', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      zoomAtPoint(win.innerWidth / 2, win.innerHeight / 2, view.zoom - step, false);
    });

    btnReset.addEventListener('click', () => {
      resetView();
      setCropMode(false);
      updateZoomUI();
    });

    // ─── Скриншот в буфер обмена ─────────────────────────────

    function showWinToast(msg) {
      const toast = doc.getElementById('win-toast');
      if (!toast) return;
      toast.textContent = msg;
      toast.style.display = 'block';
      toast.style.opacity = '1';
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 250);
      }, 2000);
    }

    async function takeScreenshot() {
      try {
        const dims = getCurrentMediaDims();
        const w = dims.w;
        const h = dims.h;

        const snapCanvas = doc.createElement('canvas');
        snapCanvas.width = w;
        snapCanvas.height = h;
        const sCtx = snapCanvas.getContext('2d');

        if (sourceMedia.type === 'presentation') {
          const currentImg = getActivePresentationElement() || sourceMedia.element;
          let drawImg = currentImg;
          const imgUrl = currentImg.currentSrc || currentImg.src;

          if (imgUrl) {
            const cleanDataUrl = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { target: 'background', type: 'FETCH_IMAGE_BASE64', url: imgUrl },
                (res) => {
                  if (chrome.runtime.lastError || !res || res.error || !res.dataUrl) {
                    resolve(null);
                  } else {
                    resolve(res.dataUrl);
                  }
                }
              );
            });

            if (cleanDataUrl) {
              const tempImg = new Image();
              tempImg.src = cleanDataUrl;
              await new Promise((r) => {
                tempImg.onload = r;
                tempImg.onerror = r;
              });
              drawImg = tempImg;
            }
          }

          sCtx.drawImage(drawImg, 0, 0, w, h);

          try {
            const frame = document.getElementById('paint-frame');
            const paintCanvas = frame?.contentDocument?.getElementById('paint-canvas');
            if (paintCanvas && paintCanvas.width > 0 && paintCanvas.height > 0) {
              // Проверяем на отдельном 1х1 холсте, не заражен ли paintCanvas
              const testC = doc.createElement('canvas');
              testC.width = 1;
              testC.height = 1;
              testC.getContext('2d').drawImage(paintCanvas, 0, 0, 1, 1);
              testC.toDataURL('image/png');
              sCtx.drawImage(paintCanvas, 0, 0, w, h);
            }
          } catch (e) {}
        } else {
          const v = videoToRender || sourceMedia.element;
          sCtx.drawImage(v, 0, 0, w, h);
        }

        snapCanvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            await win.navigator.clipboard.write([
              new win.ClipboardItem({ 'image/png': blob })
            ]);
            showWinToast('Скриншот скопирован в буфер');
          } catch (clipErr) {
            // Если буфер недоступен, скачиваем файлом
            const a = doc.createElement('a');
            a.href = snapCanvas.toDataURL('image/png');
            a.download = `presentation_slide_${Date.now()}.png`;
            a.click();
            showWinToast('Скриншот сохранён в Загрузки');
          }
        }, 'image/png');
      } catch (err) {
        console.error('Screenshot error:', err);
      }
    }

    function updateViewerDarkMode() {
      const btnDark = doc.getElementById('btn-dark-mode');
      const cfg = SMART_DARK_PRESETS[currentSmartDarkPreset] || SMART_DARK_PRESETS.maxitet;
      if (btnDark) {
        btnDark.innerHTML = isSmartDarkModeActive
          ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
          : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
        btnDark.title = isSmartDarkModeActive
          ? `Светлая тема слайдов (D) [Пресет: ${cfg.name}, Shift+D: сменить]`
          : `Тёмная тема слайдов (D) [Пресет: ${cfg.name}]`;
        btnDark.style.color = isSmartDarkModeActive ? '#fbbf24' : '';
      }
      if (sourceMedia.type === 'presentation') {
        canvas.style.filter = isSmartDarkModeActive ? cfg.filter : 'none';
      }
    }
    activeViewerUpdateDarkMode = updateViewerDarkMode;
    updateViewerDarkMode();

    const btnDarkMode = doc.getElementById('btn-dark-mode');
    if (btnDarkMode) {
      btnDarkMode.addEventListener('click', (e) => {
        if (e.shiftKey) {
          cycleSmartDarkPreset();
        } else {
          setSmartDarkMode(!isSmartDarkModeActive);
        }
      });
      btnDarkMode.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cycleSmartDarkPreset();
      });
    }

    const btnFitMode = doc.getElementById('btn-fit-mode');
    function updateFitModeUI() {
      if (!btnFitMode) return;
      if (fitMode === 'cover') {
        btnFitMode.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`;
        btnFitMode.title = 'Режим: Без чёрных полос (Заполнение окна) [F]';
        btnFitMode.classList.add('active');
      } else {
        btnFitMode.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`;
        btnFitMode.title = 'Режим: С полосами (Вписать целиком) [F]';
        btnFitMode.classList.remove('active');
      }
    }
    updateFitModeUI();

    function setFitMode(mode) {
      fitMode = mode;
      updateFitModeUI();
      syncCropToWindow();
      showWinToast(fitMode === 'cover' ? 'Режим: Без чёрных полос (Заполнение)' : 'Режим: С полосами (Вписать целиком)');
    }

    if (btnFitMode) {
      btnFitMode.addEventListener('click', () => {
        setFitMode(fitMode === 'cover' ? 'contain' : 'cover');
      });
    }

    const btnScreenshot = doc.getElementById('btn-screenshot');
    if (btnScreenshot) {
      btnScreenshot.addEventListener('click', takeScreenshot);
    }

    doc.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
        takeScreenshot();
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
        if (e.shiftKey) {
          cycleSmartDarkPreset();
        } else {
          setSmartDarkMode(!isSmartDarkModeActive);
        }
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        setFitMode(fitMode === 'cover' ? 'contain' : 'cover');
      } else if (e.key === '+' || e.key === '=' || e.key === 'Add') {
        const step = e.shiftKey ? 0.05 : 0.01;
        zoomAtPoint(win.innerWidth / 2, win.innerHeight / 2, view.zoom + step, false);
      } else if (e.key === '-' || e.key === '_' || e.key === 'Subtract') {
        const step = e.shiftKey ? 0.05 : 0.01;
        zoomAtPoint(win.innerWidth / 2, win.innerHeight / 2, view.zoom - step, false);
      } else if (e.key === '0') {
        resetView();
        setCropMode(false);
        updateZoomUI();
      }
    });
  }

  // ─── Message Handling ────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'content') return;

    switch (message.type) {
      case 'GET_VIDEOS': {
        const videos = discoverVideos();
        const videosWithThumbs = videos.map(v => ({
          ...v,
          thumbnail: captureFrame(v.index),
        }));
        sendResponse({
          videos: videosWithThumbs,
          activeVideoIndex: activeWindow && !activeWindow.closed ? activeVideoIndex : -1,
          activeWindowType: activeWindow && !activeWindow.closed ? activeWindowType : null,
        });
        break;
      }

      case 'OPEN_WINDOW': {
        const result = openCleanWindow(message.videoIndex);
        sendResponse(result);
        break;
      }

      case 'OPEN_PIP': {
        openPiP(message.videoIndex).then(result => {
          sendResponse(result);
        });
        return true;
      }

      case 'CLOSE_ACTIVE': {
        closeActiveWindow();
        sendResponse({ success: true });
        break;
      }

      case 'SET_STEALTH': {
        window.postMessage({ type: 'LECTURE_PIP_SET_STEALTH', enabled: message.enabled }, '*');
        sendResponse({ success: true });
        break;
      }

      case 'SET_MIC_GUARD': {
        micGuardEnabled = Boolean(message.enabled);
        if (micGuardEnabled && micGuardedBtn && isMicUnmuted(micGuardedBtn)) {
          micGuardedBtn.click();
          showMicToast('Микрофон выключен (предохранитель включён)');
        }
        sendResponse({ success: true });
        break;
      }

      case 'SET_FREEZE_MODE': {
        window.postMessage({ type: 'MAXITET_SET_FREEZE_MODE', mode: message.mode }, '*');
        showFloatingToast(
          message.mode === 'photo' ? 'Режим заморозки: Фото (стоп-кадр)' : 'Режим заморозки: Анимация (3 сек)',
          SVG_TOAST_FREEZE
        );
        sendResponse({ success: true });
        break;
      }

      case 'START_RECORD_FREEZE': {
        window.postMessage({ type: 'MAXITET_START_RECORD_FREEZE' }, '*');
        sendResponse({ success: true });
        break;
      }

      case 'TAKE_FREEZE_PHOTO': {
        window.postMessage({ type: 'MAXITET_TAKE_FREEZE_PHOTO' }, '*');
        sendResponse({ success: true });
        break;
      }

      case 'SET_FREEZE_PHOTO': {
        window.postMessage({ type: 'MAXITET_SET_FREEZE_PHOTO', dataUrl: message.dataUrl }, '*');
        sendResponse({ success: true });
        break;
      }

      case 'SET_FREEZE_CAM': {
        window.postMessage({ type: 'MAXITET_SET_FREEZE_CAM', enabled: message.enabled }, '*');
        if (!message.enabled) {
          showFloatingToast('Вебкамера разморожена', SVG_TOAST_FREEZE);
        }
        sendResponse({ success: true });
        break;
      }

      case 'SET_FREEZE_GIF': {
        window.postMessage({ type: 'MAXITET_SET_FREEZE_GIF', dataUrl: message.dataUrl }, '*');
        sendResponse({ success: true });
        break;
      }

      case 'SET_ZEN_MODE': {
        setZenMode(Boolean(message.enabled));
        sendResponse({ success: true, isZen: isZenModeActive });
        break;
      }

      case 'GET_ZEN_MODE': {
        sendResponse({ isZen: isZenModeActive });
        break;
      }

      case 'SET_SMART_DARK_MODE': {
        if (message.preset) {
          setSmartDarkPreset(message.preset, false);
        }
        setSmartDarkMode(Boolean(message.enabled), false);
        sendResponse({ success: true, isSmartDarkMode: isSmartDarkModeActive, preset: currentSmartDarkPreset });
        break;
      }

      case 'GET_SMART_DARK_MODE': {
        sendResponse({ isSmartDarkMode: isSmartDarkModeActive, preset: currentSmartDarkPreset });
        break;
      }

      case 'SET_SMART_DARK_PRESET': {
        setSmartDarkPreset(message.preset, true);
        sendResponse({ success: true, isSmartDarkMode: isSmartDarkModeActive, preset: currentSmartDarkPreset });
        break;
      }

      case 'TAKE_SCREENSHOT': {
        triggerSlideScreenshot().then((res) => {
          sendResponse(res || { success: true });
        }).catch((err) => {
          sendResponse({ error: err.message });
        });
        return true;
      }

      case 'GET_PRESENTATION_INFO': {
        const presImg = getActivePresentationElement();
        const currentSrc = presImg ? (presImg.currentSrc || presImg.src) : (cachedPresentationStore?.currentSrc || null);

        let srcTemplate = cachedPresentationStore?.srcTemplate || null;
        let pagesCount = cachedPresentationStore?.pagesCount || 0;
        let currentPage = cachedPresentationStore?.currentPage || 1;

        if (!srcTemplate && currentSrc) {
          const match = currentSrc.match(/^(.*?(?:page[._-]?|slide[._-]?|\/))(\d+)(\.[a-zA-Z0-9]+(?:\?.*)?)$/i);
          if (match) {
            srcTemplate = `${match[1]}{{pageNumer}}${match[3]}`;
            currentPage = parseInt(match[2], 10);
          }
        }

        const suggestedFileName = getSanitizedPresentationFileName(cachedPresentationStore);

        sendResponse({
          hasPresentation: Boolean(presImg || cachedPresentationStore?.isPresentationEnabled || srcTemplate),
          currentSrc,
          srcTemplate,
          pagesCount,
          currentPage,
          subject: cachedPresentationStore?.subject || '',
          lessonTitle: cachedPresentationStore?.lessonTitle || '',
          meetingTitle: cachedPresentationStore?.meetingTitle || '',
          presFileName: cachedPresentationStore?.presFileName || '',
          suggestedFileName,
        });
        break;
      }

      case 'START_PRESENTATION_DOWNLOAD': {
        if (pdfDownloadState.isDownloading) {
          sendResponse({ started: false, alreadyRunning: true, state: pdfDownloadState });
          break;
        }
        startBackgroundPresentationDownload(message.options || {}).catch((err) => {
          console.error('[Maxitet Master] Ошибка запуска скачивания презентации:', err);
        });
        sendResponse({ started: true, state: pdfDownloadState });
        break;
      }

      case 'GET_PRESENTATION_DOWNLOAD_STATUS': {
        sendResponse({ ...pdfDownloadState });
        break;
      }
    }
  });

  // ─── Presentation PDF Background Downloader ──────────────
  let pdfDownloadState = {
    isDownloading: false,
    current: 0,
    total: 0,
    percent: 0,
    statusText: '',
    fileName: '',
    finished: false,
    success: false,
    error: null,
  };

  function updatePdfDownloadState(patch) {
    Object.assign(pdfDownloadState, patch);
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ presentationDownloadProgress: pdfDownloadState }).catch(() => {});
    }
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

  function getSanitizedPresentationFileName(info) {
    const subject = (info?.subject || '').trim();
    const lessonTitle = (info?.lessonTitle || '').trim();
    const presFileName = (info?.presFileName || '').trim();
    const meetingTitle = (info?.meetingTitle || '').trim();

    let nameParts = [];

    if (subject && lessonTitle) {
      if (lessonTitle.toLowerCase().includes(subject.toLowerCase())) {
        nameParts.push(lessonTitle);
      } else {
        nameParts.push(`${subject} - ${lessonTitle}`);
      }
    } else if (lessonTitle) {
      nameParts.push(lessonTitle);
    } else if (subject) {
      nameParts.push(subject);
    } else if (presFileName) {
      nameParts.push(presFileName.replace(/\.pdf$/i, ''));
    } else if (meetingTitle) {
      nameParts.push(meetingTitle);
    }

    if (nameParts.length === 0) {
      const domHeader = document.querySelector('.lesson-title, .meeting-title, .dashboard-tab__title');
      if (domHeader && domHeader.textContent && domHeader.textContent.trim().length > 2) {
        const text = domHeader.textContent.trim();
        if (!['Чат', 'Участники', 'Тьютор', 'Опросы'].includes(text)) {
          nameParts.push(text);
        }
      }
    }

    let finalName = nameParts.join(' ').trim();
    if (!finalName) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
      finalName = `Презентация М.Класс_${dateStr}`;
    }

    finalName = finalName
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\.\s]+$/, '');

    if (finalName.length > 120) {
      finalName = finalName.substring(0, 120).trim().replace(/[\.\s]+$/, '');
    }

    return `${finalName}.pdf`;
  }

  function sanitizeDownloadSubfolder(folder) {
    if (!folder || typeof folder !== 'string') return '';
    return folder
      .replace(/\\/g, '/')
      .replace(/[^\p{L}\p{N}_\-\s\/]/gu, '')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .trim();
  }

  async function fetchSlideAsDataUrl(url) {
    if (!url) return null;

    // 1. Запрос через Background Service Worker (с host_permissions для обхода CORS на storage.yandexcloud.net)
    try {
      const bgResult = await new Promise((resolve) => {
        let isDone = false;
        const timer = setTimeout(() => {
          if (!isDone) {
            isDone = true;
            resolve(null);
          }
        }, 15000);

        chrome.runtime.sendMessage(
          { target: 'background', type: 'FETCH_IMAGE_BASE64', url },
          (res) => {
            if (isDone) return;
            isDone = true;
            clearTimeout(timer);
            if (chrome.runtime.lastError || !res || res.error || !res.dataUrl) {
              resolve(null);
            } else {
              resolve(res.dataUrl);
            }
          }
        );
      });

      if (bgResult) return bgResult;
    } catch (bgErr) {
      console.warn('[Maxitet Master] Фоновый запрос слайда через background завершился ошибкой:', bgErr);
    }

    // 2. Резервная попытка через прямой fetch (если слайды размещены на том же домене или с CORS заголовками)
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const blob = await resp.blob();
        return await blobToBase64(blob);
      }
    } catch (directErr) {
      // Игнорируем стандартную блокировку CORS при прямом fetch
    }

    return null;
  }

  async function startBackgroundPresentationDownload(options = {}) {
    window.postMessage({ type: 'MAXITET_GET_PRESENTATION_STORE' }, '*');
    await new Promise((r) => setTimeout(r, 120));

    const presImg = getActivePresentationElement();
    let currentSrc = presImg ? (presImg.currentSrc || presImg.src) : (cachedPresentationStore?.currentSrc || null);
    let srcTemplate = cachedPresentationStore?.srcTemplate || null;
    let knownPagesCount = cachedPresentationStore?.pagesCount || 0;

    if (!srcTemplate && currentSrc) {
      const match = currentSrc.match(/^(.*?(?:page[._-]?|slide[._-]?|\/))(\d+)(\.[a-zA-Z0-9]+(?:\?.*)?)$/i);
      if (match) {
        srcTemplate = `${match[1]}{{pageNumer}}${match[3]}`;
      }
    }

    if (!srcTemplate && !currentSrc) {
      const err = 'Слайды не найдены. Убедитесь, что преподаватель включил презентацию.';
      updatePdfDownloadState({
        isDownloading: false,
        finished: true,
        success: false,
        error: err,
        statusText: err,
      });
      showFloatingToast(err, SVG_TOAST_DOWNLOAD);
      return;
    }

    function getPageUrl(pageNum) {
      if (srcTemplate) {
        return srcTemplate
          .replace(/\{\{pageNumer\}\}/g, pageNum)
          .replace(/\{\{pageNumber\}\}/g, pageNum);
      }
      return currentSrc;
    }

    const jsPDFConstructor = window.jspdf ? window.jspdf.jsPDF : (typeof jspdf !== 'undefined' ? jspdf.jsPDF : null);
    if (!jsPDFConstructor) {
      const err = 'Библиотека jsPDF не найдена';
      updatePdfDownloadState({
        isDownloading: false,
        finished: true,
        success: false,
        error: err,
        statusText: err,
      });
      showFloatingToast(err, SVG_TOAST_DOWNLOAD);
      return;
    }

    const fileName = getSanitizedPresentationFileName(cachedPresentationStore);
    const subfolder = sanitizeDownloadSubfolder(options.subfolder);
    const saveAs = Boolean(options.saveAs);
    const downloadPath = (!saveAs && subfolder) ? `${subfolder}/${fileName}` : fileName;

    updatePdfDownloadState({
      isDownloading: true,
      finished: false,
      success: false,
      error: null,
      current: 0,
      total: knownPagesCount || 0,
      percent: 0,
      fileName,
      statusText: 'Поиск и сканирование слайдов презентации…',
    });

    showFloatingToast('Скачивание презентации запущено в фоне', SVG_TOAST_DOWNLOAD);

    try {
      const downloadedSlides = [];

      if (knownPagesCount > 0) {
        const pagesToFetch = Array.from({ length: knownPagesCount }, (_, i) => i + 1);
        const CONCURRENCY = 4;
        let activeIdx = 0;

        async function worker() {
          while (activeIdx < pagesToFetch.length) {
            const p = pagesToFetch[activeIdx++];
            const pageUrl = getPageUrl(p);
            let dataUrl = await fetchSlideAsDataUrl(pageUrl);

            // Однократный повтор при сбое сети
            if (!dataUrl) {
              await new Promise((r) => setTimeout(r, 200));
              dataUrl = await fetchSlideAsDataUrl(pageUrl);
            }

            if (dataUrl) {
              downloadedSlides.push({ pageNum: p, dataUrl });
            }

            const doneCount = downloadedSlides.length;
            const pct = Math.round((doneCount / knownPagesCount) * 88);
            updatePdfDownloadState({
              current: doneCount,
              total: knownPagesCount,
              percent: pct,
              statusText: `Загрузка: ${doneCount} из ${knownPagesCount} слайдов…`,
            });
          }
        }

        const workers = Array.from(
          { length: Math.min(CONCURRENCY, knownPagesCount) },
          () => worker()
        );
        await Promise.all(workers);

        downloadedSlides.sort((a, b) => a.pageNum - b.pageNum);
      } else {
        let pageNum = 1;
        let consecutiveFails = 0;
        while (consecutiveFails < 3 && pageNum <= 300) {
          const pageUrl = getPageUrl(pageNum);
          let dataUrl = await fetchSlideAsDataUrl(pageUrl);
          if (dataUrl) {
            downloadedSlides.push({ pageNum, dataUrl });
            consecutiveFails = 0;
          } else {
            consecutiveFails++;
          }
          const currCount = downloadedSlides.length;
          updatePdfDownloadState({
            current: currCount,
            total: Math.max(currCount, pageNum),
            percent: Math.min(85, currCount * 3),
            statusText: `Собрано: ${currCount} слайдов (проверка стр. ${pageNum}…)`,
          });
          pageNum++;
        }
      }

      if (downloadedSlides.length === 0) {
        throw new Error('Не удалось скачать ни одного слайда');
      }

      updatePdfDownloadState({
        percent: 90,
        statusText: `Собрано ${downloadedSlides.length} слайдов. Формирование PDF…`,
      });

      const pdf = new jsPDFConstructor('l', 'mm', 'a4');
      let addedPages = 0;

      for (let i = 0; i < downloadedSlides.length; i++) {
        const item = downloadedSlides[i];
        try {
          const b64 = item.dataUrl;
          const imgObj = await loadImage(b64);
          const sw = imgObj.width || 1920;
          const sh = imgObj.height || 1080;
          const scale = Math.min(297 / sw, 210 / sh);
          const dw = sw * scale;
          const dh = sh * scale;
          const dx = (297 - dw) / 2;
          const dy = (210 - dh) / 2;

          if (addedPages > 0) {
            pdf.addPage('a4', 'landscape');
          }
          pdf.addImage(b64, 'JPEG', dx, dy, dw, dh);
          addedPages++;
        } catch (err) {
          console.error(`[Maxitet Master] Ошибка добавления страницы ${item.pageNum} в PDF:`, err);
        }

        if (i % 10 === 0 || i === downloadedSlides.length - 1) {
          const pdfPct = 90 + Math.round(((i + 1) / downloadedSlides.length) * 8);
          updatePdfDownloadState({
            percent: Math.min(98, pdfPct),
            statusText: `Формирование PDF: ${i + 1} из ${downloadedSlides.length} слайдов…`,
          });
        }
      }

      if (addedPages === 0) {
        throw new Error('Не удалось добавить слайды в PDF-документ');
      }

      updatePdfDownloadState({
        percent: 98,
        statusText: 'Сохранение файла PDF…',
      });

      let downloadSuccess = false;
      try {
        if (pdf.output) {
          const dataUri = pdf.output('datauristring');
          if (dataUri && dataUri.length < 32 * 1024 * 1024) {
            const bgRes = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                {
                  target: 'background',
                  type: 'SAVE_PDF_DOWNLOAD',
                  dataUrl: dataUri,
                  filename: downloadPath,
                  saveAs: saveAs,
                },
                (res) => {
                  if (chrome.runtime.lastError) {
                    resolve({ error: chrome.runtime.lastError.message });
                  } else {
                    resolve(res || {});
                  }
                }
              );
            });

            if (bgRes && !bgRes.error) {
              downloadSuccess = true;
            } else {
              console.warn('[Maxitet Master] Фоновое сохранение через background вернуло ошибку:', bgRes?.error);
            }
          } else {
            console.warn('[Maxitet Master] Размер PDF превышает 32МБ, сохраняем через blob ссылку');
          }
        }
      } catch (saveErr) {
        console.warn('[Maxitet Master] Исключение при отправке PDF в background:', saveErr);
      }

      if (!downloadSuccess) {
        pdf.save(fileName);
      }

      const totalInfo = knownPagesCount > 0 ? `${downloadedSlides.length} из ${knownPagesCount}` : `${downloadedSlides.length}`;
      const successMsg = `Готово! Скачано ${totalInfo} слайдов в файл «${fileName}»`;
      updatePdfDownloadState({
        isDownloading: false,
        finished: true,
        success: true,
        percent: 100,
        statusText: successMsg,
      });

      showFloatingToast(`Презентация скачана: ${fileName}`, SVG_TOAST_DOWNLOAD);
    } catch (err) {
      console.error('[Maxitet Master] Ошибка создания PDF:', err);
      updatePdfDownloadState({
        isDownloading: false,
        finished: true,
        success: false,
        error: err.message,
        statusText: `Ошибка: ${err.message}`,
      });
      showFloatingToast(`Ошибка скачивания: ${err.message}`, SVG_TOAST_DOWNLOAD);
    }
  }

  // ─── Sync Stealth & Freeze Cam ────────────────────────────
  function syncStealthMode() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ stealthMode: false }, (res) => {
        window.postMessage({ type: 'LECTURE_PIP_SET_STEALTH', enabled: res.stealthMode }, '*');
      });

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.stealthMode) {
          window.postMessage(
            { type: 'LECTURE_PIP_SET_STEALTH', enabled: changes.stealthMode.newValue },
            '*'
          );
        }
      });
    }
  }

  syncStealthMode();

  function syncFreezeCam() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({
        freezeCam: false,
        freezeCamMode: 'loop',
        freezeCamLoopFrames: null,
        freezeCamPhoto: null,
        freezeCamGif: null,
      }, (res) => {
        window.postMessage({
          type: 'MAXITET_INIT_FREEZE_STATE',
          enabled: res.freezeCam,
          mode: res.freezeCamMode || 'loop',
          loopFrames: res.freezeCamLoopFrames,
          photoDataUrl: res.freezeCamPhoto,
          customGifDataUrl: res.freezeCamGif,
        }, '*');
      });

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.freezeCam) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_CAM', enabled: changes.freezeCam.newValue }, '*');
        }
        if (changes.freezeCamMode) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_MODE', mode: changes.freezeCamMode.newValue }, '*');
        }
        if (changes.freezeCamGif) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_GIF', dataUrl: changes.freezeCamGif.newValue }, '*');
        }
        if (changes.freezeCamPhoto) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_PHOTO', dataUrl: changes.freezeCamPhoto.newValue }, '*');
        }
      });
    }
  }

  syncFreezeCam();

  // ─── Microphone Safety Guard (Предохранитель микрофона) ────

  let micGuardEnabled = true;
  let micGuardedBtn = null;
  let autoMuteAttempts = 0;

  function isMicUnmuted(btn) {
    if (!btn) return false;
    // В М.Класс активная кнопка устройства имеет класс 'active'
    if (btn.classList.contains('active')) return true;

    // Проверка SVG атрибутов
    const svg = btn.querySelector('svg');
    if (svg) {
      const aria = svg.getAttribute('aria-labelledby') || '';
      if (aria.includes('microphone-off')) return false;
      if (aria.includes('microphone')) return true;
    }
    const title = btn.querySelector('title');
    if (title) {
      if (title.id.includes('microphone-off')) return false;
      if (title.id.includes('microphone')) return true;
    }
    return false;
  }

  // ─── Screenshot (Hotkey S) ────────────────────────────────

  async function triggerSlideScreenshot() {
    try {
      const presImg = getActivePresentationElement();
      let drawSource = null;
      let isPres = false;
      let w = 1920;
      let h = 1080;

      if (presImg) {
        isPres = true;
        w = presImg.naturalWidth || presImg.clientWidth || 1920;
        h = presImg.naturalHeight || presImg.clientHeight || 1080;

        const imgUrl = presImg.currentSrc || presImg.src;
        if (imgUrl) {
          // Получаем чистый base64 через background service worker с host_permissions
          const cleanDataUrl = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { target: 'background', type: 'FETCH_IMAGE_BASE64', url: imgUrl },
              (res) => {
                if (chrome.runtime.lastError || !res || res.error || !res.dataUrl) {
                  resolve(null);
                } else {
                  resolve(res.dataUrl);
                }
              }
            );
          });

          if (cleanDataUrl) {
            const tempImg = new Image();
            tempImg.src = cleanDataUrl;
            await new Promise((res, rej) => {
              tempImg.onload = res;
              tempImg.onerror = rej;
            });
            drawSource = tempImg;
          }
        }
      }

      if (!drawSource) {
        // Ищем реальный активный видеопоток демонстрации экрана
        const videos = document.querySelectorAll('video');
        for (const v of videos) {
          if (!isElementVisible(v)) continue;
          if (v.videoWidth > 0 && (v.classList.contains('sharing__screen-share-video') || v.getBoundingClientRect().width > 250)) {
            drawSource = v;
            w = v.videoWidth || v.clientWidth || 1920;
            h = v.videoHeight || v.clientHeight || 1080;
            break;
          }
        }
      }

      if (!drawSource) {
        showFloatingToast('Слайд или экран преподавателя не найден', SVG_TOAST_CAMERA);
        return { error: 'Слайд или экран преподавателя не найден' };
      }

      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(drawSource, 0, 0, w, h);

      // Если это презентация, проверяем слой белой доски (рисунки маркером препода)
      if (isPres) {
        try {
          const frame = document.getElementById('paint-frame');
          const paintCanvas = frame?.contentDocument?.getElementById('paint-canvas');
          if (paintCanvas && paintCanvas.width > 0 && paintCanvas.height > 0) {
            // Тестируем на отдельном 1х1 холсте, не заражен ли paintCanvas
            const testC = document.createElement('canvas');
            testC.width = 1;
            testC.height = 1;
            testC.getContext('2d').drawImage(paintCanvas, 0, 0, 1, 1);
            testC.toDataURL('image/png'); // Выбросит SecurityError, если холст tainted

            // Всё чисто — рисуем поверх слайда
            ctx.drawImage(paintCanvas, 0, 0, w, h);
          }
        } catch (paintErr) {
          console.warn('Слой рисования недоступен для экспорта, пропускаем:', paintErr);
        }
      }

      let dataUrl = null;
      let blob = null;
      try {
        dataUrl = c.toDataURL('image/png');
        blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      } catch (taintErr) {
        // Fallback: перерисовываем только чистый drawSource без внешних слоев
        const fallbackC = document.createElement('canvas');
        fallbackC.width = w;
        fallbackC.height = h;
        fallbackC.getContext('2d').drawImage(drawSource, 0, 0, w, h);
        dataUrl = fallbackC.toDataURL('image/png');
        blob = await new Promise((res) => fallbackC.toBlob(res, 'image/png'));
      }

      let copied = false;

      if (blob && navigator.clipboard && navigator.clipboard.write) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copied = true;
          showFloatingToast('Снимок слайда скопирован в буфер (S)', SVG_TOAST_CAMERA);
        } catch (clipErr) {
          // Если документ потерял фокус (например, вызов из попапа)
        }
      }

      return { success: true, copied, dataUrl };
    } catch (e) {
      showFloatingToast('Ошибка создания снимка: ' + e.message, SVG_TOAST_CAMERA);
      return { error: e.message };
    }
  }

  function attachMicGuard(btn) {
    if (btn === micGuardedBtn) return;
    micGuardedBtn = btn;

    // Выключаем при первом обнаружении кнопки, если микрофон открыт
    if (micGuardEnabled && isMicUnmuted(btn)) {
      btn.click();
      showMicToast('Микрофон заблокирован (предохранитель включён)');
    }

    // Полная блокировка: пока включён предохранитель, включить микрофон нельзя
    btn.addEventListener(
      'click',
      (e) => {
        if (!micGuardEnabled) return;

        // Если микрофон сейчас ВЫКЛЮЧЕН, намертво блокируем попытку включения
        if (!isMicUnmuted(btn)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          showMicToast('Предохранитель включён: микрофон заблокирован');
          return;
        }
        // Если микрофон был включён — разрешаем клик, чтобы мгновенно выключить
      },
      true // capturing listener — перехватываем ДО скриптов сайта
    );
  }

  function initMicGuard() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ micGuard: true }, (res) => {
        micGuardEnabled = res.micGuard;
      });

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.micGuard) {
          micGuardEnabled = changes.micGuard.newValue;
          if (micGuardEnabled && micGuardedBtn && isMicUnmuted(micGuardedBtn)) {
            micGuardedBtn.click();
            showMicToast('Микрофон заблокирован (предохранитель включён)');
          }
        }
      });
    }

    const checkBtn = () => {
      const btn = document.getElementById('meeting-buttons-micro');
      if (btn) {
        attachMicGuard(btn);

        // Если предохранитель включён, а микрофон почему-то активен — мгновенно гасим
        if (micGuardEnabled && isMicUnmuted(btn)) {
          btn.click();
        }
      }
    };

    // Периодическая проверка и отслеживание DOM через MutationObserver
    setInterval(checkBtn, 1000);

    const observer = new MutationObserver(() => {
      checkBtn();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  initMicGuard();

  // ─── Smart Dark Mode (Тёмная тема слайдов) ────────────────
  const SVG_DOCK_MOON = SVG_TOAST_MOON;
  const SVG_DOCK_SUN = SVG_TOAST_SUN;

  function applySmartDarkDOMState() {
    injectSvgFilters(document);
    document.body.classList.toggle('maxitet-smart-dark', isSmartDarkModeActive);
    document.body.setAttribute('data-smart-dark-preset', currentSmartDarkPreset);
    const presetCfg = SMART_DARK_PRESETS[currentSmartDarkPreset] || SMART_DARK_PRESETS.maxitet;
    document.body.style.setProperty('--maxitet-dark-bg', presetCfg.bgColor);
  }

  function setSmartDarkMode(enabled, showToastNotice = true) {
    isSmartDarkModeActive = Boolean(enabled);
    applySmartDarkDOMState();

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ smartDarkMode: isSmartDarkModeActive });
    }

    syncZenDock();
    if (typeof activeViewerUpdateDarkMode === 'function') {
      activeViewerUpdateDarkMode();
    }

    if (showToastNotice) {
      const presetCfg = SMART_DARK_PRESETS[currentSmartDarkPreset] || SMART_DARK_PRESETS.maxitet;
      showFloatingToast(
        isSmartDarkModeActive
          ? `Тёмная тема (${presetCfg.name}): ВКЛ (D)`
          : 'Тёмная тема слайдов: ВЫКЛ (D)',
        isSmartDarkModeActive ? SVG_TOAST_MOON : SVG_TOAST_SUN
      );
    }
  }

  function setSmartDarkPreset(preset, showToastNotice = true) {
    if (!SMART_DARK_PRESETS[preset]) preset = 'maxitet';
    currentSmartDarkPreset = preset;
    applySmartDarkDOMState();

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ smartDarkPreset: currentSmartDarkPreset });
    }

    if (typeof activeViewerUpdateDarkMode === 'function') {
      activeViewerUpdateDarkMode();
    }

    if (showToastNotice && isSmartDarkModeActive) {
      const cfg = SMART_DARK_PRESETS[preset];
      showFloatingToast(
        `Пресет слайдов: ${cfg.title || cfg.name}`,
        SVG_TOAST_MOON
      );
    }
  }

  function cycleSmartDarkPreset() {
    const keys = Object.keys(SMART_DARK_PRESETS);
    const curIdx = keys.indexOf(currentSmartDarkPreset);
    const nextPreset = keys[(curIdx + 1) % keys.length];
    if (!isSmartDarkModeActive) {
      setSmartDarkMode(true, false);
    }
    setSmartDarkPreset(nextPreset, true);
  }

  // ─── Zen Mode (Режим Дзен) ───────────────────────────────

  let isZenModeActive = false;

  const SVG_ZEN_ENTER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  const SVG_ZEN_EXIT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>`;

  const SVG_DOCK_MIC_OFF = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
  const SVG_DOCK_MIC_ON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;

  const SVG_DOCK_CAM_OFF = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A1 1 0 0 1 23 8.3v7.4a1 1 0 0 1-1.752.662L16 13.5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1.34"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
  const SVG_DOCK_CAM_ON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>`;

  const SVG_DOCK_HAND = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v7"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`;
  const SVG_DOCK_CHAT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_DOCK_GRIP = `<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>`;

  function setZenMode(enabled) {
    isZenModeActive = enabled;
    document.body.classList.toggle('maxitet-zen-mode', isZenModeActive);

    // При включении Дзена убираем зависшие подсказки
    if (isZenModeActive) {
      document.querySelectorAll('.izi-tooltip.expanded').forEach(el => {
        el.classList.remove('expanded');
      });
    }

    const drawer = document.querySelector('.dashboard-drawer');
    if (!isZenModeActive) {
      cleanupZenChatStyles(drawer);
      document.body.classList.remove('maxitet-zen-chat-open');
      // Позиция и размер чата и докбара сохраняются при выключении/включении Дзена
      resetZenZoom();
      activeSlideShift = 0;
      const viewer = document.querySelector('.viewer.sharing__viewer, .viewer-main-img');
      if (viewer) viewer.style.transform = '';
    } else {
      restoreZenChatGeometry(drawer);
      restoreZenDockGeometry();
    }

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ zenMode: isZenModeActive });
    }

    syncZenDock();
    showFloatingToast(
      isZenModeActive ? 'Режим Дзен включён (Z)' : 'Обычный вид М.Класс',
      SVG_TOAST_ZEN
    );

    // Уведомляем плеер и холст рисования об изменении геометрии
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 360);
  }

  function injectZenStyles() {
    if (document.getElementById('maxitet-zen-styles')) return;

    const style = document.createElement('style');
    style.id = 'maxitet-zen-styles';
    style.textContent = `
      /* ═══════════ Maxitet Master: Умная тёмная тема слайдов (Smart Dark Mode) ═══════════ */
      body.maxitet-smart-dark .viewer-main-img__img,
      body.maxitet-smart-dark .viewer img,
      body.maxitet-smart-dark #paint-frame {
        filter: url(#maxitet-dark-maxitet) !important;
        transition: filter 0.25s ease !important;
      }

      body.maxitet-smart-dark[data-smart-dark-preset="maxitet"] .viewer-main-img__img,
      body.maxitet-smart-dark[data-smart-dark-preset="maxitet"] .viewer img,
      body.maxitet-smart-dark[data-smart-dark-preset="maxitet"] #paint-frame {
        filter: url(#maxitet-dark-maxitet) !important;
      }

      body.maxitet-smart-dark[data-smart-dark-preset="contrast"] .viewer-main-img__img,
      body.maxitet-smart-dark[data-smart-dark-preset="contrast"] .viewer img,
      body.maxitet-smart-dark[data-smart-dark-preset="contrast"] #paint-frame {
        filter: url(#maxitet-dark-contrast) !important;
      }

      body.maxitet-smart-dark[data-smart-dark-preset="soft"] .viewer-main-img__img,
      body.maxitet-smart-dark[data-smart-dark-preset="soft"] .viewer img,
      body.maxitet-smart-dark[data-smart-dark-preset="soft"] #paint-frame {
        filter: url(#maxitet-dark-soft) !important;
      }

      body.maxitet-smart-dark[data-smart-dark-preset="invert"] .viewer-main-img__img,
      body.maxitet-smart-dark[data-smart-dark-preset="invert"] .viewer img,
      body.maxitet-smart-dark[data-smart-dark-preset="invert"] #paint-frame {
        filter: invert(0.9) hue-rotate(180deg) contrast(1.1) brightness(0.95) !important;
      }

      body.maxitet-smart-dark .sharing__viewer,
      body.maxitet-smart-dark .viewer__main-page,
      body.maxitet-smart-dark .viewer-main-img,
      body.maxitet-smart-dark .sharing__inner,
      body.maxitet-smart-dark .viewer {
        background-color: var(--maxitet-dark-bg, #0f1015) !important;
      }

      .maxitet-dock-btn.is-active-dark {
        background: #854d0e !important;
        border-color: #fbbf24 !important;
        color: #fef08a !important;
        box-shadow: 0 4px 14px rgba(251, 191, 36, 0.45) !important;
      }

      /* ═══════════ Maxitet Master: Режим Дзен ═══════════ */
      body.maxitet-zen-mode .meeting__users-area {
        display: none !important;
        min-height: 0 !important;
        max-height: 0 !important;
        height: 0 !important;
        opacity: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
      }

      /* Полностью убираем нижний блок кнопок из потока верстки в Дзене */
      body.maxitet-zen-mode .meeting__buttons {
        display: none !important;
        min-height: 0 !important;
        max-height: 0 !important;
        height: 0 !important;
        opacity: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        pointer-events: none !important;
        overflow: hidden !important;
      }

      body.maxitet-zen-mode .meeting__activity-score-widget {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body.maxitet-zen-mode .meeting__video-area {
        height: 100vh !important;
        max-height: 100vh !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
      }

      /* Презентация растягивается на всю доступную высоту 100vh без нижней черной полосы */
      body.maxitet-zen-mode .meeting__screen-sharing-area {
        padding: 0 !important;
        margin: 0 !important;
        width: 100% !important;
        height: 100vh !important;
        max-height: 100vh !important;
        flex: 1 1 100% !important;
        overflow: hidden !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      body.maxitet-zen-mode .sharing__inner {
        width: 100% !important;
        height: 100vh !important;
        max-height: 100vh !important;
        padding: 0 !important;
        margin: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      /* Скрываем боковую вебку преподавателя (frame-broadcast) в Режиме Дзен */
      body.maxitet-zen-mode .frame-broadcast,
      body.maxitet-zen-mode video.frame-broadcast,
      body.maxitet-zen-mode [class*="frame-broadcast"],
      body.maxitet-zen-mode .viewer__host-frame {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* Презентация занимает 100% экрана по высоте и ширине */
      body.maxitet-zen-mode .viewer.sharing__viewer {
        width: 100% !important;
        max-width: 100% !important;
        height: 100vh !important;
        max-height: 100vh !important;
        gap: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      body.maxitet-zen-mode .viewer__main-page {
        width: 100% !important;
        max-width: 100% !important;
        height: 100vh !important;
        max-height: 100vh !important;
        flex-grow: 1 !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      body.maxitet-zen-mode .viewer-main-img {
        margin: 0 auto !important;
        height: 100vh !important;
        max-height: 100vh !important;
        width: auto !important;
        max-width: 100vw !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      body.maxitet-zen-mode .viewer-main-img__img {
        height: 100vh !important;
        max-height: 100vh !important;
        width: auto !important;
        max-width: 100vw !important;
        object-fit: contain !important;
        margin: 0 auto !important;
      }

      body.maxitet-zen-mode .paint,
      body.maxitet-zen-mode .paint__inner,
      body.maxitet-zen-mode #paint-container,
      body.maxitet-zen-mode #paint-frame,
      body.maxitet-zen-mode iframe.paint-frame {
        pointer-events: none !important;
        height: 100% !important;
        width: 100% !important;
      }

      /* Плавный сочный сдвиг презентации синхронно с выездом чата */
      body.maxitet-zen-mode .viewer.sharing__viewer,
      body.maxitet-zen-mode .sharing__screen-share-container,
      body.maxitet-zen-mode .viewer-main-img {
        transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }

      /* Видеодемонстрация экрана в Дзене */
      body.maxitet-zen-mode .sharing__screen-share-container,
      body.maxitet-zen-mode .sharing__screen-share,
      body.maxitet-zen-mode .sharing__screen-share-video {
        height: 100vh !important;
        max-height: 100vh !important;
        width: 100% !important;
        max-width: 100vw !important;
        object-fit: contain !important;
        margin: 0 auto !important;
      }

      /* Всплывающий чат Дзена: ВСЕГДА зафиксирован по вертикали и прижат к правому краю */
      body.maxitet-zen-mode .dashboard-drawer {
        position: fixed !important;
        right: 18px !important;
        top: 50% !important;
        height: 530px !important;
        max-height: 84vh !important;
        width: 340px !important;
        border-radius: 18px !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
        background: rgba(22, 24, 25, 0.72) !important;
        backdrop-filter: blur(3px) !important;
        -webkit-backdrop-filter: blur(3px) !important;
        border: none !important;
        margin-right: 0 !important;
        z-index: 2147483640 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        box-sizing: border-box !important;
        /* В закрытом состоянии сдвинут вправо за границу */
        transform: translateY(-50%) translateX(440px) scale(0.96) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1),
                    opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1),
                    box-shadow 0.38s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }

      /* При открытии плавно и упруго вылетает справа */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open {
        transform: translateY(-50%) translateX(0) scale(1) !important;
        opacity: 1 !important;
        pointer-events: all !important;
      }

      /* Защита от обрезания нижней части чата (поля ввода и переключателя) */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard {
        height: 100% !important;
        max-height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        box-sizing: border-box !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__content {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }

      /* Любой неактивный таб (чат, список участников, опросы) должен быть полностью скрыт! */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__content > [style*="display: none"],
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__wrap[style*="display: none"],
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-list__container[style*="display: none"],
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-dashboard[style*="display: none"] {
        display: none !important;
      }

      /* Активный таб чата */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__wrap:not([style*="display: none"]) {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        height: 100% !important;
        max-height: 100% !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        padding: 0 8px 8px 8px !important;
        overflow: hidden !important;
      }

      /* Активный таб участников — занимает всё пространство окна вместо чата */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-list__container:not([style*="display: none"]) {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        height: 100% !important;
        max-height: 100% !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        padding: 6px 8px 8px 8px !important;
        overflow: hidden !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-list__container:not([style*="display: none"]) .izi-virtual-list {
        flex: 1 1 auto !important;
        height: 100% !important;
        max-height: 100% !important;
        overflow-y: auto !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__posted {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        height: 0 !important;
        position: relative !important;
        overflow: hidden !important;
      }

      /* Перетаскивание окна чата в Zen-режиме */
      body.maxitet-zen-mode .dashboard-drawer.is-dragged {
        right: auto !important;
        bottom: auto !important;
        transform: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.is-dragging {
        user-select: none !important;
        -webkit-user-select: none !important;
        transition: box-shadow 0.2s ease, opacity 0.2s ease !important;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.24) !important;
      }

      /* Скрываем внешнюю нативную кнопку шторки в Zen-режиме, устраняя пустое пространство сверху */
      body.maxitet-zen-mode .dashboard-drawer > .dashboard-drawer__toggler,
      body.maxitet-zen-mode .dashboard-drawer > .dashboard-toggler,
      body.maxitet-zen-mode .dashboard-drawer .dashboard-drawer__toggler {
        display: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard {
        padding-top: 0 !important;
        margin-top: 0 !important;
      }

      /* В Zen-режиме: компактные 6 точек захвата для перетаскивания окна в шапке */
      body.maxitet-zen-mode .dashboard-drawer .dashboard__header-top .dashboard-toggler {
        cursor: grab !important;
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-radius: 6px !important;
        width: 20px !important;
        height: 20px !important;
        min-width: 20px !important;
        padding: 0 !important;
        transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard__header-top .dashboard-toggler:hover {
        background: rgba(255, 255, 255, 0.18) !important;
        border-color: rgba(255, 255, 255, 0.26) !important;
        transform: scale(1.05) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.is-dragging .dashboard__header-top .dashboard-toggler,
      body.maxitet-zen-mode .dashboard-drawer .dashboard__header-top .dashboard-toggler:active {
        cursor: grabbing !important;
        background: rgba(255, 255, 255, 0.24) !important;
      }

      /* Скрываем нативные 3 полосы бургер-меню */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-toggler .icon-container,
      body.maxitet-zen-mode .dashboard-drawer .dashboard-toggler svg,
      body.maxitet-zen-mode .dashboard-drawer .dashboard-toggler .dashboard-toggler__notify {
        display: none !important;
      }

      /* 6 аккуратных точек перетаскивания через SVG mask */
      body.maxitet-zen-mode .dashboard-drawer .dashboard__header-top .dashboard-toggler::before {
        content: '' !important;
        display: block !important;
        width: 10px !important;
        height: 14px !important;
        background-color: #cbd5e1 !important;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 16'%3E%3Ccircle cx='3' cy='3' r='1.5' fill='%23000'/%3E%3Ccircle cx='7' cy='3' r='1.5' fill='%23000'/%3E%3Ccircle cx='3' cy='8' r='1.5' fill='%23000'/%3E%3Ccircle cx='7' cy='8' r='1.5' fill='%23000'/%3E%3Ccircle cx='3' cy='13' r='1.5' fill='%23000'/%3E%3Ccircle cx='7' cy='13' r='1.5' fill='%23000'/%3E%3C/svg%3E") no-repeat center / contain !important;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 16'%3E%3Ccircle cx='3' cy='3' r='1.5' fill='%23000'/%3E%3Ccircle cx='7' cy='3' r='1.5' fill='%23000'/%3E%3Ccircle cx='3' cy='8' r='1.5' fill='%23000'/%3E%3Ccircle cx='7' cy='8' r='1.5' fill='%23000'/%3E%3Ccircle cx='3' cy='13' r='1.5' fill='%23000'/%3E%3Ccircle cx='7' cy='13' r='1.5' fill='%23000'/%3E%3C/svg%3E") no-repeat center / contain !important;
        opacity: 0.8 !important;
        transition: opacity 0.2s ease, background-color 0.2s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard__header-top .dashboard-toggler:hover::before {
        opacity: 1 !important;
        background-color: #ffffff !important;
      }

      /* Компактная шапка чата (высота 28px) */
      body.maxitet-zen-mode .dashboard-drawer .dashboard__header {
        min-height: 28px !important;
        height: 28px !important;
        padding: 0 !important;
        margin: 0 !important;
        background: rgba(255, 255, 255, 0.03) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07) !important;
        display: flex !important;
        align-items: center !important;
        overflow: hidden !important;
        cursor: default !important;
        user-select: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard__header-top {
        min-height: 28px !important;
        height: 28px !important;
        padding: 0 8px !important;
        margin: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        background: transparent !important;
        border-bottom: none !important;
      }

      /* Группа табов: единая flex-строка, строго по центру */
      body.maxitet-zen-mode .dashboard-drawer .dashboard__tabs {
        margin: 0 !important;
        gap: 6px !important;
        display: inline-flex !important;
        align-items: center !important;
        height: 22px !important;
      }

      /* Единый стиль пилюль для обоих табов (Чат и Участники): одинаковая высота 22px, идеально ровно */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 22px !important;
        min-height: 22px !important;
        max-height: 22px !important;
        padding: 0 6px !important;
        position: relative !important;
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        box-sizing: border-box !important;
        transition: background-color 0.18s ease, border-color 0.18s ease, transform 0.15s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:hover {
        background: rgba(255, 255, 255, 0.12) !important;
        border-color: rgba(255, 255, 255, 0.2) !important;
      }

      /* Активный таб: мягкая оранжевая подсветка рамки и фона */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab.dashboard-tab--active {
        background: rgba(250, 140, 22, 0.18) !important;
        border-color: rgba(250, 140, 22, 0.45) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab--active::after {
        display: none !important;
      }

      /* Скрываем надписи "Чат" и "Участники" */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab__title {
        display: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab .dashboard-tab__icon-wrap {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* Таб 1 (Чат): иконка 13px ровно по центру пилюли */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:first-child {
        width: 28px !important;
        min-width: 28px !important;
        padding: 0 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:first-child .icon-container,
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:first-child svg {
        width: 13px !important;
        height: 13px !important;
        min-width: 13px !important;
        max-width: 13px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        color: var(--orange-6, #f97316) !important;
        fill: currentColor !important;
      }

      /* Таб 2 (Участники): скрываем силуэты людей */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:nth-child(2) .icon-container,
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:nth-child(2) svg {
        display: none !important;
      }

      /* Число участников в Табе 2: единая высота 22px, шрифт 11px, ровно на одной линии с чатом */
      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab:nth-child(2) {
        min-width: 28px !important;
        padding: 0 5px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab .dashboard-tab__badge {
        position: static !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        line-height: 1 !important;
        color: #22c55e !important;
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        min-width: unset !important;
        height: auto !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .dashboard-tab.dashboard-tab--active .dashboard-tab__badge {
        color: #ffffff !important;
      }

      /* Глобальная защита от залипания и помех iframes/video при активном перетаскивании */
      body.maxitet-is-dragging-active,
      body.maxitet-is-dragging-active * {
        user-select: none !important;
        -webkit-user-select: none !important;
      }

      body.maxitet-is-dragging-active iframe,
      body.maxitet-is-dragging-active #paint-frame,
      body.maxitet-is-dragging-active video {
        pointer-events: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__wrap,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-scroller,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__posted,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__content,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .participants,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .participants__list,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .participant-item,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-card,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .users-list,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-list__container,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-list,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-virtual-list,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-virtual-list__wrapper,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-virtual-list__content,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-virtual-list__item,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-list__item,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__border,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard-tab {
        background: transparent !important;
        background-color: transparent !important;
      }

      /* Карточки участников в Zen-режиме — стиль «жидкое стекло», единый со стилем чата */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-row,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .room-user-item {
        background: rgba(255, 255, 255, 0.05) !important;
        background-color: rgba(255, 255, 255, 0.05) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
        border-radius: 8px !important;
        margin-bottom: 4px !important;
        backdrop-filter: none !important;
        transition: background-color 0.18s ease, border-color 0.18s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-row:hover,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-row.pushed,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .room-user-item:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        background-color: rgba(255, 255, 255, 0.1) !important;
        border-color: rgba(255, 255, 255, 0.14) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-row__username {
        color: #f3f4f6 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-row__icons {
        color: #9ca3af !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .user-row__actions-btn:hover {
        background-color: rgba(255, 255, 255, 0.15) !important;
      }

      /* Шапка чата и участников */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__header,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__header-top,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .participants__header {
        background: rgba(255, 255, 255, 0.04) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      }

      /* Сообщения в Zen-режиме: растянуты на всю ширину с аккуратным отступом 4px от краёв окна */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__wrap:not([style*="display: none"]) {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        height: 100% !important;
        max-height: 100% !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        padding: 0 4px 6px 4px !important;
        overflow: hidden !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-scroller {
        padding: 0 2px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-scroller__item {
        margin-bottom: 5px !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble {
        position: relative !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        margin-bottom: 5px !important;
        padding: 0 !important;
        gap: 0 !important;
      }

      /* Скрываем массивные уголки-хвосты сообщений платформы */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__corn {
        display: none !important;
      }

      /* Аватарка спозиционирована в левом верхнем углу блока */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__avatar-wrap {
        position: absolute !important;
        left: 6px !important;
        top: 5px !important;
        right: auto !important;
        bottom: auto !important;
        z-index: 2 !important;
        pointer-events: none !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 16px !important;
        height: 16px !important;
        min-width: 16px !important;
        max-width: 16px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble .avatar.message__avatar,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble .user-avatar,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble [class*="avatar"] {
        width: 16px !important;
        height: 16px !important;
        min-width: 16px !important;
        max-width: 16px !important;
        border-radius: 50% !important;
        font-size: 7.5px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble .avatar__letters {
        font-size: 7.5px !important;
        line-height: 16px !important;
      }

      /* Блоки сообщений занимают ВСЮ ширину чата (100%) с отступом 4px от краёв контейнера */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_opponent,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_self,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_private {
        width: 100% !important;
        max-width: 100% !important;
        min-width: unset !important;
        box-sizing: border-box !important;
        position: relative !important;
        border-radius: 8px !important;
        background-color: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
        backdrop-filter: none !important;
        margin: 0 !important;
        /* Текст сообщения начинается с самого левого края (красная отметка 6px), справа отступ 32px под время */
        padding: 4px 32px 4px 6px !important;
      }

      /* Приватные сообщения — зелёный акцент */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_private {
        background-color: rgba(82, 196, 26, 0.14) !important;
        border: 1px solid rgba(82, 196, 26, 0.22) !important;
        border-left: 2.5px solid #22c55e !important;
      }

      /* Строка заголовка (Имя автора): отступ 20px слева, чтобы не залезать на аватарку, и 5px отступ снизу до текста */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__title {
        display: flex !important;
        align-items: center !important;
        min-height: 16px !important;
        margin-bottom: 5px !important;
        padding-left: 20px !important;
        padding-right: 0 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__name {
        font-size: 11px !important;
        line-height: 14px !important;
      }

      /* Контейнер текста: начинается С САМОГО ЛЕВОГО КРАЯ (с красной отметки под аватаркой) */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-container {
        padding-left: 0 !important;
        margin-left: 0 !important;
        width: 100% !important;
        display: block !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text {
        font-size: 11.5px !important;
        line-height: 14px !important;
        color: #f1f5f9 !important;
        word-break: break-word !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__time {
        position: absolute !important;
        right: 6px !important;
        bottom: 3px !important;
        font-size: 9px !important;
        line-height: 11px !important;
        opacity: 0.7 !important;
      }

      /* Опросы и голосования в Zen-режиме — единый стиль «жидкое стекло» */
      body.maxitet-zen-mode .dashboard-drawer .survey-card,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-card,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-card,
      body.maxitet-zen-mode .dashboard-drawer .survey-dashboard,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-dashboard,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-sidebar,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-sidebar {
        background: rgba(255, 255, 255, 0.05) !important;
        background-color: rgba(255, 255, 255, 0.05) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 12px !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        box-shadow: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card__header,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__header,
      body.maxitet-zen-mode .dashboard-drawer .survey-card-status,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card-status,
      body.maxitet-zen-mode .dashboard-drawer .survey-answers-preview,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-answers-preview,
      body.maxitet-zen-mode .dashboard-drawer .survey-card__collapsible-area,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__collapsible-area,
      body.maxitet-zen-mode .dashboard-drawer .survey-card__variants,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__variants,
      body.maxitet-zen-mode .dashboard-drawer .survey-card__variant-row,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__variant-row,
      body.maxitet-zen-mode .dashboard-drawer .survey-variant-progress__header,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-variant-progress__header,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-card__header,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-card__header,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-card__variants,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-card__variants {
        background: transparent !important;
        background-color: transparent !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card__title,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__title,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-card__title,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-card__title {
        color: #f3f4f6 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card-status__text,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card-status__text,
      body.maxitet-zen-mode .dashboard-drawer .survey-answers-preview__title,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-answers-preview__title,
      body.maxitet-zen-mode .dashboard-drawer .survey-variant-progress__title,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-variant-progress__title,
      body.maxitet-zen-mode .dashboard-drawer .survey-variant-progress__progress,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-variant-progress__progress {
        color: #d1d5db !important;
      }

      /* Варианты ответов / полосы прогресса в опросах */
      body.maxitet-zen-mode .dashboard-drawer .survey-card__variant-progress,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__variant-progress,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-card__variant,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-card__variant {
        background: rgba(255, 255, 255, 0.04) !important;
        background-color: rgba(255, 255, 255, 0.04) !important;
        border: 1px solid rgba(255, 255, 255, 0.05) !important;
        border-radius: 8px !important;
        padding: 6px 10px !important;
        transition: background-color 0.18s ease, border-color 0.18s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card__variant-progress:hover,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__variant-progress:hover {
        background: rgba(255, 255, 255, 0.08) !important;
        background-color: rgba(255, 255, 255, 0.08) !important;
        border-color: rgba(255, 255, 255, 0.12) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card .izi-progress-linear,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card .izi-progress-linear,
      body.maxitet-zen-mode .dashboard-drawer .survey-variant-progress .izi-progress-linear,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-variant-progress .izi-progress-linear {
        background: rgba(255, 255, 255, 0.12) !important;
        background-color: rgba(255, 255, 255, 0.12) !important;
        border-radius: 4px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card .izi-checkbox,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card .izi-checkbox {
        --background: rgba(255, 255, 255, 0.08) !important;
        --border-color: rgba(255, 255, 255, 0.25) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card__footer,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__footer,
      body.maxitet-zen-mode .dashboard-drawer .survey-question-card__footer,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-question-card__footer {
        background: transparent !important;
        background-color: transparent !important;
        border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
        padding-top: 8px !important;
        margin-top: 8px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card__hide-btn,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__hide-btn {
        color: #9ca3af !important;
      }

      body.maxitet-zen-mode .dashboard-drawer .survey-card__hide-btn:hover,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .survey-card__hide-btn:hover {
        color: #60a5fa !important;
        background-color: transparent !important;
      }

      /* Панель ввода Варианта 2 (Action Bar Group):
         Поле ввода + кнопка [Только преподу] + кнопка [Отправить] в ОДНУ компактную 32px строку!
         Ликвидирована отдельная строка для тумблера «Только преподавателю», сжиравшая высоту. */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions {
        position: relative !important;
        margin-top: 4px !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        min-height: 32px !important;
        background: transparent !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input {
        width: 100% !important;
        box-sizing: border-box !important;
        min-height: 32px !important;
        height: auto !important;
        max-height: 70px !important;
        padding: 3px 64px 3px 6px !important; /* место справа для двух 26px кнопок */
        border-radius: 8px !important;
        background-color: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        display: flex !important;
        align-items: flex-end !important;
        margin: 0 !important;
        position: relative !important;
        transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input:hover,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input:focus-within {
        border-color: rgba(255, 255, 255, 0.22) !important;
        background-color: rgba(255, 255, 255, 0.09) !important;
      }

      /* Поле ввода: 1 строка без скроллбара, 2-3 строки расширяется по вертикали, 4+ строки скролл */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input .textarea {
        field-sizing: content;
        font-size: 11.5px !important;
        line-height: 15px !important;
        min-height: 19px !important;
        max-height: 49px !important;
        height: auto !important;
        padding: 2px 0 !important;
        margin: 0 4px !important;
        color: #ffffff !important;
        resize: none !important;
        overflow-y: hidden; /* по умолчанию прокрутка полностью отключена */
        box-sizing: border-box !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input .textarea::-webkit-scrollbar {
        width: 3px !important;
        height: 0 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input .textarea::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.25) !important;
        border-radius: 3px !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input .textarea::-webkit-scrollbar-track {
        background: transparent !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input .emoji__button {
        align-self: flex-end !important;
        margin-bottom: 2px !important;
      }

      /* Кнопка отправки сообщения — прижата к нижнему правому углу */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input__send-button {
        position: absolute !important;
        right: 3px !important;
        bottom: 3px !important;
        top: auto !important;
        transform: none !important;
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: var(--orange-6) !important;
        border-radius: 6px !important;
        color: #000000 !important;
        border: none !important;
        cursor: pointer !important;
        z-index: 5 !important;
        transition: transform 0.15s ease, background-color 0.15s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input__send-button:hover {
        transform: scale(1.06) !important;
      }

      /* Кнопка «Только преподавателю» (Вариант 2) — расположена слева от кнопки отправки */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools {
        position: absolute !important;
        right: 33px !important;
        bottom: 3px !important;
        top: auto !important;
        transform: none !important;
        margin: 0 !important;
        padding: 0 !important;
        z-index: 5 !important;
        display: flex !important;
        align-items: center !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper {
        width: 26px !important;
        height: 26px !important;
        min-width: 26px !important;
        padding: 0 !important;
        border-radius: 6px !important;
        background: rgba(255, 255, 255, 0.07) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        position: relative !important;
        transition: all 0.18s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:hover {
        background: rgba(255, 255, 255, 0.16) !important;
        border-color: rgba(255, 255, 255, 0.24) !important;
        transform: scale(1.06) !important;
      }

      /* Скрываем громоздкую надпись «Только преподавателю» */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-text {
        display: none !important;
      }

      /* Скрываем дефолтный свитчер и оверлеи */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-switch {
        width: 16px !important;
        height: 16px !important;
        min-width: 16px !important;
        max-width: 16px !important;
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: transparent !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-switch__rail,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-switch__circle,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-switch__disable-overlay {
        display: none !important;
      }

      /* Иконка шапочки преподавателя через SVG mask */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .izi-switch::before {
        content: '' !important;
        display: block !important;
        width: 15px !important;
        height: 15px !important;
        background-color: #cbd5e1 !important;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 10v6M2 10l10-5 10 5-10 5z'/%3E%3Cpath d='M6 12v5c3 3 9 3 12 0v-5'/%3E%3C/svg%3E") no-repeat center / contain !important;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 10v6M2 10l10-5 10 5-10 5z'/%3E%3Cpath d='M6 12v5c3 3 9 3 12 0v-5'/%3E%3C/svg%3E") no-repeat center / contain !important;
        transition: background-color 0.18s ease, transform 0.18s ease !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:hover .izi-switch::before {
        background-color: #ffffff !important;
      }

      /* Активное состояние кнопки «Только преподавателю»: зеленый фон с изумрудным свечением */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:has(.checked),
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:has(input:checked) {
        background: #16a34a !important;
        border-color: #22c55e !important;
        box-shadow: 0 0 10px rgba(34, 197, 94, 0.45) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:has(.checked) .izi-switch::before,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:has(input:checked) .izi-switch::before {
        background-color: #ffffff !important;
        transform: scale(1.08) !important;
      }

      /* Приватный режим: мягкая зеленая подсветка поля ввода */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open:has(.chat-actions__tools-switch-wrapper:has(.checked)) .message-input,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open:has(.chat-actions__tools-switch-wrapper:has(input:checked)) .message-input {
        border-color: rgba(34, 197, 94, 0.45) !important;
        background-color: rgba(34, 197, 94, 0.06) !important;
        box-shadow: 0 0 12px rgba(34, 197, 94, 0.15) !important;
      }

      /* Всплывающая подсказка при наведении на кнопку */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper::after {
        content: 'Только преподавателю' !important;
        position: absolute !important;
        bottom: calc(100% + 6px) !important;
        right: 0 !important;
        padding: 3px 7px !important;
        border-radius: 6px !important;
        background: rgba(16, 20, 28, 0.94) !important;
        backdrop-filter: blur(8px) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        color: #ffffff !important;
        font-size: 10.5px !important;
        font-weight: 500 !important;
        white-space: nowrap !important;
        pointer-events: none !important;
        opacity: 0 !important;
        transform: translateY(3px) !important;
        transition: opacity 0.18s ease, transform 0.18s ease !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5) !important;
        z-index: 9999 !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions__tools-switch-wrapper:hover::after {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }

      /* Родные стили для обычного режима (smart-dark) остаются полностью нетронутыми */
      body:not(.maxitet-zen-mode).maxitet-smart-dark .chat-actions {
        background: transparent !important;
        padding: 4px 0 6px !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .chat-actions__tools {
        margin-bottom: 6px !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .chat-actions__tools-switch-wrapper {
        display: inline-flex !important;
        align-items: center !important;
        gap: 9px !important;
        cursor: pointer !important;
        padding: 4px 10px 4px 6px !important;
        border-radius: 20px !important;
        user-select: none !important;
        background: rgba(255, 255, 255, 0.05) !important;
        border: 1px solid rgba(255, 255, 255, 0.09) !important;
        transition: background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .chat-actions__tools-switch-wrapper:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        border-color: rgba(255, 255, 255, 0.18) !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .chat-actions__tools-switch-text {
        color: #d1d5db !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        line-height: 16px !important;
        cursor: pointer !important;
        transition: color 0.18s ease !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .chat-actions__tools-switch-wrapper:hover .chat-actions__tools-switch-text {
        color: #ffffff !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch__disable-overlay {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch {
        position: relative !important;
        width: 30px !important;
        min-width: 30px !important;
        max-width: 30px !important;
        height: 16px !important;
        min-height: 16px !important;
        max-height: 16px !important;
        cursor: pointer !important;
        display: inline-block !important;
        vertical-align: middle !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch__rail {
        width: 30px !important;
        height: 16px !important;
        border-radius: 10px !important;
        background: rgba(255, 255, 255, 0.16) !important;
        background-color: rgba(255, 255, 255, 0.16) !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        box-sizing: border-box !important;
        transition: background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch__circle {
        position: absolute !important;
        width: 12px !important;
        height: 12px !important;
        top: 2px !important;
        left: 2px !important;
        transform: none !important;
        border-radius: 50% !important;
        background: #ffffff !important;
        background-color: #ffffff !important;
        border: none !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45) !important;
        transition: left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.2s ease !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch:has(.checked) .izi-switch__rail,
      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch:has(input:checked) .izi-switch__rail {
        background: #2563eb !important;
        background-color: #2563eb !important;
        border-color: #3b82f6 !important;
        box-shadow: 0 0 10px rgba(37, 99, 235, 0.4) !important;
      }

      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch:has(.checked) .izi-switch__circle,
      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch:has(input:checked) .izi-switch__circle,
      body:not(.maxitet-zen-mode).maxitet-smart-dark .izi-switch__circle.checked {
        left: 16px !important;
        transform: none !important;
        background: #ffffff !important;
        background-color: #ffffff !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__tabs {
        background: rgba(30, 32, 34, 0.65) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }

      /* Тултипы кнопок управления (камера, микрофон, демонстрация, настройки, реакции)
         полностью скрыты как в обычном, так и в zen-режиме, чтобы не захламлять экран */
      .izi-tooltip:not(.message-actions__tooltip) {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* Селектор стикеров/смайликов поверх всплывающего чата в Дзене */
      body.maxitet-zen-mode .izi-menu,
      body.maxitet-zen-mode .v3-emoji-picker,
      body.maxitet-zen-mode [class*="izi-menu"],
      body.maxitet-zen-mode [class*="emoji-picker"] {
        z-index: 2147483647 !important;
      }

      /* Устранение наложения имени отправителя на время в чате */
      .message-bubble__text-block {
        min-height: 48px !important;
        min-width: 140px !important;
        padding-right: 48px !important;
      }

      .message-bubble__title {
        padding-right: 42px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .message-bubble__time {
        position: absolute !important;
        right: 10px !important;
        bottom: 6px !important;
        font-size: 10px !important;
        line-height: 12px !important;
      }

      /* Всплывающие реакции: скрыты от случайного наведения курсора */
      .message-actions__tooltip:not(.maxitet-actions-open) {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transform: scale(0.82) translateY(8px) !important;
        transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease !important;
      }

      /* Показываются только при нажатии на кнопку вызова реакций */
      .message-actions__tooltip.maxitet-actions-open {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        transform: scale(1) translateY(0) !important;
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease !important;
        z-index: 2147483647 !important;
      }

      .message-actions__tooltip .message-actions__item {
        transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.18s ease !important;
      }
      .message-actions__tooltip .message-actions__item:hover {
        transform: scale(1.25) translateY(-3px) !important;
      }
      .message-actions__tooltip .message-actions__item:active {
        transform: scale(0.92) !important;
      }

      /* Кнопка вызова реакций и ответа на сообщении */
      .maxitet-msg-action-btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 22px !important;
        height: 22px !important;
        border-radius: 7px !important;
        background: rgba(255, 255, 255, 0.1) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        color: #d9d9d9 !important;
        cursor: pointer !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transform: scale(0.85) !important;
        transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease, background 0.18s ease !important;
        position: absolute !important;
        top: 6px !important;
        right: 6px !important;
        z-index: 10 !important;
        padding: 0 !important;
        line-height: 1 !important;
      }

      .message-bubble:hover .maxitet-msg-action-btn,
      .message-bubble__text-block:hover .maxitet-msg-action-btn {
        opacity: 0.85 !important;
        transform: scale(1) !important;
        pointer-events: auto !important;
      }

      .maxitet-msg-action-btn:hover {
        opacity: 1 !important;
        background: rgba(255, 255, 255, 0.26) !important;
        color: #ffffff !important;
        transform: scale(1.15) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
      }

      .maxitet-msg-action-btn:active {
        transform: scale(0.92) !important;
      }

      /* Скрытие докбара в PiP и 100% окне */
      body.maxitet-pip-active #maxitet-side-dock {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* ═══════════ Унифицированный плавающий докбар Дзена (Liquid Slate Glass) ═══════════ */
      /* Точь-в-точь по стилю чата: статичный, одинаковый при включенном и выключенном чате */
      #maxitet-side-dock {
        position: fixed !important;
        display: none !important;
        flex-direction: row !important;
        align-items: center !important;
        padding: 7px 10px !important;
        gap: 8px !important;
        border-radius: 18px !important;
        cursor: default !important;
        touch-action: none !important;
        width: max-content !important;
        max-width: calc(100vw - 16px) !important;
        box-sizing: border-box !important;
        z-index: 2147483645 !important;

        /* Точь-в-точь материалы чата: Slate Glass, 72% прозрачность, 3px размытие, 1px бордер */
        background: rgba(22, 24, 25, 0.72) !important;
        backdrop-filter: blur(3px) !important;
        -webkit-backdrop-filter: blur(3px) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.12) !important;

        opacity: 0 !important;
        pointer-events: none !important;
        user-select: none !important;
      }

      body.maxitet-zen-mode #maxitet-side-dock {
        display: flex !important;
        opacity: 1 !important;
        pointer-events: all !important;
      }

      /* Положение по дефолту: снизу чата (или в правом нижнем углу при закрытом чате) */
      body.maxitet-zen-mode #maxitet-side-dock:not(.is-dragged):not([style*="left"]) {
        right: 188px !important;
        top: min(calc(50% + min(265px, 42vh) + 12px), calc(100vh - 66px)) !important;
        transform: translateX(50%) !important;
      }

      /* Свободное плавание после перетаскивания пользователем */
      body.maxitet-zen-mode #maxitet-side-dock.is-dragged,
      body.maxitet-zen-mode #maxitet-side-dock[style*="left"] {
        right: auto !important;
        bottom: auto !important;
        transform: none !important;
      }

      /* Перетаскивание панели */
      body.maxitet-zen-mode #maxitet-side-dock.is-dragging {
        user-select: none !important;
      }

      /* Ручка для перетаскивания (grip 6 точек) - ВСЕГДА видна и при вкл, и при выкл чате */
      #maxitet-side-dock .maxitet-dock-drag-handle {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 18px !important;
        height: 38px !important;
        color: rgba(255, 255, 255, 0.5) !important;
        cursor: grab !important;
        padding: 0 2px !important;
        user-select: none !important;
        touch-action: none !important;
        transition: color 0.15s ease !important;
      }

      #maxitet-side-dock .maxitet-dock-drag-handle:hover {
        color: #ffffff !important;
      }

      #maxitet-side-dock.is-dragging .maxitet-dock-drag-handle {
        cursor: grabbing !important;
        color: #ffffff !important;
      }

      /* Кнопки внутри докбара - статичные, аккуратные */
      /* Вертикальная ориентация докбара (переключение колёсиком по 6 точкам) */
      #maxitet-side-dock.is-vertical {
        flex-direction: column !important;
        padding: 10px 7px !important;
        gap: 8px !important;
        width: auto !important;
        height: max-content !important;
      }
      #maxitet-side-dock.is-vertical .maxitet-dock-divider {
        width: 22px !important;
        height: 1px !important;
        margin: 4px 0 !important;
      }
      #maxitet-side-dock.is-vertical .maxitet-dock-drag-handle {
        width: 38px !important;
        height: 16px !important;
      }

      #maxitet-side-dock .maxitet-dock-btn {
        width: 38px !important;
        height: 38px !important;
        border-radius: 11px !important;
        background: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        color: #e5e7eb !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease !important;
      }

      #maxitet-side-dock .maxitet-dock-btn svg {
        stroke: currentColor !important;
      }

      #maxitet-side-dock .maxitet-dock-btn:hover {
        background: rgba(255, 255, 255, 0.15) !important;
        border-color: rgba(255, 255, 255, 0.22) !important;
        color: #ffffff !important;
      }

      #maxitet-side-dock .maxitet-dock-btn:active {
        transform: scale(0.95) !important;
      }

      /* Вертикальный разделитель */
      #maxitet-side-dock .maxitet-dock-divider {
        width: 1px !important;
        height: 22px !important;
        background: rgba(255, 255, 255, 0.12) !important;
        margin: 0 4px !important;
      }

      /* Активные состояния кнопок с гарантированной заливкой цвета */
      #maxitet-side-dock .maxitet-dock-btn.is-active-cam {
        background: #1890ff !important;
        border-color: #40a9ff !important;
        color: #ffffff !important;
        box-shadow: 0 4px 14px rgba(24, 144, 255, 0.45) !important;
      }

      #maxitet-side-dock .maxitet-dock-btn.is-active-mic {
        background: #27ae60 !important;
        border-color: #2ecc71 !important;
        color: #ffffff !important;
        box-shadow: 0 4px 14px rgba(39, 174, 96, 0.45) !important;
      }

      #maxitet-side-dock .maxitet-dock-btn.is-active-chat {
        background: rgba(255, 255, 255, 0.22) !important;
        border-color: rgba(255, 255, 255, 0.35) !important;
        color: #ffffff !important;
      }

      /* ═══════════ Изменение размера чата в Дзене ═══════════ */
      body.maxitet-zen-mode .dashboard-drawer {
        min-width: 260px !important;
        min-height: 260px !important;
      }

      /* Ручки ресайза активны ТОЛЬКО в Дзене при открытом чате */
      body:not(.maxitet-zen-mode) .maxitet-chat-resize-handle,
      body:not(.maxitet-zen-chat-open) .maxitet-chat-resize-handle {
        display: none !important;
      }

      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle {
        position: absolute !important;
        z-index: 200 !important;
        touch-action: none !important;
        user-select: none !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-l {
        left: -5px !important;
        top: 0 !important;
        width: 10px !important;
        height: 100% !important;
        cursor: ew-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-r {
        right: -5px !important;
        top: 0 !important;
        width: 10px !important;
        height: 100% !important;
        cursor: ew-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-b {
        bottom: -5px !important;
        left: 0 !important;
        width: 100% !important;
        height: 10px !important;
        cursor: ns-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-t {
        top: -5px !important;
        left: 0 !important;
        width: 100% !important;
        height: 10px !important;
        cursor: ns-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-bl {
        left: -5px !important;
        bottom: -5px !important;
        width: 16px !important;
        height: 16px !important;
        cursor: nesw-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-br {
        right: -5px !important;
        bottom: -5px !important;
        width: 16px !important;
        height: 16px !important;
        cursor: nwse-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-tl {
        left: -5px !important;
        top: -5px !important;
        width: 16px !important;
        height: 16px !important;
        cursor: nwse-resize !important;
      }
      body.maxitet-zen-mode.maxitet-zen-chat-open .maxitet-chat-resize-handle.handle-tr {
        right: -5px !important;
        top: -5px !important;
        width: 16px !important;
        height: 16px !important;
        cursor: nesw-resize !important;
      }

      /* ═══════════ Приближение демонстрации и презентации в Дзене ═══════════ */
      body.maxitet-zen-mode .meeting__screen-sharing-area {
        position: relative !important;
        overflow: hidden !important;
      }

      body.maxitet-zen-mode .sharing__inner {
        transform-origin: 0 0 !important;
        will-change: transform !important;
      }

      body.maxitet-zen-mode .meeting__screen-sharing-area.can-pan {
        cursor: grab !important;
      }
      body.maxitet-zen-mode .meeting__screen-sharing-area.is-panning {
        cursor: grabbing !important;
      }

      /* Всплывающий индикатор зума (HUD) */
      .maxitet-zen-zoom-hud {
        position: fixed !important;
        top: 22px !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(-10px) !important;
        background: rgba(22, 24, 25, 0.85) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important;
        color: #f3f4f6 !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        padding: 5px 14px !important;
        border-radius: 20px !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        opacity: 0 !important;
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      .maxitet-zen-zoom-hud.visible {
        opacity: 1 !important;
        transform: translateX(-50%) translateY(0) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  let isDockDragging = false;
  let dockPointerDown = false;
  let dockStartX = 0, dockStartY = 0;
  let dockInitialLeft = 0, dockInitialTop = 0;
  let dockDidDrag = false;
  let dockCurrentPointerId = null;

  function resetZenDockPosition() {
    const dock = document.getElementById('maxitet-side-dock');
    if (!dock) return;
    dock.classList.remove('is-dragged');
    dock.classList.remove('is-dragging');
    dock.style.removeProperty('left');
    dock.style.removeProperty('top');
    dock.style.removeProperty('right');
    dock.style.removeProperty('bottom');
    dock.style.removeProperty('transform');
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['maxitet_zen_dock_geometry']);
    }
  }

  function initZenDockDraggable(dock) {
    if (!dock || dock._dragInitialized) return;
    dock._dragInitialized = true;
    if (isZenModeActive && document.body.classList.contains('maxitet-zen-mode')) {
      restoreZenDockGeometry(dock);
    }

    // Смена ориентации (горизонтальная / вертикальная) по колёсику мыши на ручке с 6 точками
    const dockHandle = dock.querySelector('.maxitet-dock-drag-handle, #maxitet-dock-drag-handle');
    if (dockHandle) {
      dockHandle.addEventListener('wheel', (e) => {
        if (!isZenModeActive) return;
        e.preventDefault();
        e.stopPropagation();
        const isVert = dock.classList.toggle('is-vertical');
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ zenDockVertical: isVert });
        }
      }, { passive: false });
    }

    let lastDockTapTime = 0;
    dock.addEventListener('pointerdown', (e) => {
      if (!isZenModeActive) return;
      if (e.button !== 0) return;

      // Надежный дабл-клик по ручке с 6 точками для сброса позиции в дефолт
      if (e.target.closest('.maxitet-dock-drag-handle, #maxitet-dock-drag-handle')) {
        const now = Date.now();
        if (now - lastDockTapTime < 380) {
          resetZenDockPosition();
          lastDockTapTime = 0;
          return;
        }
        lastDockTapTime = now;
      }

      // Перетаскивание панели разрешено ТОЛЬКО за ручку с 6 точками (.maxitet-dock-drag-handle)
      if (!e.target.closest('.maxitet-dock-drag-handle, #maxitet-dock-drag-handle')) {
        return;
      }

      dockPointerDown = true;
      isDockDragging = false;
      dockDidDrag = false;
      dockCurrentPointerId = e.pointerId;
      dockStartX = e.clientX;
      dockStartY = e.clientY;

      const rect = dock.getBoundingClientRect();
      dockInitialLeft = rect.left;
      dockInitialTop = rect.top;

      try {
        dock.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    const onDockPointerMove = (e) => {
      if (!dockPointerDown) return;

      // Защита от залипания: если клавиша мыши была отпущена вне окна или над iframe при резком взмахе
      if (e.pointerType === 'mouse' && (e.buttons === 0 || !(e.buttons & 1))) {
        stopDockDrag(e);
        return;
      }

      const dx = e.clientX - dockStartX;
      const dy = e.clientY - dockStartY;

      if (!isDockDragging && Math.hypot(dx, dy) > 4) {
        isDockDragging = true;
        dockDidDrag = true;
        dock.classList.add('is-dragging');
        dock.classList.add('is-dragged');
        document.body.classList.add('maxitet-is-dragging-active');
      }

      if (isDockDragging) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        const rect = dock.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        let newLeft = dockInitialLeft + dx;
        let newTop = dockInitialTop + dy;

        const minX = 8;
        const maxX = window.innerWidth - w - 8;
        const minY = 8;
        const maxY = window.innerHeight - h - 8;

        newLeft = Math.max(minX, Math.min(maxX, newLeft));
        newTop = Math.max(minY, Math.min(maxY, newTop));

        dock.style.setProperty('left', `${newLeft}px`, 'important');
        dock.style.setProperty('top', `${newTop}px`, 'important');
        dock.style.setProperty('right', 'auto', 'important');
        dock.style.setProperty('bottom', 'auto', 'important');
        dock.style.setProperty('transform', 'none', 'important');
      }
    };

    window.addEventListener('pointermove', onDockPointerMove, { passive: false });
    dock.addEventListener('pointermove', onDockPointerMove, { passive: false });

    const stopDockDrag = (e) => {
      if (!dockPointerDown) return;
      dockPointerDown = false;
      const pid = (e && e.pointerId != null) ? e.pointerId : dockCurrentPointerId;
      if (pid != null) {
        try {
          if (dock.hasPointerCapture(pid)) {
            dock.releasePointerCapture(pid);
          }
        } catch (_) {}
      }
      dockCurrentPointerId = null;
      document.body.classList.remove('maxitet-is-dragging-active');
      if (isDockDragging) {
        isDockDragging = false;
        dock.classList.remove('is-dragging');
        saveZenDockGeometry();
        setTimeout(() => {
          dockDidDrag = false;
        }, 120);
      }
    };

    window.addEventListener('pointerup', stopDockDrag);
    window.addEventListener('pointercancel', stopDockDrag);
    window.addEventListener('blur', stopDockDrag);
    dock.addEventListener('pointerup', stopDockDrag);
    dock.addEventListener('pointercancel', stopDockDrag);
    dock.addEventListener('lostpointercapture', stopDockDrag);

    // Глушим клик по кнопкам, если произошло перетаскивание
    dock.addEventListener('click', (e) => {
      if (dockDidDrag) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);

    // Двойной клик возвращает панель на дефолтную позицию снизу фрейма чата
    dock.addEventListener('dblclick', (e) => {
      if (!isZenModeActive || !document.body.classList.contains('maxitet-zen-chat-open')) return;
      resetZenDockPosition();
    });

    window.addEventListener('resize', () => {
      if (!dock.classList.contains('is-dragged') || !document.body.classList.contains('maxitet-zen-chat-open')) return;
      const rect = dock.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      if (rect.left > maxX || rect.top > maxY) {
        dock.style.setProperty('left', `${Math.max(8, Math.min(maxX, rect.left))}px`, 'important');
        dock.style.setProperty('top', `${Math.max(8, Math.min(maxY, rect.top))}px`, 'important');
      }
    });
  }

  let isChatDragging = false;
  let chatPointerDown = false;
  let chatStartX = 0, chatStartY = 0;
  let chatInitialLeft = 0, chatInitialTop = 0;
  let chatDidDrag = false;
  let chatCurrentPointerId = null;

  function saveZenChatGeometry() {
    const drawer = document.querySelector('.dashboard-drawer');
    if (!drawer || !drawer.classList.contains('is-dragged')) return;
    const rect = drawer.getBoundingClientRect();
    const geom = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ maxitet_zen_chat_geometry: geom });
    }
  }

  function cleanupZenChatStyles(drawer) {
    if (!drawer) drawer = document.querySelector('.dashboard-drawer');
    if (!drawer) return;
    drawer.classList.remove('maxitet-floating-chat-open');
    drawer.classList.remove('is-dragged');
    drawer.classList.remove('is-dragging');
    drawer.style.removeProperty('left');
    drawer.style.removeProperty('top');
    drawer.style.removeProperty('right');
    drawer.style.removeProperty('bottom');
    drawer.style.removeProperty('transform');
    drawer.style.removeProperty('width');
    drawer.style.removeProperty('height');
    const textarea = drawer.querySelector('.message-input .textarea');
    if (textarea) {
      textarea.style.height = '';
      textarea.style.overflowY = '';
    }
  }

  function restoreZenChatGeometry(drawer) {
    if (!isZenModeActive || !document.body.classList.contains('maxitet-zen-mode')) return;
    if (!drawer) drawer = document.querySelector('.dashboard-drawer');
    if (!drawer) return;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['maxitet_zen_chat_geometry'], (res) => {
        if (!isZenModeActive || !document.body.classList.contains('maxitet-zen-mode')) return;
        const geom = res && res.maxitet_zen_chat_geometry;
        if (!geom || typeof geom.left !== 'number') return;
        const w = Math.max(260, Math.min(window.innerWidth - 16, geom.width || 340));
        const h = Math.max(260, Math.min(window.innerHeight - 16, geom.height || 530));
        const maxX = window.innerWidth - w - 8;
        const maxY = window.innerHeight - h - 8;
        const safeL = Math.max(8, Math.min(maxX, geom.left));
        const safeT = Math.max(8, Math.min(maxY, geom.top));

        drawer.classList.add('is-dragged');
        drawer.style.setProperty('left', `${safeL}px`, 'important');
        drawer.style.setProperty('top', `${safeT}px`, 'important');
        drawer.style.setProperty('width', `${w}px`, 'important');
        drawer.style.setProperty('height', `${h}px`, 'important');
        drawer.style.setProperty('right', 'auto', 'important');
        drawer.style.setProperty('bottom', 'auto', 'important');
        drawer.style.setProperty('transform', 'none', 'important');

        chatResizeWidth = w;
        chatResizeHeight = h;
      });
    }
  }

  function saveZenDockGeometry() {
    const dock = document.getElementById('maxitet-side-dock');
    if (!dock || !dock.classList.contains('is-dragged')) return;
    const rect = dock.getBoundingClientRect();
    const geom = {
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    };
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ maxitet_zen_dock_geometry: geom });
    }
  }

  function restoreZenDockGeometry(dock) {
    if (!isZenModeActive || !document.body.classList.contains('maxitet-zen-mode')) return;
    if (!dock) dock = document.getElementById('maxitet-side-dock');
    if (!dock) return;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['maxitet_zen_dock_geometry'], (res) => {
        if (!isZenModeActive || !document.body.classList.contains('maxitet-zen-mode')) return;
        const geom = res && res.maxitet_zen_dock_geometry;
        if (!geom || typeof geom.left !== 'number') return;
        const rect = dock.getBoundingClientRect();
        const dockW = rect.width || 280;
        const dockH = rect.height || 40;
        const maxX = window.innerWidth - dockW - 8;
        const maxY = window.innerHeight - dockH - 8;
        const safeL = Math.max(8, Math.min(maxX, geom.left));
        const safeT = Math.max(8, Math.min(maxY, geom.top));

        dock.classList.add('is-dragged');
        dock.style.setProperty('left', `${safeL}px`, 'important');
        dock.style.setProperty('top', `${safeT}px`, 'important');
        dock.style.setProperty('right', 'auto', 'important');
        dock.style.setProperty('bottom', 'auto', 'important');
        dock.style.setProperty('transform', 'none', 'important');
      });
    }
  }

  function resetZenChatPosition() {
    const drawer = document.querySelector('.dashboard-drawer');
    if (!drawer) return;
    drawer.classList.remove('is-dragged');
    drawer.classList.remove('is-dragging');
    drawer.style.removeProperty('left');
    drawer.style.removeProperty('top');
    drawer.style.removeProperty('right');
    drawer.style.removeProperty('bottom');
    drawer.style.removeProperty('transform');
    drawer.style.removeProperty('width');
    drawer.style.removeProperty('height');
    chatResizeWidth = null;
    chatResizeHeight = null;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['maxitet_zen_chat_geometry']);
    }
    window.dispatchEvent(new Event('resize'));
  }

  function initZenChatDraggable(drawer) {
    if (!drawer || drawer._chatDragInitialized) return;
    drawer._chatDragInitialized = true;
    initZenChatResizable(drawer);
    if (isZenModeActive && document.body.classList.contains('maxitet-zen-mode')) {
      restoreZenChatGeometry(drawer);
    }

    const isDragArea = (target) => {
      if (!target) return false;
      // Перетаскивание чата разрешено ТОЛЬКО за 6 точек кнопки (.dashboard-toggler)
      return Boolean(target.closest('.dashboard-toggler'));
    };

    let lastChatTapTime = 0;
    drawer.addEventListener('pointerdown', (e) => {
      if (!isZenModeActive || !drawer.classList.contains('maxitet-floating-chat-open')) {
        return;
      }
      if (e.button !== 0) return;

      // Надежный дабл-клик по 6 точкам или шапке окна чата для сброса позиции и дефолтного размера
      if (e.target.closest('.dashboard-toggler, .dashboard__header, .dashboard__tabs, .dashboard__header-top')) {
        const now = Date.now();
        if (now - lastChatTapTime < 380) {
          resetZenChatPosition();
          lastChatTapTime = 0;
          return;
        }
        lastChatTapTime = now;
      }

      if (!isDragArea(e.target)) return;

      chatPointerDown = true;
      isChatDragging = false;
      chatDidDrag = false;
      chatCurrentPointerId = e.pointerId;
      chatStartX = e.clientX;
      chatStartY = e.clientY;

      const rect = drawer.getBoundingClientRect();
      chatInitialLeft = rect.left;
      chatInitialTop = rect.top;

      try {
        drawer.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    const onChatPointerMove = (e) => {
      if (!chatPointerDown) return;

      // Защита от залипания при быстром резком перетаскивании
      if (e.pointerType === 'mouse' && (e.buttons === 0 || !(e.buttons & 1))) {
        stopChatDrag(e);
        return;
      }

      const dx = e.clientX - chatStartX;
      const dy = e.clientY - chatStartY;

      if (!isChatDragging && Math.hypot(dx, dy) > 4) {
        isChatDragging = true;
        chatDidDrag = true;
        drawer.classList.add('is-dragging');
        drawer.classList.add('is-dragged');
        document.body.classList.add('maxitet-is-dragging-active');
      }

      if (isChatDragging) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        const rect = drawer.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        let newLeft = chatInitialLeft + dx;
        let newTop = chatInitialTop + dy;

        const minX = 8;
        const maxX = window.innerWidth - w - 8;
        const minY = 8;
        const maxY = window.innerHeight - h - 8;

        newLeft = Math.max(minX, Math.min(maxX, newLeft));
        newTop = Math.max(minY, Math.min(maxY, newTop));

        drawer.style.setProperty('left', `${newLeft}px`, 'important');
        drawer.style.setProperty('top', `${newTop}px`, 'important');
        drawer.style.setProperty('right', 'auto', 'important');
        drawer.style.setProperty('bottom', 'auto', 'important');

// Чат и докбар полностью независимы друг от друга
      }
    };

    window.addEventListener('pointermove', onChatPointerMove, { passive: false });
    drawer.addEventListener('pointermove', onChatPointerMove, { passive: false });

    const stopChatDrag = (e) => {
      if (!chatPointerDown) return;
      chatPointerDown = false;
      const pid = (e && e.pointerId != null) ? e.pointerId : chatCurrentPointerId;
      if (pid != null) {
        try {
          if (drawer.hasPointerCapture(pid)) {
            drawer.releasePointerCapture(pid);
          }
        } catch (_) {}
      }
      chatCurrentPointerId = null;
      document.body.classList.remove('maxitet-is-dragging-active');
      if (isChatDragging) {
        isChatDragging = false;
        drawer.classList.remove('is-dragging');
        saveZenChatGeometry();
        setTimeout(() => {
          chatDidDrag = false;
        }, 120);
      }
    };

    window.addEventListener('pointerup', stopChatDrag);
    window.addEventListener('pointercancel', stopChatDrag);
    window.addEventListener('blur', stopChatDrag);
    drawer.addEventListener('pointerup', stopChatDrag);
    drawer.addEventListener('pointercancel', stopChatDrag);
    drawer.addEventListener('lostpointercapture', stopChatDrag);

    // Блокируем схлопывание чата в Zen-режиме при клике по кнопке с 6 точками (.dashboard-toggler)
    drawer.addEventListener('click', (e) => {
      if (isZenModeActive && e.target.closest('.dashboard-toggler')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      if (chatDidDrag) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);

    // Подсказка на кнопке
    drawer.querySelectorAll('.dashboard-toggler').forEach((btn) => {
      btn.setAttribute('title', 'Перетащить окно чата (Двойной клик — сброс позиции)');
    });

    // Двойной клик возвращает чат (и докбар) на начальную позицию
    drawer.addEventListener('dblclick', (e) => {
      if (!isZenModeActive || !drawer.classList.contains('maxitet-floating-chat-open')) return;
      if (e.target.closest('.dashboard-toggler, .dashboard__header, .dashboard__tabs, .dashboard__header-top')) {
        resetZenChatPosition();
        resetZenDockPosition();
      }
    });

    window.addEventListener('resize', () => {
      if (!drawer.classList.contains('is-dragged') || !isZenModeActive) return;
      const rect = drawer.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      if (rect.left > maxX || rect.top > maxY) {
        drawer.style.setProperty('left', `${Math.max(8, Math.min(maxX, rect.left))}px`, 'important');
        drawer.style.setProperty('top', `${Math.max(8, Math.min(maxY, rect.top))}px`, 'important');
      }
    });

    // Динамическое расширение поля ввода (1-3 строки) без полосы прокрутки по умолчанию
    drawer.addEventListener('input', (e) => {
      if (!isZenModeActive) return;
      if (e.target && e.target.classList && e.target.classList.contains('textarea')) {
        handleChatTextareaResize(e.target);
      }
    });

    drawer.addEventListener('keydown', (e) => {
      if (!isZenModeActive) return;
      if (e.target && e.target.classList && e.target.classList.contains('textarea')) {
        if (e.key === 'Enter' && !e.shiftKey) {
          setTimeout(() => handleChatTextareaResize(e.target), 20);
        }
      }
    });

    drawer.addEventListener('click', (e) => {
      if (!isZenModeActive) return;
      if (e.target && e.target.closest('.message-input__send-button')) {
        setTimeout(() => {
          const textarea = drawer.querySelector('.message-input .textarea');
          if (textarea) handleChatTextareaResize(textarea);
        }, 20);
      }
    });
  }

  function handleChatTextareaResize(textarea) {
    if (!textarea || !isZenModeActive) return;
    textarea.style.height = 'auto';
    const lineHeight = 15;
    const padding = 4;
    const maxHeight = lineHeight * 3 + padding; // 49px = ровно 3 строки
    const scrollH = textarea.scrollHeight;
    if (scrollH > maxHeight + 2) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.height = `${Math.max(19, scrollH)}px`;
      textarea.style.overflowY = 'hidden';
    }
  }

  // ─── Изменение размера чата в Дзен-режиме ───────────────────
  let chatResizeWidth = null;
  let chatResizeHeight = null;

  function initZenChatResizable(drawer) {
    if (!drawer || drawer._chatResizeInitialized) return;
    drawer._chatResizeInitialized = true;

    const handles = [
      { dir: 'l', class: 'handle-l' },
      { dir: 'r', class: 'handle-r' },
      { dir: 'b', class: 'handle-b' },
      { dir: 't', class: 'handle-t' },
      { dir: 'bl', class: 'handle-bl' },
      { dir: 'br', class: 'handle-br' },
      { dir: 'tl', class: 'handle-tl' },
      { dir: 'tr', class: 'handle-tr' },
    ];

    handles.forEach(h => {
      const el = document.createElement('div');
      el.className = `maxitet-chat-resize-handle ${h.class}`;
      el.dataset.dir = h.dir;
      drawer.appendChild(el);
    });

    let isResizing = false;
    let resizeDir = '';
    let startX = 0, startY = 0;
    let startW = 0, startH = 0;
    let startL = 0, startT = 0;

    drawer.addEventListener('pointerdown', (e) => {
      if (!isZenModeActive || !document.body.classList.contains('maxitet-zen-chat-open')) return;
      if (e.button !== 0) return;

      const handle = e.target.closest('.maxitet-chat-resize-handle');
      if (!handle) return;

      e.stopPropagation();
      e.preventDefault();

      resizeDir = handle.dataset.dir;
      startX = e.clientX;
      startY = e.clientY;

      const rect = drawer.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      startL = rect.left;
      startT = rect.top;

      drawer.style.setProperty('left', `${startL}px`, 'important');
      drawer.style.setProperty('top', `${startT}px`, 'important');
      drawer.style.setProperty('right', 'auto', 'important');
      drawer.style.setProperty('bottom', 'auto', 'important');
      drawer.style.setProperty('transform', 'none', 'important');
      drawer.classList.add('is-dragged');

      isResizing = true;
      document.body.classList.add('maxitet-is-dragging-active');

      try {
        handle.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    const onPointerMove = (e) => {
      if (!isResizing) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const minW = 260;
      const minH = 260;

      let newW = startW;
      let newH = startH;
      let newL = startL;
      let newT = startT;

      // Правый край (r): левый край startL неподвижен
      if (resizeDir.includes('r')) {
        const maxW = Math.max(minW, window.innerWidth - 8 - startL);
        newW = Math.max(minW, Math.min(maxW, startW + dx));
        newL = startL;
      }

      // Левый край (l): правый край R = startL + startW неподвижен
      if (resizeDir.includes('l')) {
        const R = startL + startW;
        const maxW = Math.max(minW, R - 8);
        newW = Math.max(minW, Math.min(maxW, startW - dx));
        newL = R - newW;
      }

      // Нижний край (b): верхний край startT неподвижен
      if (resizeDir.includes('b')) {
        const maxH = Math.max(minH, window.innerHeight - 8 - startT);
        newH = Math.max(minH, Math.min(maxH, startH + dy));
        newT = startT;
      }

      // Верхний край (t): нижний край B = startT + startH неподвижен
      if (resizeDir.includes('t')) {
        const B = startT + startH;
        const maxH = Math.max(minH, B - 8);
        newH = Math.max(minH, Math.min(maxH, startH - dy));
        newT = B - newH;
      }

      drawer.style.setProperty('width', `${newW}px`, 'important');
      drawer.style.setProperty('height', `${newH}px`, 'important');
      drawer.style.setProperty('left', `${newL}px`, 'important');
      drawer.style.setProperty('top', `${newT}px`, 'important');

      chatResizeWidth = newW;
      chatResizeHeight = newH;
    };

    const stopResize = () => {
      if (!isResizing) return;
      isResizing = false;
      document.body.classList.remove('maxitet-is-dragging-active');
      saveZenChatGeometry();
      window.dispatchEvent(new Event('resize'));
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    // Двойной клик по ручке ресайза возвращает дефолтный размер
    drawer.addEventListener('dblclick', (e) => {
      if (e.target.closest('.maxitet-chat-resize-handle')) {
        resetZenChatPosition();
      }
    });
  }

  // ─── Приближение (Zoom & Pan) презентации и демонстрации экрана в Дзене ───
  let zenZoom = 1;
  let zenPanX = 0;
  let zenPanY = 0;
  let zenZoomHudTimeout = null;

  function showZenZoomHud(val) {
    let hud = document.getElementById('maxitet-zen-zoom-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'maxitet-zen-zoom-hud';
      hud.className = 'maxitet-zen-zoom-hud';
      document.body.appendChild(hud);
    }
    hud.textContent = `${Math.round(val * 100)}%`;
    hud.classList.add('visible');
    clearTimeout(zenZoomHudTimeout);
    zenZoomHudTimeout = setTimeout(() => {
      hud.classList.remove('visible');
    }, 1200);
  }

  function applyZenZoomTransform(container, inner) {
    if (!inner) return;
    if (zenZoom <= 1.001) {
      inner.style.removeProperty('transform');
      inner.style.removeProperty('transform-origin');
      zenZoom = 1;
      zenPanX = 0;
      zenPanY = 0;
      if (container) {
        container.classList.remove('can-pan', 'is-panning');
      }
    } else {
      inner.style.setProperty('transform-origin', '0 0', 'important');
      inner.style.setProperty('transform', `translate(${Math.round(zenPanX)}px, ${Math.round(zenPanY)}px) scale(${zenZoom})`, 'important');
      if (container) {
        container.classList.add('can-pan');
      }
    }
  }

  function resetZenZoom() {
    const inner = document.querySelector('.sharing__inner');
    const container = document.querySelector('.meeting__screen-sharing-area');
    zenZoom = 1;
    zenPanX = 0;
    zenPanY = 0;
    applyZenZoomTransform(container, inner);
  }

  function triggerZenZoomStep(delta) {
    if (!isZenModeActive) return;
    const container = document.querySelector('.meeting__screen-sharing-area');
    const inner = document.querySelector('.sharing__inner');
    if (!container || !inner) return;

    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const mediaX = (cx - zenPanX) / zenZoom;
    const mediaY = (cy - zenPanY) / zenZoom;

    let newZoom = Math.round((zenZoom + delta) * 100) / 100;
    newZoom = Math.max(1, Math.min(10, newZoom));

    if (newZoom <= 1.01) {
      resetZenZoom();
      showZenZoomHud(1);
      return;
    }

    zenPanX = cx - mediaX * newZoom;
    zenPanY = cy - mediaY * newZoom;
    zenZoom = newZoom;

    applyZenZoomTransform(container, inner);
    showZenZoomHud(zenZoom);
  }

  function handleZenWheel(e) {
    if (!isZenModeActive) return;

    const interactiveSelector = '#maxitet-side-dock, .dashboard-drawer, .dashboard, .dashboard__content, ' +
      '.v3-emoji-picker, .izi-menu, .emoji__picker, [class*="emoji-picker"], [class*="emoji"], ' +
      '.reactions, .message-actions, .message-actions__tooltip, .izi-tooltip, ' +
      '[role="menu"], [role="dialog"], [role="listbox"], [role="tooltip"], ' +
      '.chat-scroller, .message-input, .textarea';

    if (e.target && typeof e.target.closest === 'function' && e.target.closest(interactiveSelector)) {
      return;
    }

    if (typeof e.composedPath === 'function') {
      const path = e.composedPath();
      for (const el of path) {
        if (el && el.nodeType === 1 && typeof el.matches === 'function' && el.matches(interactiveSelector)) {
          return;
        }
      }
    }

    const container = document.querySelector('.meeting__screen-sharing-area');
    const inner = document.querySelector('.sharing__inner');
    if (!container || !inner) return;

    const rect = container.getBoundingClientRect();
    const clientX = (e.clientX != null && e.clientX > 0) ? e.clientX : (rect.left + rect.width / 2);
    const clientY = (e.clientY != null && e.clientY > 0) ? e.clientY : (rect.top + rect.height / 2);

    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return;
    }

    const elUnderCursor = document.elementFromPoint(clientX, clientY);
    if (elUnderCursor && typeof elUnderCursor.closest === 'function' && elUnderCursor.closest(interactiveSelector)) {
      return;
    }

    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();

    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const mediaX = (relX - zenPanX) / zenZoom;
    const mediaY = (relY - zenPanY) / zenZoom;

    const step = e.shiftKey ? 0.25 : 0.08;
    const factor = e.deltaY < 0 ? (1 + step) : (1 - step);
    let newZoom = Math.max(1, Math.min(10, Math.round(zenZoom * factor * 100) / 100));

    if (newZoom <= 1.01) {
      resetZenZoom();
      showZenZoomHud(1);
    } else {
      zenPanX = relX - mediaX * newZoom;
      zenPanY = relY - mediaY * newZoom;

      const minPanX = rect.width * (1 - newZoom) - 100;
      const maxPanX = 100;
      const minPanY = rect.height * (1 - newZoom) - 100;
      const maxPanY = 100;
      zenPanX = Math.max(minPanX, Math.min(maxPanX, zenPanX));
      zenPanY = Math.max(minPanY, Math.min(maxPanY, zenPanY));

      zenZoom = newZoom;
      applyZenZoomTransform(container, inner);
      showZenZoomHud(zenZoom);
    }
  }

  function initZenZoomPan() {
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let panInitialX = 0, panInitialY = 0;

    window.addEventListener('wheel', handleZenWheel, { passive: false });

    window.addEventListener('pointerdown', (e) => {
      if (!isZenModeActive || zenZoom <= 1) return;
      if (e.button !== 0) return;
      if (e.target && typeof e.target.closest === 'function' && e.target.closest('#maxitet-side-dock, .dashboard-drawer, .dashboard, .dashboard__content')) {
        return;
      }
      const container = document.querySelector('.meeting__screen-sharing-area');
      const inner = document.querySelector('.sharing__inner');
      if (!container || !inner) return;

      const rect = container.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return;
      }

      if (e.detail === 2) {
        resetZenZoom();
        showZenZoomHud(1);
        return;
      }

      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panInitialX = zenPanX;
      panInitialY = zenPanY;
      container.classList.add('is-panning');

      try {
        container.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    window.addEventListener('pointermove', (e) => {
      if (!isPanning || zenZoom <= 1) return;
      const container = document.querySelector('.meeting__screen-sharing-area');
      const inner = document.querySelector('.sharing__inner');
      if (!container || !inner) return;

      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      const rect = container.getBoundingClientRect();

      let targetX = panInitialX + dx;
      let targetY = panInitialY + dy;

      const minPanX = rect.width * (1 - zenZoom) - 150;
      const maxPanX = 150;
      const minPanY = rect.height * (1 - zenZoom) - 150;
      const maxPanY = 150;

      zenPanX = Math.max(minPanX, Math.min(maxPanX, targetX));
      zenPanY = Math.max(minPanY, Math.min(maxPanY, targetY));

      applyZenZoomTransform(container, inner);
    });

    const stopPan = () => {
      if (!isPanning) return;
      isPanning = false;
      const container = document.querySelector('.meeting__screen-sharing-area');
      if (container) container.classList.remove('is-panning');
    };

    window.addEventListener('pointerup', stopPan);
    window.addEventListener('pointercancel', stopPan);
  }

  function toggleZenChat(forceOpen) {
    const drawer = document.querySelector('.dashboard-drawer');
    if (!drawer) return;

    if (isZenModeActive) {
      initZenChatDraggable(drawer);
    }

    const shouldOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : !drawer.classList.contains('maxitet-floating-chat-open');

    drawer.classList.toggle('maxitet-floating-chat-open', shouldOpen);
    if (shouldOpen && isZenModeActive) {
      initZenChatResizable(drawer);
      restoreZenChatGeometry(drawer);
      setTimeout(() => {
        const textarea = drawer.querySelector('.message-input .textarea');
        if (textarea) handleChatTextareaResize(textarea);
      }, 50);
    }
    syncZenDock();
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    if (shouldOpen) {
      // При открытии чата не фокусируем поле ввода автоматически:
      // авто-фокус захватывал ввод и блокировал повторные нажатия C.
      // Теперь пользователь может непрерывно спамить C для открытия/закрытия чата.
      // Поле ввода активируется только при явном клике по нему для набора сообщения.
    } else {
      const active = document.activeElement;
      if (active && active !== document.body && drawer.contains(active)) {
        if (typeof active.blur === 'function') active.blur();
      }
      if (typeof window.focus === 'function') {
        window.focus();
      }
    }
  }

  function injectSideZenDock() {
    document.getElementById('maxitet-dock-exit')?.remove();
    let dock = document.getElementById('maxitet-side-dock');
    if (!dock) {
      dock = document.createElement('aside');
      dock.id = 'maxitet-side-dock';
      dock.innerHTML = `
        <div id="maxitet-dock-drag-handle" class="maxitet-dock-drag-handle" title="Перетащить (Двойной клик — сброс)">
          ${SVG_DOCK_GRIP}
        </div>
        <button id="maxitet-dock-mic" class="maxitet-dock-btn" aria-label="Микрофон" title="Микрофон">
          <span id="maxitet-dock-mic-icon">${SVG_DOCK_MIC_OFF}</span>
        </button>
        <button id="maxitet-dock-cam" class="maxitet-dock-btn" aria-label="Камера" title="Камера">
          <span id="maxitet-dock-cam-icon">${SVG_DOCK_CAM_OFF}</span>
        </button>
        <div class="maxitet-dock-divider"></div>
        <button id="maxitet-dock-chat" class="maxitet-dock-btn" aria-label="Чат (C)" title="Чат (C)">
          ${SVG_DOCK_CHAT}
        </button>
      `;
      document.body.appendChild(dock);

      document.getElementById('maxitet-dock-mic')?.addEventListener('click', () => {
        const nativeMic = document.getElementById('meeting-buttons-micro');
        if (nativeMic) nativeMic.click();
      });

      document.getElementById('maxitet-dock-cam')?.addEventListener('click', () => {
        const nativeCam = document.getElementById('meeting-buttons-webcam') || document.getElementById('meeting-buttons-camera');
        if (nativeCam) nativeCam.click();
      });

      document.getElementById('maxitet-dock-chat')?.addEventListener('click', () => {
        toggleZenChat();
      });
    }

    initZenDockDraggable(dock);
  }

  function syncZenDock() {
    const dockMic = document.getElementById('maxitet-dock-mic');
    const dockMicIcon = document.getElementById('maxitet-dock-mic-icon');
    const dockCam = document.getElementById('maxitet-dock-cam');
    const dockCamIcon = document.getElementById('maxitet-dock-cam-icon');
    const dockChat = document.getElementById('maxitet-dock-chat');

    const nativeMic = document.getElementById('meeting-buttons-micro');
    const nativeCam = document.getElementById('meeting-buttons-webcam') || document.getElementById('meeting-buttons-camera');
    const drawer = document.querySelector('.dashboard-drawer');

    if (dockMic && dockMicIcon && nativeMic) {
      const unmuted = isMicUnmuted(nativeMic);
      dockMic.classList.toggle('is-active-mic', unmuted);
      dockMicIcon.innerHTML = unmuted ? SVG_DOCK_MIC_ON : SVG_DOCK_MIC_OFF;
    }

    if (dockCam && dockCamIcon && nativeCam) {
      const active = nativeCam.classList.contains('active');
      dockCam.classList.toggle('is-active-cam', active);
      dockCamIcon.innerHTML = active ? SVG_DOCK_CAM_ON : SVG_DOCK_CAM_OFF;
    }

    if (dockChat && drawer) {
      if (isZenModeActive) {
        initZenChatDraggable(drawer);
      } else if (drawer.classList.contains('is-dragged') || drawer.style.left || drawer.style.width) {
        // Гарантия чистоты обычного режима: удаляем любые оставшиеся инлайн-стили Дзена
        cleanupZenChatStyles(drawer);
      }
      const open = drawer.classList.contains('maxitet-floating-chat-open');
      dockChat.classList.toggle('is-active-chat', open);
      const wasOpen = document.body.classList.contains('maxitet-zen-chat-open');
      const nowOpen = open && isZenModeActive;
      document.body.classList.toggle('maxitet-zen-chat-open', nowOpen);
      if (wasOpen && !nowOpen) {
        // Позиция чата и докбара сохраняется, чтобы не прыгать при повторном открытии
      }
      updateSlideShift();
    }
  }

  let activeSlideShift = 0;

  function updateSlideShift() {
    const isChatOpen = document.body.classList.contains('maxitet-zen-chat-open');
    const viewer = document.querySelector('.viewer.sharing__viewer, .viewer-main-img');
    const img = document.querySelector('.viewer-main-img__img');

    if (!isZenModeActive || !isChatOpen || !viewer || !img) {
      if (viewer && activeSlideShift !== 0) {
        viewer.style.transform = '';
        activeSlideShift = 0;
      }
      return;
    }

    const imgRect = img.getBoundingClientRect();
    // Вычисляем естественный отступ слева без учёта текущего сдвига
    const naturalLeft = imgRect.left + activeSlideShift;

    // Сдвигаем на всю ширину чёрной полосы до самого левого края экрана
    const maxSafeShift = Math.max(0, Math.floor(naturalLeft));

    // Сдвигаем ровно до края (с запасом хода до 220px)
    const targetShift = Math.min(220, maxSafeShift);

    if (targetShift > 5) {
      activeSlideShift = targetShift;
      viewer.style.transform = `translateX(-${targetShift}px)`;
    } else if (activeSlideShift !== 0) {
      activeSlideShift = 0;
      viewer.style.transform = '';
    }
  }

  const SVG_MSG_REACT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;

  // ─── Управление селектором реакций на сообщения ──────────────
  let activeReactionBlock = null;
  let activeReactionTooltip = null;
  let reactionLeaveTimeout = null;

  function closeReactionMenu() {
    if (reactionLeaveTimeout) {
      clearTimeout(reactionLeaveTimeout);
      reactionLeaveTimeout = null;
    }
    const blk = activeReactionBlock;
    const tt = activeReactionTooltip;
    activeReactionBlock = null;
    activeReactionTooltip = null;

    if (tt) {
      tt.classList.remove('maxitet-actions-open');
    }
    document.querySelectorAll('.message-actions__tooltip.maxitet-actions-open').forEach((t) => {
      t.classList.remove('maxitet-actions-open');
    });

    if (blk) {
      blk.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    }
  }

  function scheduleReactionClose(delay = 1400) {
    if (reactionLeaveTimeout) clearTimeout(reactionLeaveTimeout);
    reactionLeaveTimeout = setTimeout(() => {
      closeReactionMenu();
    }, delay);
  }

  function cancelReactionClose() {
    if (reactionLeaveTimeout) {
      clearTimeout(reactionLeaveTimeout);
      reactionLeaveTimeout = null;
    }
  }

  // Не даём Vue мгновенно погасить селектор реакций, когда курсор переходит от кнопки сообщения к смайликам
  window.addEventListener(
    'mouseleave',
    (e) => {
      if (
        activeReactionBlock &&
        (e.target === activeReactionBlock ||
         e.target === activeReactionTooltip ||
         (activeReactionBlock && activeReactionBlock.contains(e.target)) ||
         (activeReactionTooltip && activeReactionTooltip.contains(e.target)))
      ) {
        e.stopImmediatePropagation();
        scheduleReactionClose(1400);
      }
    },
    true
  );

  window.addEventListener(
    'mouseenter',
    (e) => {
      if (
        activeReactionBlock &&
        (e.target === activeReactionBlock ||
         e.target === activeReactionTooltip ||
         (activeReactionBlock && activeReactionBlock.contains(e.target)) ||
         (activeReactionTooltip && activeReactionTooltip.contains(e.target)))
      ) {
        cancelReactionClose();
      }
    },
    true
  );

  function injectMessageActionButtons() {
    const textBlocks = document.querySelectorAll('.message-bubble__text-block');
    textBlocks.forEach((block) => {
      if (block.querySelector('.maxitet-msg-action-btn')) return;
      if (block.classList.contains('--reply-view')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'maxitet-msg-action-btn';
      btn.setAttribute('aria-label', 'Реакция или ответ');
      btn.innerHTML = SVG_MSG_REACT;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const targetId = block.id || (block.id = `chat-message-bubble-${Date.now()}`);
        const isCurrentOpen = activeReactionBlock === block;

        // Повторный клик по кнопке того же сообщения закрывает селектор
        if (isCurrentOpen) {
          closeReactionMenu();
          return;
        }

        // Закрываем любой ранее открытый селектор
        closeReactionMenu();

        // Фиксируем активный блок сразу, чтобы mouseleave блокировался с первой миллисекунды
        activeReactionBlock = block;
        cancelReactionClose();

        // Запускаем нативное позиционирование тултипа платформой непосредственно на блоке сообщения
        block.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));

        setTimeout(() => {
          let matchedTooltip = null;
          const allTooltips = document.querySelectorAll('.message-actions__tooltip');

          // 1. Точный поиск по привязке Vue 3 компонента IziTooltip
          for (const tt of allTooltips) {
            const propTarget = tt.__vueParentComponent?.props?.targetId ||
                               tt.__vnode?.ctx?.props?.targetId ||
                               tt.__vnode?.props?.['target-id'] ||
                               tt.__vnode?.props?.targetId;
            if (propTarget === targetId) {
              matchedTooltip = tt;
              break;
            }
          }

          // 2. Если внутренние props Vue скрыты — берём тултип, ставший .expanded после mouseenter
          if (!matchedTooltip) {
            for (const tt of allTooltips) {
              if (tt.classList.contains('expanded') && !tt.classList.contains('maxitet-actions-open')) {
                matchedTooltip = tt;
                break;
              }
            }
          }

          // 3. Fallback: поиск по геометрическому совпадению с целевым блоком
          if (!matchedTooltip) {
            const blockRect = block.getBoundingClientRect();
            let minDistance = 999999;
            allTooltips.forEach((tt) => {
              const ttRect = tt.getBoundingClientRect();
              const vDist = Math.abs(ttRect.top - blockRect.top);
              const hDist = Math.abs(ttRect.left - blockRect.left);
              const dist = vDist + hDist;
              if (dist < minDistance) {
                minDistance = dist;
                matchedTooltip = tt;
              }
            });
          }

          if (matchedTooltip) {
            matchedTooltip.dataset.targetId = targetId;
            matchedTooltip.classList.add('maxitet-actions-open', 'expanded');
            activeReactionTooltip = matchedTooltip;

            matchedTooltip.onmouseenter = cancelReactionClose;
            matchedTooltip.onmouseleave = () => scheduleReactionClose(1400);
          }
        }, 40);
      });

      block.appendChild(btn);
    });
  }

  // ─── Tooltip & Reaction Auto-Hide Fix ─────────────────────
  // Устраняет баг платформы М.Класс, когда тултипы кнопок и реакции на сообщения
  // не исчезают при уводе мыши и остаются висеть на экране.
  function initTooltipAutoHide() {
    // Закрытие открытых реакций при скролле чата
    window.addEventListener('scroll', closeReactionMenu, { capture: true, passive: true });

    // Быстрое закрытие по Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.code === 'Escape') {
        closeReactionMenu();
      }
    }, true);

    document.addEventListener('click', (e) => {
      // Клик вне меню реакций — закрываем открытую плашку реакций
      if (!e.target.closest('.maxitet-msg-action-btn') && !e.target.closest('.message-actions__tooltip')) {
        closeReactionMenu();
      } else if (e.target.closest('.message-actions__tooltip button')) {
        // Клик по реакции или ответу — закрываем через 150мс
        setTimeout(closeReactionMenu, 150);
      }
    }, true);
  }

  function initZenMode() {
    initTooltipAutoHide();
    injectZenStyles();
    document.getElementById('meeting-buttons-zen')?.remove();
    document.getElementById('maxitet-dock-exit')?.remove();
    injectSideZenDock();
    injectMessageActionButtons();
    initZenZoomPan();

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ zenMode: false, smartDarkMode: false, smartDarkPreset: 'maxitet' }, (res) => {
        if (res.smartDarkPreset) {
          currentSmartDarkPreset = res.smartDarkPreset;
        }
        if (res.zenMode) {
          setZenMode(true);
        } else {
          cleanupZenChatStyles();
        }
        if (res.smartDarkMode) {
          setSmartDarkMode(true, false);
        }
      });
    }

    setInterval(() => {
      document.getElementById('meeting-buttons-zen')?.remove();
      document.getElementById('maxitet-dock-exit')?.remove();
      injectSideZenDock();
      syncZenDock();
      injectMessageActionButtons();
      syncAllIframes();
    }, 700);

    // ─── Разблокировка контекстного меню (ПКМ) ───────────────────
    const unblockContextMenu = (e) => {
      e.stopImmediatePropagation();
    };
    window.addEventListener('contextmenu', unblockContextMenu, true);
    document.addEventListener('contextmenu', unblockContextMenu, true);

    // ─── Глобальные горячие клавиши (Capture phase) ──────────────
    let lastHotkeyTrigger = 0;

    handleKeyDown = function(e) {
      // 1. Бинды отключены при отсутствии на вкладке (вкладка скрыта или не в фокусе)
      if (document.hidden) return;
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;

      const target = e.target;
      const doc = target?.ownerDocument || document;
      const activeEl = doc.activeElement;

      const isInput = (el) => el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        (typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]'))
      );

      // Escape закрывает плавающий чат в Дзен-режиме, даже если фокус внутри поля ввода чата
      if (e.key === 'Escape' || e.code === 'Escape') {
        if (isZenModeActive) {
          const drawer = document.querySelector('.dashboard-drawer');
          if (drawer && drawer.classList.contains('maxitet-floating-chat-open')) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            toggleZenChat(false);
            return;
          }
        }
      }

      // 2. Бинды отключены при вводе сообщения в чате (активный ввод в input/textarea)
      if (isInput(target) || isInput(activeEl)) return;

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const code = e.code;
      const key = (e.key || '').toLowerCase();

      // Хоткеи зума демонстрации и презентации (+ / -, 0)
      if (isZenModeActive) {
        if (code === 'Equal' || key === '+' || key === '=' || code === 'NumpadAdd') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          if (typeof e.stopPropagation === 'function') e.stopPropagation();
          triggerZenZoomStep(0.15);
          return;
        }
        if (code === 'Minus' || key === '-' || key === '_' || code === 'NumpadSubtract') {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          if (typeof e.stopPropagation === 'function') e.stopPropagation();
          triggerZenZoomStep(-0.15);
          return;
        }
        if (code === 'Digit0' || key === '0' || code === 'Numpad0') {
          if (zenZoom > 1.01) {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            if (typeof e.stopPropagation === 'function') e.stopPropagation();
            resetZenZoom();
            showZenZoomHud(1);
            return;
          }
        }
      }

      const isChatKey = code === 'KeyC' || key === 'c' || key === 'с';
      const isZenKey = code === 'KeyZ' || key === 'z' || key === 'я';
      const isDarkKey = code === 'KeyD' || key === 'd' || key === 'в';
      const isShotKey = code === 'KeyS' || key === 's' || key === 'ы';

      // Защита от дублирования хоткея при кросс-фрейм вызовах (порог 80мс для клавиши C позволяет спамить)
      if (isChatKey || isZenKey || isDarkKey || isShotKey) {
        const now = Date.now();
        const threshold = isChatKey ? 80 : 120;
        if (now - lastHotkeyTrigger < threshold) return;
        lastHotkeyTrigger = now;
      }

      if (isZenKey) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        setZenMode(!isZenModeActive);
      } else if (isDarkKey) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (e.shiftKey) {
          cycleSmartDarkPreset();
        } else {
          setSmartDarkMode(!isSmartDarkModeActive);
        }
      } else if (isShotKey) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        triggerSlideScreenshot().then((res) => {
          if (res && res.success && !res.copied && res.dataUrl) {
            const a = document.createElement('a');
            a.href = res.dataUrl;
            a.download = `maxitet_slide_${Date.now()}.png`;
            a.click();
            showFloatingToast('Снимок сохранён в Загрузки (S)', SVG_TOAST_CAMERA);
          }
        });
      } else if (isChatKey) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (isZenModeActive) {
          toggleZenChat();
        } else {
          const toggler = document.querySelector('.dashboard-toggler, .dashboard-drawer__toggler, button.dashboard-toggler');
          if (toggler) toggler.click();
        }
      }
    };

    // ─── Привязка хоткеев и ПКМ ко всем iframe (доска #paint-frame и др.) ───
    function hookIframeEvents(frame) {
      if (!frame) return;
      try {
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        if (win && !win.__maxitet_hotkeys_hooked) {
          win.__maxitet_hotkeys_hooked = true;
          win.addEventListener('keydown', handleKeyDown, true);
          win.addEventListener('contextmenu', unblockContextMenu, true);
          win.addEventListener('wheel', (e) => {
            if (isZenModeActive) handleZenWheel(e);
          }, { passive: false });
        }
        if (doc && !doc.__maxitet_hotkeys_hooked) {
          doc.__maxitet_hotkeys_hooked = true;
          doc.addEventListener('keydown', handleKeyDown, true);
          doc.addEventListener('contextmenu', unblockContextMenu, true);
        }
      } catch (_) {}
    }

    function syncAllIframes() {
      try {
        document.querySelectorAll('iframe').forEach((frame) => {
          hookIframeEvents(frame);
          if (!frame.__maxitet_load_hooked) {
            frame.__maxitet_load_hooked = true;
            frame.addEventListener('load', () => hookIframeEvents(frame));
          }
        });
      } catch (_) {}
    }

    try {
      const iframeObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'IFRAME') {
                hookIframeEvents(node);
                node.addEventListener('load', () => hookIframeEvents(node));
              } else if (node.querySelectorAll) {
                node.querySelectorAll('iframe').forEach((f) => {
                  hookIframeEvents(f);
                  f.addEventListener('load', () => hookIframeEvents(f));
                });
              }
            }
          }
        }
      });
      iframeObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (_) {}

    // ─── Снятие залипшего фокуса при клике вне поля ввода (на блоке чата, слайде, фоне и т.д.) ───
    document.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (!target) return;
      const isInput = (el) => el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        (typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]'))
      );

      // Если клик вне поля ввода — снимаем фокус с input/textarea, чтобы клавиша C снова мгновенно открывала/закрывала чат
      if (!isInput(target)) {
        const active = document.activeElement;
        if (isInput(active)) {
          if (typeof active.blur === 'function') active.blur();
          if (typeof window.focus === 'function') window.focus();
        }
      }
    }, true);

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', updateSlideShift);
    syncAllIframes();
  }

  initZenMode();

})();
