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
  let handleKeyDown = null;

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

  function showFloatingToast(msg, iconSvg = SVG_TOAST_LOCK) {
    const existing = document.getElementById('maxitet-floating-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'maxitet-floating-toast';
    toast.innerHTML = `<span style="display:inline-flex;align-items:center;opacity:0.85;">${iconSvg}</span> <span>${msg}</span>`;
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
    if (!event.data) return;
    if (event.data.type === 'MAXITET_PRESENTATION_STORE_DATA') {
      cachedPresentationStore = event.data.data;
    }
    if (event.data.type === 'MAXITET_RECORD_STATUS') {
      if (event.data.status === 'recording') {
        showFloatingToast(`⏺ Запись вебки: ${event.data.secondsLeft} сек...`, SVG_TOAST_FREEZE);
      } else if (event.data.status === 'done') {
        showFloatingToast('✅ Вебкамера зациклена (3 сек пинг-понг)', SVG_TOAST_FREEZE);
      } else if (event.data.status === 'waiting_camera') {
        showFloatingToast('Включите камеру в вебинаре для записи 3 сек', SVG_TOAST_FREEZE);
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

    // Стили
    const style = doc.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
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
      }
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
            ✂️ Выделить область
          </button>
          <div class="separator"></div>
          <button id="btn-zoom-out" class="btn btn-icon" title="Отдалить (−)">−</button>
          <span id="zoom-label" class="zoom-indicator">100%</span>
          <button id="btn-zoom-in" class="btn btn-icon" title="Приблизить (+)">+</button>
          <button id="btn-reset" class="btn btn-icon" title="Сбросить масштаб и кроп">↩</button>
          <div class="separator"></div>
          <button id="btn-dark-mode" class="btn btn-icon" title="Тёмная тема слайдов (D)">🌙</button>
          <button id="btn-screenshot" class="btn btn-icon" title="Сделать скриншот в буфер обмена (S)">📷</button>
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

    function updateZoomUI() {
      zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
      canvas.classList.toggle('can-drag', view.zoom > 1 && !isCropMode);
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

      ctx.fillStyle = '#0d0d12';
      ctx.fillRect(0, 0, winW, winH);

      if (view.cropW === 0 || view.cropH === 0) {
        view.cropW = vw;
        view.cropH = vh;
      }

      const scale = Math.min(winW / view.cropW, winH / view.cropH);
      const dw = view.cropW * scale;
      const dh = view.cropH * scale;
      const dx = (winW - dw) / 2;
      const dy = (winH - dh) / 2;

      lastDraw = { dx, dy, dw, dh };

      if (sourceMedia.type === 'presentation') {
        const currentImg = getActivePresentationElement() || sourceMedia.element;
        if (isSmartDarkModeActive) {
          ctx.filter = 'invert(0.9) hue-rotate(180deg) contrast(1.1) brightness(0.95)';
        } else {
          ctx.filter = 'none';
        }
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
        ctx.filter = 'none';
      } else {
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

    render();

    win.addEventListener('resize', () => {
      render();
    });

    // ─── Зум в точку курсора ───────────────────────────────

    function zoomAtPoint(clientX, clientY, factor) {
      const dims = getCurrentMediaDims();
      const vw = dims.w;
      const vh = dims.h;

      const relX = clientX - lastDraw.dx;
      const relY = clientY - lastDraw.dy;

      const normX = Math.max(0, Math.min(1, relX / lastDraw.dw));
      const normY = Math.max(0, Math.min(1, relY / lastDraw.dy));

      const videoX = view.cropX + normX * view.cropW;
      const videoY = view.cropY + normY * view.cropH;

      const newZoom = Math.max(1, Math.min(10, view.zoom * factor));
      if (newZoom === 1) {
        resetView();
        updateZoomUI();
        return;
      }

      const newCropW = vw / newZoom;
      const newCropH = vh / newZoom;

      let newCropX = videoX - normX * newCropW;
      let newCropY = videoY - normY * newCropH;

      newCropX = Math.max(0, Math.min(vw - newCropW, newCropX));
      newCropY = Math.max(0, Math.min(vh - newCropH, newCropY));

      view.zoom = newZoom;
      view.cropW = newCropW;
      view.cropH = newCropH;
      view.cropX = newCropX;
      view.cropY = newCropY;

      updateZoomUI();
    }

    // ─── Колёсико мыши — зум в курсор ──────────────────────

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (isCropMode) return;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      zoomAtPoint(e.clientX, e.clientY, factor);
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

      if (view.zoom > 1 && e.button === 0) {
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

      const normLeft = Math.max(0, (boxLeft - lastDraw.dx) / lastDraw.dw);
      const normTop = Math.max(0, (boxTop - lastDraw.dy) / lastDraw.dh);
      const normW = Math.min(1 - normLeft, boxW / lastDraw.dw);
      const normH = Math.min(1 - normTop, boxH / lastDraw.dh);

      if (normW <= 0.02 || normH <= 0.02) return;

      const targetX = view.cropX + normLeft * view.cropW;
      const targetY = view.cropY + normTop * view.cropH;
      const targetW = normW * view.cropW;
      const targetH = normH * view.cropH;

      const zoomX = vw / targetW;
      const zoomY = vh / targetH;
      const newZoom = Math.min(10, Math.max(1, Math.min(zoomX, zoomY)));

      const finalCropW = vw / newZoom;
      const finalCropH = vh / newZoom;

      const centerTargetX = targetX + targetW / 2;
      const centerTargetY = targetY + targetH / 2;

      let finalCropX = centerTargetX - finalCropW / 2;
      let finalCropY = centerTargetY - finalCropH / 2;

      finalCropX = Math.max(0, Math.min(vw - finalCropW, finalCropX));
      finalCropY = Math.max(0, Math.min(vh - finalCropH, finalCropY));

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
      canvas.classList.toggle('can-drag', view.zoom > 1 && !enabled);
    }

    btnCrop.addEventListener('click', () => {
      setCropMode(!isCropMode);
    });

    btnZoomIn.addEventListener('click', () => {
      zoomAtPoint(win.innerWidth / 2, win.innerHeight / 2, 1.25);
    });

    btnZoomOut.addEventListener('click', () => {
      zoomAtPoint(win.innerWidth / 2, win.innerHeight / 2, 0.8);
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
      if (btnDark) {
        btnDark.textContent = isSmartDarkModeActive ? '☀️' : '🌙';
        btnDark.title = isSmartDarkModeActive ? 'Светлая тема слайдов (D)' : 'Тёмная тема слайдов (D)';
        btnDark.style.color = isSmartDarkModeActive ? '#fbbf24' : '';
      }
    }
    activeViewerUpdateDarkMode = updateViewerDarkMode;
    updateViewerDarkMode();

    const btnDarkMode = doc.getElementById('btn-dark-mode');
    if (btnDarkMode) {
      btnDarkMode.addEventListener('click', () => {
        setSmartDarkMode(!isSmartDarkModeActive);
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
        setSmartDarkMode(!isSmartDarkModeActive);
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

      case 'START_RECORD_FREEZE': {
        window.postMessage({ type: 'MAXITET_START_RECORD_FREEZE' }, '*');
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
        setSmartDarkMode(Boolean(message.enabled), false);
        sendResponse({ success: true, isSmartDarkMode: isSmartDarkModeActive });
        break;
      }

      case 'GET_SMART_DARK_MODE': {
        sendResponse({ isSmartDarkMode: isSmartDarkModeActive });
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

        sendResponse({
          hasPresentation: Boolean(presImg || cachedPresentationStore?.isPresentationEnabled || srcTemplate),
          currentSrc,
          srcTemplate,
          pagesCount,
          currentPage,
        });
        break;
      }
    }
  });

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

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'MAXITET_SNAPSHOT_CAPTURED' && event.data.dataUrl) {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ freezeCamSnapshot: event.data.dataUrl });
      }
    }
  });

  function syncFreezeCam() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ freezeCam: false, freezeCamGif: null, freezeCamSnapshot: null }, (res) => {
        if (res.freezeCamGif) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_GIF', dataUrl: res.freezeCamGif }, '*');
        } else if (res.freezeCamSnapshot) {
          window.postMessage({ type: 'MAXITET_RESTORE_SNAPSHOT', dataUrl: res.freezeCamSnapshot }, '*');
        }
        window.postMessage({ type: 'MAXITET_SET_FREEZE_CAM', enabled: res.freezeCam }, '*');
      });

      chrome.storage.onChanged.addListener((changes) => {
        if (changes.freezeCam) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_CAM', enabled: changes.freezeCam.newValue }, '*');
        }
        if (changes.freezeCamGif) {
          window.postMessage({ type: 'MAXITET_SET_FREEZE_GIF', dataUrl: changes.freezeCamGif.newValue }, '*');
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

  function setSmartDarkMode(enabled, showToastNotice = true) {
    isSmartDarkModeActive = Boolean(enabled);
    document.body.classList.toggle('maxitet-smart-dark', isSmartDarkModeActive);

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ smartDarkMode: isSmartDarkModeActive });
    }

    syncZenDock();
    if (typeof activeViewerUpdateDarkMode === 'function') {
      activeViewerUpdateDarkMode();
    }

    if (showToastNotice) {
      showFloatingToast(
        isSmartDarkModeActive ? 'Тёмная тема слайдов: ВКЛ (D)' : 'Тёмная тема слайдов: ВЫКЛ (D)',
        isSmartDarkModeActive ? SVG_TOAST_MOON : SVG_TOAST_SUN
      );
    }
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
      if (drawer) drawer.classList.remove('maxitet-floating-chat-open');
      document.body.classList.remove('maxitet-zen-chat-open');
      activeSlideShift = 0;
      const viewer = document.querySelector('.viewer.sharing__viewer, .viewer-main-img');
      if (viewer) viewer.style.transform = '';
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
        filter: invert(0.9) hue-rotate(180deg) contrast(1.1) brightness(0.95) !important;
        transition: filter 0.25s ease !important;
      }

      body.maxitet-smart-dark .sharing__viewer,
      body.maxitet-smart-dark .viewer__main-page,
      body.maxitet-smart-dark .viewer-main-img,
      body.maxitet-smart-dark .sharing__inner,
      body.maxitet-smart-dark .viewer {
        background-color: #0c0c10 !important;
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
      body.maxitet-zen-mode #paint-frame {
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

      /* Всплывающий чат Дзена: ВСЕГДА зафиксирован по вертикали и выезжает СТРОГО СПРАВА */
      body.maxitet-zen-mode .dashboard-drawer {
        position: fixed !important;
        right: 76px !important;
        top: 50% !important;
        height: 480px !important;
        max-height: 80vh !important;
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

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__wrap,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-scroller,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__posted {
        background: transparent !important;
        background-color: transparent !important;
      }

      /* Шапка чата */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__header,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .dashboard__header-top {
        background: rgba(255, 255, 255, 0.04) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      }

      /* Сообщения в плавающем чате — аккуратные полупрозрачные блоки */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_opponent {
        background-color: rgba(255, 255, 255, 0.08) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
        backdrop-filter: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_private {
        background-color: rgba(82, 196, 26, 0.14) !important;
        border: 1px solid rgba(82, 196, 26, 0.22) !important;
        backdrop-filter: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__text-block_self {
        background-color: rgba(24, 144, 255, 0.16) !important;
        border: 1px solid rgba(24, 144, 255, 0.25) !important;
        backdrop-filter: none !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__corn svg,
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-bubble__corn path {
        opacity: 0.15 !important;
      }

      /* Поле ввода сообщения и переключатель */
      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .message-input {
        background-color: rgba(255, 255, 255, 0.06) !important;
        border-color: rgba(255, 255, 255, 0.12) !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat-actions {
        background: transparent !important;
      }

      body.maxitet-zen-mode .dashboard-drawer.maxitet-floating-chat-open .chat__tabs {
        background: rgba(30, 32, 34, 0.65) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
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

      /* Боковой док Дзена */
      #maxitet-side-dock {
        position: fixed !important;
        right: 18px !important;
        top: 50% !important;
        transform: translateY(-50%) translateX(90px) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        background: rgba(16, 20, 28, 0.72) !important;
        backdrop-filter: blur(14px) !important;
        -webkit-backdrop-filter: blur(14px) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 20px !important;
        padding: 10px 8px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 10px !important;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55) !important;
        z-index: 2147483645 !important;
        transition: all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
      }

      body.maxitet-zen-mode #maxitet-side-dock {
        transform: translateY(-50%) translateX(0) !important;
        opacity: 1 !important;
        pointer-events: all !important;
      }

      .maxitet-dock-btn {
        width: 42px !important;
        height: 42px !important;
        border-radius: 13px !important;
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        color: #bfbfbf !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1),
                    background-color 0.2s ease,
                    box-shadow 0.2s ease,
                    color 0.2s ease !important;
      }

      .maxitet-dock-btn svg {
        stroke: currentColor !important;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
      }

      .maxitet-dock-btn:hover {
        background: rgba(255, 255, 255, 0.16) !important;
        color: #fff !important;
        transform: scale(1.1) !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35) !important;
      }

      .maxitet-dock-btn:hover svg {
        transform: scale(1.08) !important;
      }

      .maxitet-dock-btn:active {
        transform: scale(0.92) !important;
      }

      .maxitet-dock-divider {
        width: 22px !important;
        height: 1px !important;
        background: rgba(255, 255, 255, 0.1) !important;
        margin: 2px 0 !important;
      }

      /* Статусы заливкой */
      .maxitet-dock-btn.is-active-mic {
        background: #27ae60 !important;
        border-color: #2ecc71 !important;
        color: #ffffff !important;
        box-shadow: 0 4px 14px rgba(39, 174, 96, 0.45) !important;
      }

      .maxitet-dock-btn.is-active-cam {
        background: #2980b9 !important;
        border-color: #3498db !important;
        color: #ffffff !important;
        box-shadow: 0 4px 14px rgba(41, 128, 185, 0.45) !important;
      }

      .maxitet-dock-btn.is-active-chat {
        background: rgba(255, 255, 255, 0.22) !important;
        border-color: rgba(255, 255, 255, 0.35) !important;
        color: #ffffff !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function injectSideZenDock() {
    document.getElementById('maxitet-dock-exit')?.remove();
    if (document.getElementById('maxitet-side-dock')) return;

    const dock = document.createElement('aside');
    dock.id = 'maxitet-side-dock';
    dock.innerHTML = `
      <button id="maxitet-dock-mic" class="maxitet-dock-btn" title="Микрофон">
        <span id="maxitet-dock-mic-icon">${SVG_DOCK_MIC_OFF}</span>
      </button>
      <button id="maxitet-dock-cam" class="maxitet-dock-btn" title="Камера">
        <span id="maxitet-dock-cam-icon">${SVG_DOCK_CAM_OFF}</span>
      </button>
      <div class="maxitet-dock-divider"></div>
      <button id="maxitet-dock-chat" class="maxitet-dock-btn" title="Чат">
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
      const drawer = document.querySelector('.dashboard-drawer');
      if (drawer) {
        drawer.classList.toggle('maxitet-floating-chat-open');
        syncZenDock();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
      }
    });
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
      const open = drawer.classList.contains('maxitet-floating-chat-open');
      dockChat.classList.toggle('is-active-chat', open);
      document.body.classList.toggle('maxitet-zen-chat-open', open && isZenModeActive);
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

  function injectMessageActionButtons() {
    const textBlocks = document.querySelectorAll('.message-bubble__text-block');
    textBlocks.forEach((block) => {
      if (block.querySelector('.maxitet-msg-action-btn')) return;
      if (block.classList.contains('--reply-view')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'maxitet-msg-action-btn';
      btn.title = 'Реакция или ответ';
      btn.innerHTML = SVG_MSG_REACT;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();

        const bubble = btn.closest('.message-bubble') || block;
        const alreadyOpen = document.querySelector('.message-actions__tooltip.maxitet-actions-open');
        const isCurrentOpen = alreadyOpen && alreadyOpen.dataset.forBubble === (bubble.id || 'current');

        // Сначала скрываем любые открытые меню реакций
        document.querySelectorAll('.message-actions__tooltip.maxitet-actions-open').forEach((tt) => {
          tt.classList.remove('maxitet-actions-open');
        });

        if (isCurrentOpen) {
          return; // Повторный клик по кнопке закрывает меню
        }

        // Провоцируем нативное позиционирование тултипа платформой
        bubble.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        bubble.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

        setTimeout(() => {
          const bubbleRect = bubble.getBoundingClientRect();
          let bestTooltip = null;
          let minDistance = 999999;

          document.querySelectorAll('.message-actions__tooltip').forEach((tt) => {
            const ttRect = tt.getBoundingClientRect();
            const dist = Math.abs(ttRect.top - bubbleRect.top);
            if (dist < minDistance) {
              minDistance = dist;
              bestTooltip = tt;
            }
          });

          if (bestTooltip && minDistance < 180) {
            bestTooltip.dataset.forBubble = bubble.id || 'current';
            bestTooltip.classList.add('maxitet-actions-open', 'expanded');
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
    let ticking = false;

    function handlePointer(e) {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        ticking = false;
        const target = e.target;
        if (!target) return;

        // Подсказки нижних кнопок управления ("Реакции", "Настройки", "Микрофон", etc.)
        const isOverBottomButtons = !!target.closest(
          '.control-buttons, .meeting__buttons, #meeting-btns, .meeting-button'
        );
        if (!isOverBottomButtons) {
          // Если курсор не над кнопками управления — гасим любые зависшие подсказки кнопок
          document.querySelectorAll('.izi-tooltip.expanded').forEach((tt) => {
            if (!tt.classList.contains('message-actions__tooltip') && !tt.closest('.dashboard-drawer')) {
              tt.classList.remove('expanded');
            }
          });
        }
      });
    }

    window.addEventListener('pointermove', handlePointer, { passive: true });

    // Закрытие открытых реакций при скролле чата
    window.addEventListener('scroll', () => {
      document.querySelectorAll('.message-actions__tooltip.maxitet-actions-open').forEach((tt) => {
        tt.classList.remove('maxitet-actions-open');
      });
    }, { capture: true, passive: true });

    document.addEventListener('click', (e) => {
      // 1. Клик по кнопкам управления снизу
      if (e.target && e.target.closest && e.target.closest('.control-buttons, .meeting__buttons, #meeting-btns')) {
        setTimeout(() => {
          document.querySelectorAll('.izi-tooltip.expanded').forEach((tt) => {
            if (!tt.classList.contains('message-actions__tooltip') && !tt.closest('.dashboard-drawer')) {
              tt.classList.remove('expanded');
            }
          });
        }, 80);
      }

      // 2. Клик вне меню реакций — закрываем открытую плашку реакций
      if (!e.target.closest('.maxitet-msg-action-btn') && !e.target.closest('.message-actions__tooltip')) {
        document.querySelectorAll('.message-actions__tooltip.maxitet-actions-open').forEach((tt) => {
          tt.classList.remove('maxitet-actions-open');
        });
      } else if (e.target.closest('.message-actions__tooltip button')) {
        // Клик по реакции или ответу — закрываем через 120мс
        setTimeout(() => {
          document.querySelectorAll('.message-actions__tooltip.maxitet-actions-open').forEach((tt) => {
            tt.classList.remove('maxitet-actions-open');
          });
        }, 120);
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

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ zenMode: false, smartDarkMode: false }, (res) => {
        if (res.zenMode) {
          setZenMode(true);
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
      const target = e.target;
      const doc = target?.ownerDocument || document;
      const activeEl = doc.activeElement;

      const isInput = (el) => el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable ||
        (typeof el.closest === 'function' && el.closest('input, textarea, [contenteditable="true"]'))
      );

      // Если ввод происходит непосредственно в поле ввода (пользователь пишет в чате)
      if (isInput(target)) return;

      // Если фокус залип в поле ввода, но клик/нажатие произошло вне него (на слайде, видео, холсте):
      if (isInput(activeEl)) {
        if (activeEl && typeof activeEl.blur === 'function') {
          activeEl.blur();
        }
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const code = e.code;
      const key = (e.key || '').toLowerCase();

      // Защита от дублирования хоткея при кросс-фрейм вызовах в пределах 150мс
      if (
        code === 'KeyZ' || key === 'z' || key === 'я' ||
        code === 'KeyD' || key === 'd' || key === 'в' ||
        code === 'KeyS' || key === 's' || key === 'ы'
      ) {
        const now = Date.now();
        if (now - lastHotkeyTrigger < 150) return;
        lastHotkeyTrigger = now;
      }

      if (code === 'KeyZ' || key === 'z' || key === 'я') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        setZenMode(!isZenModeActive);
      } else if (code === 'KeyD' || key === 'd' || key === 'в') {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        setSmartDarkMode(!isSmartDarkModeActive);
      } else if (code === 'KeyS' || key === 's' || key === 'ы') {
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

    // ─── Снятие залипшего фокуса при клике по области презентации / демонстрации ───
    document.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (!target) return;
      if (typeof target.closest === 'function' && target.closest(
        '.meeting__screen-sharing-area, .sharing__inner, .viewer, .viewer-main-img, #paint-container, #paint-frame, .paint, .paint__inner, .sharing__screen-share, .sharing__screen-share-container, .sharing__screen-share-video'
      )) {
        const active = document.activeElement;
        if (active && (
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable ||
          (typeof active.closest === 'function' && active.closest('input, textarea, [contenteditable="true"]'))
        )) {
          active.blur();
        }
        if (typeof window.focus === 'function') {
          window.focus();
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
