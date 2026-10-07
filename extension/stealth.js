(() => {
  'use strict';

  // Состояние невидимки (по умолчанию выключено)
  let isStealthActive = false;

  // Оригинальные дескрипторы для возможности отключения
  const origVisibilityState =
    Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') ||
    Object.getOwnPropertyDescriptor(document, 'visibilityState');

  const origHidden =
    Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') ||
    Object.getOwnPropertyDescriptor(document, 'hidden');

  const origHasFocus = Document.prototype.hasFocus;

  // ─── 1. Подмена Page Visibility API ──────────────────────────

  try {
    Object.defineProperty(document, 'visibilityState', {
      get() {
        return isStealthActive
          ? 'visible'
          : (origVisibilityState ? origVisibilityState.get.call(this) : 'visible');
      },
      set() {},
      configurable: true,
    });

    Object.defineProperty(document, 'hidden', {
      get() {
        return isStealthActive
          ? false
          : (origHidden ? origHidden.get.call(this) : false);
      },
      set() {},
      configurable: true,
    });

    // Для старых WebKit-реализаций
    Object.defineProperty(document, 'webkitVisibilityState', {
      get() {
        return isStealthActive ? 'visible' : 'visible';
      },
      set() {},
      configurable: true,
    });

    Object.defineProperty(document, 'webkitHidden', {
      get() {
        return isStealthActive ? false : false;
      },
      set() {},
      configurable: true,
    });
  } catch (e) {
    console.warn('[Lecture PiP Stealth] Не удалось пропатчить Visibility API:', e);
  }

  // ─── 2. Подмена hasFocus() ───────────────────────────────────

  try {
    Document.prototype.hasFocus = function () {
      return isStealthActive ? true : origHasFocus.call(this);
    };
    document.hasFocus = function () {
      return isStealthActive ? true : origHasFocus.call(this);
    };
  } catch (e) {
    console.warn('[Lecture PiP Stealth] Не удалось пропатчить hasFocus:', e);
  }

  // ─── 3. Глушение событий потери фокуса и видимости ──────────

  const eventsToSilence = [
    'visibilitychange',
    'webkitvisibilitychange',
    'blur',
    'focusout',
    'mouseleave',
  ];

  eventsToSilence.forEach((eventName) => {
    window.addEventListener(
      eventName,
      (e) => {
        if (isStealthActive) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true // capturing phase — перехватываем ДО скриптов сайта
    );

    document.addEventListener(
      eventName,
      (e) => {
        if (isStealthActive) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true
    );
  });

  // ─── Разблокировка контекстного меню (ПКМ) ───────────────────
  window.addEventListener('contextmenu', (e) => {
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('contextmenu', (e) => {
    e.stopImmediatePropagation();
  }, true);

  // Защита от прямого навешивания window.onblur = ...
  try {
    let internalOnBlur = null;
    Object.defineProperty(window, 'onblur', {
      get() {
        return internalOnBlur;
      },
      set(fn) {
        internalOnBlur = function (e) {
          if (!isStealthActive && typeof fn === 'function') {
            return fn.call(this, e);
          }
        };
      },
      configurable: true,
    });

    let internalOnVisChange = null;
    Object.defineProperty(document, 'onvisibilitychange', {
      get() {
        return internalOnVisChange;
      },
      set(fn) {
        internalOnVisChange = function (e) {
          if (!isStealthActive && typeof fn === 'function') {
            return fn.call(this, e);
          }
        };
      },
      configurable: true,
    });
  } catch (e) {}

  // ─── 4. Анти-AFK (периодический микро-пульс активности) ───────

  setInterval(() => {
    if (!isStealthActive) return;
    try {
      const evt = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: Math.floor(Math.random() * 300) + 100,
        clientY: Math.floor(Math.random() * 300) + 100,
      });
      document.dispatchEvent(evt);
    } catch (e) {}
  }, 45000); // раз в 45 секунд

  // ─── 5. Связь с расширением через postMessage ────────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'LECTURE_PIP_SET_STEALTH') {
      isStealthActive = Boolean(event.data.enabled);
    }
    if (event.data.type === 'MAXITET_SET_FREEZE_CAM') {
      setFreezeCam(Boolean(event.data.enabled));
    }
    if (event.data.type === 'MAXITET_SET_FREEZE_MODE') {
      freezeCamMode = event.data.mode || 'loop';
      if (isFreezeCamActive) {
        if (freezeCamMode === 'photo' && !savedPhotoBitmap) {
          takePhotoSnapshot();
        } else if (freezeCamMode === 'loop') {
          loopStartTime = performance.now();
          if (!recordedPingPongFrames.length && !customGifFrames.length && !customVideoEl && !hasPersistedLoop) {
            start3SecRecording();
          }
        }
      }
    }
    if (event.data.type === 'MAXITET_START_RECORD_FREEZE') {
      freezeCamMode = 'loop';
      start3SecRecording();
    }
    if (event.data.type === 'MAXITET_TAKE_FREEZE_PHOTO') {
      freezeCamMode = 'photo';
      takePhotoSnapshot();
    }
    if (event.data.type === 'MAXITET_SET_FREEZE_PHOTO') {
      freezeCamMode = 'photo';
      loadSavedPhoto(event.data.dataUrl);
    }
    if (event.data.type === 'MAXITET_SET_FREEZE_GIF') {
      freezeCamMode = 'loop';
      loadCustomGif(event.data.dataUrl);
    }
    if (event.data.type === 'MAXITET_INIT_FREEZE_STATE') {
      freezeCamMode = event.data.mode || 'loop';
      isFreezeCamActive = Boolean(event.data.enabled);
      if (event.data.customGifDataUrl) {
        loadCustomGif(event.data.customGifDataUrl);
      }
      if (event.data.photoDataUrl) {
        loadSavedPhoto(event.data.photoDataUrl);
      }
      if (event.data.loopFrames && Array.isArray(event.data.loopFrames)) {
        restoreLoopFrames(event.data.loopFrames);
      }
    }
  });

  // ─── 6. Заморозка вебки (Freeze Cam: 3-сек пинг-понг / фото) ───

  let isFreezeCamActive = false;
  let freezeCamMode = 'loop'; // 'loop' | 'photo'
  let isRecording3Sec = false;
  let recordStartTime = 0;
  let pendingRecordOnCameraStart = false;
  let pendingPhotoOnCameraStart = false;
  let hasPersistedLoop = false;
  let savedPhotoBitmap = null;
  let recordedPingPongFrames = []; // [ImageBitmap, ...]
  let customGifFrames = []; // [{ bitmap, durationMs }]
  let customGifTotalMs = 0;
  let customVideoEl = null;

  let liveWebcamVideo = null;
  let virtualCanvas = null;
  let virtualCtx = null;
  let virtualStream = null;
  let isLoopRunning = false;

  let loopStartTime = 0;
  let lastCapturedFrameTime = 0;
  const FRAME_INTERVAL_MS = 75; // ~13.3 fps (около 40 кадров за 3 секунды, плавно и легко сохраняется)

  function frameToDataUrl(bitmap, maxW = 480) {
    const w = bitmap.width || 640;
    const h = bitmap.height || 480;
    const scale = Math.min(1, maxW / w);
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, tw, th);
    return canvas.toDataURL('image/jpeg', 0.68);
  }

  function serializeAndSaveLoopFrames(bitmaps) {
    if (!Array.isArray(bitmaps) || bitmaps.length === 0) return;
    try {
      const first = bitmaps[0];
      const w = first.width || 640;
      const h = first.height || 480;
      const scale = Math.min(1, 480 / w);
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');

      const dataUrls = [];
      for (const bmp of bitmaps) {
        ctx.drawImage(bmp, 0, 0, tw, th);
        dataUrls.push(canvas.toDataURL('image/jpeg', 0.65));
      }

      window.postMessage({
        type: 'MAXITET_SAVE_LOOP_FRAMES',
        frames: dataUrls,
      }, '*');
    } catch (e) {
      console.warn('[Maxitet Master] Ошибка сериализации кадров цикла:', e);
    }
  }

  async function restoreLoopFrames(dataUrls) {
    if (!Array.isArray(dataUrls) || dataUrls.length === 0) return;
    try {
      const bitmaps = [];
      for (const url of dataUrls) {
        const res = await fetch(url);
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        bitmaps.push(bmp);
      }
      if (bitmaps.length > 0) {
        recordedPingPongFrames.forEach(b => b && b.close && b.close());
        recordedPingPongFrames = bitmaps;
        hasPersistedLoop = true;
      }
    } catch (err) {
      console.warn('[Maxitet Master] Ошибка восстановления кадров цикла:', err);
    }
  }

  async function loadSavedPhoto(dataUrl) {
    if (savedPhotoBitmap && savedPhotoBitmap.close) {
      savedPhotoBitmap.close();
      savedPhotoBitmap = null;
    }
    if (!dataUrl) return;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      savedPhotoBitmap = await createImageBitmap(blob);
    } catch (e) {
      console.warn('[Maxitet Master] Ошибка декодирования фото:', e);
    }
  }

  function takePhotoSnapshot() {
    if (!liveWebcamVideo || liveWebcamVideo.readyState < 2) {
      pendingPhotoOnCameraStart = true;
      window.postMessage({
        type: 'MAXITET_PHOTO_STATUS',
        status: 'waiting_camera',
      }, '*');
      return;
    }

    pendingPhotoOnCameraStart = false;
    createImageBitmap(liveWebcamVideo).then((bmp) => {
      if (savedPhotoBitmap && savedPhotoBitmap.close) {
        savedPhotoBitmap.close();
      }
      savedPhotoBitmap = bmp;
      freezeCamMode = 'photo';
      isFreezeCamActive = true;

      const dataUrl = frameToDataUrl(bmp, 640);
      window.postMessage({
        type: 'MAXITET_SAVE_PHOTO',
        dataUrl,
      }, '*');

      window.postMessage({
        type: 'MAXITET_PHOTO_STATUS',
        status: 'done',
      }, '*');
    }).catch((err) => {
      console.warn('[Maxitet Master] Ошибка снимка с вебки:', err);
    });
  }

  async function loadCustomGif(dataUrl) {
    customGifFrames.forEach(f => f.bitmap && f.bitmap.close && f.bitmap.close());
    customGifFrames = [];
    customGifTotalMs = 0;
    if (customVideoEl) {
      customVideoEl.pause();
      customVideoEl.src = '';
      customVideoEl = null;
    }

    if (!dataUrl) return;

    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();

      if (blob.type.startsWith('video/')) {
        const v = document.createElement('video');
        v.autoplay = true;
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        v.src = dataUrl;
        await v.play().catch(() => {});
        customVideoEl = v;
        return;
      }

      if (typeof window.ImageDecoder !== 'undefined') {
        const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' });
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack.frameCount;
        const frames = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          const dur = Math.max(20, Math.round((image.duration || 100000) / 1000));
          const bmp = await createImageBitmap(image);
          image.close();
          frames.push({ bitmap: bmp, durationMs: dur });
          total += dur;
        }
        customGifFrames = frames;
        customGifTotalMs = total;
      }
    } catch (err) {
      console.warn('[Maxitet Master] Ошибка декодирования GIF:', err);
    }
  }

  function start3SecRecording() {
    freezeCamMode = 'loop';
    if (!liveWebcamVideo || liveWebcamVideo.readyState < 2) {
      pendingRecordOnCameraStart = true;
      window.postMessage({
        type: 'MAXITET_RECORD_STATUS',
        status: 'waiting_camera',
      }, '*');
      return;
    }

    pendingRecordOnCameraStart = false;
    isRecording3Sec = true;
    isFreezeCamActive = false;
    recordStartTime = performance.now();
    lastCapturedFrameTime = 0;

    recordedPingPongFrames.forEach(bmp => bmp && bmp.close && bmp.close());
    recordedPingPongFrames = [];

    customGifFrames.forEach(f => f.bitmap && f.bitmap.close && f.bitmap.close());
    customGifFrames = [];
    customGifTotalMs = 0;
    if (customVideoEl) {
      customVideoEl.pause();
      customVideoEl.src = '';
      customVideoEl = null;
    }

    if (liveWebcamVideo && liveWebcamVideo.readyState >= 2) {
      createImageBitmap(liveWebcamVideo).then(bmp => {
        if (isRecording3Sec || isFreezeCamActive) {
          recordedPingPongFrames.push(bmp);
        } else {
          bmp.close();
        }
      }).catch(() => {});
    }

    window.postMessage({
      type: 'MAXITET_RECORD_STATUS',
      status: 'recording',
      secondsLeft: 3,
    }, '*');

    let secLeft = 3;
    const countdownInterval = setInterval(() => {
      if (!isRecording3Sec) {
        clearInterval(countdownInterval);
        return;
      }
      secLeft--;
      if (secLeft > 0) {
        window.postMessage({
          type: 'MAXITET_RECORD_STATUS',
          status: 'recording',
          secondsLeft: secLeft,
        }, '*');
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);
  }

  function setFreezeCam(enabled) {
    if (enabled) {
      isFreezeCamActive = true;
      isRecording3Sec = false;
      loopStartTime = performance.now();

      if (freezeCamMode === 'photo') {
        if (!savedPhotoBitmap) {
          takePhotoSnapshot();
        }
      } else {
        if (customGifFrames.length > 0 || customVideoEl || recordedPingPongFrames.length > 0 || hasPersistedLoop) {
          loopStartTime = performance.now();
        } else {
          start3SecRecording();
        }
      }
    } else {
      isFreezeCamActive = false;
      isRecording3Sec = false;
      pendingRecordOnCameraStart = false;
      pendingPhotoOnCameraStart = false;
    }
  }

  function setupFreezeCamLoop() {
    if (isLoopRunning) return;
    isLoopRunning = true;

    function loop(now) {
      if (virtualCanvas && virtualCtx) {
        if (liveWebcamVideo && liveWebcamVideo.readyState >= 2) {
          const vw = liveWebcamVideo.videoWidth || 640;
          const vh = liveWebcamVideo.videoHeight || 480;
          if (virtualCanvas.width !== vw || virtualCanvas.height !== vh) {
            virtualCanvas.width = vw;
            virtualCanvas.height = vh;
          }
        }

        if (isRecording3Sec) {
          // ─── 1. Фаза записи 3 сек: транслируем живое видео и собираем кадры ───
          if (liveWebcamVideo && liveWebcamVideo.readyState >= 2) {
            virtualCtx.drawImage(liveWebcamVideo, 0, 0, virtualCanvas.width, virtualCanvas.height);

            if (now - lastCapturedFrameTime >= FRAME_INTERVAL_MS) {
              lastCapturedFrameTime = now;
              createImageBitmap(liveWebcamVideo).then((bmp) => {
                if (isRecording3Sec || (isFreezeCamActive && recordedPingPongFrames.length < 50)) {
                  recordedPingPongFrames.push(bmp);
                } else {
                  bmp.close();
                }
              }).catch(() => {});
            }

            if (now - recordStartTime >= 3000) {
              isRecording3Sec = false;
              isFreezeCamActive = true;
              loopStartTime = now;
              hasPersistedLoop = true;

              window.postMessage({
                type: 'MAXITET_RECORD_STATUS',
                status: 'done',
                framesCount: recordedPingPongFrames.length,
              }, '*');

              serializeAndSaveLoopFrames(recordedPingPongFrames);
            }
          }
        } else if (!isFreezeCamActive) {
          // ─── 2. Обычный живой видеопоток ───
          if (liveWebcamVideo && liveWebcamVideo.readyState >= 2) {
            virtualCtx.drawImage(liveWebcamVideo, 0, 0, virtualCanvas.width, virtualCanvas.height);
          }
        } else {
          // ─── 3. Режим заморозки ───
          if (freezeCamMode === 'photo') {
            if (savedPhotoBitmap) {
              virtualCtx.drawImage(savedPhotoBitmap, 0, 0, virtualCanvas.width, virtualCanvas.height);
            } else if (liveWebcamVideo && liveWebcamVideo.readyState >= 2) {
              virtualCtx.drawImage(liveWebcamVideo, 0, 0, virtualCanvas.width, virtualCanvas.height);
            }
          } else {
            // Режим Анимации (GIF / пинг-понг 3 сек)
            if (!loopStartTime) loopStartTime = now;

            if (customVideoEl && customVideoEl.readyState >= 2) {
              virtualCtx.drawImage(customVideoEl, 0, 0, virtualCanvas.width, virtualCanvas.height);
            } else if (customGifFrames.length > 0) {
              const elapsed = (now - loopStartTime) % (customGifTotalMs || 1000);
              let acc = 0;
              let activeBmp = customGifFrames[0].bitmap;
              for (let i = 0; i < customGifFrames.length; i++) {
                acc += customGifFrames[i].durationMs;
                if (elapsed <= acc) {
                  activeBmp = customGifFrames[i].bitmap;
                  break;
                }
              }
              if (activeBmp) {
                virtualCtx.drawImage(activeBmp, 0, 0, virtualCanvas.width, virtualCanvas.height);
              }
            } else if (recordedPingPongFrames.length > 0) {
              const count = recordedPingPongFrames.length;
              if (count === 1) {
                virtualCtx.drawImage(recordedPingPongFrames[0], 0, 0, virtualCanvas.width, virtualCanvas.height);
              } else {
                const period = (count - 1) * 2;
                const step = Math.floor((now - loopStartTime) / FRAME_INTERVAL_MS) % period;
                const frameIdx = step < count ? step : (period - step);
                const bmp = recordedPingPongFrames[frameIdx] || recordedPingPongFrames[0];
                if (bmp) {
                  virtualCtx.drawImage(bmp, 0, 0, virtualCanvas.width, virtualCanvas.height);
                }
              }
            } else if (liveWebcamVideo && liveWebcamVideo.readyState >= 2) {
              virtualCtx.drawImage(liveWebcamVideo, 0, 0, virtualCanvas.width, virtualCanvas.height);
            }
          }
        }
      }

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const stream = await origGetUserMedia(constraints);

      // Если в запросе была вебкамера и есть видеотрек:
      if (constraints && constraints.video && stream.getVideoTracks().length > 0) {
        try {
          const originalVideoTrack = stream.getVideoTracks()[0];

          // Скрытый видеоэлемент для чтения кадров вебки
          if (!liveWebcamVideo) {
            liveWebcamVideo = document.createElement('video');
            liveWebcamVideo.autoplay = true;
            liveWebcamVideo.muted = true;
            liveWebcamVideo.playsInline = true;
            liveWebcamVideo.style.display = 'none';
            document.documentElement.appendChild(liveWebcamVideo);
          }
          liveWebcamVideo.srcObject = new MediaStream([originalVideoTrack]);
          liveWebcamVideo.play().catch(() => {});

          // Виртуальный холст
          if (!virtualCanvas) {
            virtualCanvas = document.createElement('canvas');
            virtualCanvas.width = 640;
            virtualCanvas.height = 480;
            virtualCtx = virtualCanvas.getContext('2d');
          }

          // Создаём виртуальный видеопоток из холста
          virtualStream = virtualCanvas.captureStream(25);
          const virtualVideoTrack = virtualStream.getVideoTracks()[0];

          setupFreezeCamLoop();

          // Если заморозка или отложенное действие активно на момент старта камеры:
          if (isFreezeCamActive || pendingRecordOnCameraStart || pendingPhotoOnCameraStart) {
            const triggerFreeze = () => {
              if (pendingRecordOnCameraStart) {
                start3SecRecording();
              } else if (pendingPhotoOnCameraStart) {
                takePhotoSnapshot();
              } else if (isFreezeCamActive) {
                if (freezeCamMode === 'photo') {
                  if (!savedPhotoBitmap) {
                    takePhotoSnapshot();
                  }
                } else {
                  if (recordedPingPongFrames.length > 0 || customGifFrames.length > 0 || customVideoEl || hasPersistedLoop) {
                    loopStartTime = performance.now();
                  } else {
                    start3SecRecording();
                  }
                }
              }
            };
            if (liveWebcamVideo.readyState >= 2) {
              triggerFreeze();
            } else {
              liveWebcamVideo.addEventListener('loadeddata', triggerFreeze, { once: true });
            }
          }

          // Собираем итоговый MediaStream:
          // оригинальный звук (микрофон) + подменённый видеотрек (с холста)
          const outputStream = new MediaStream();
          stream.getAudioTracks().forEach(t => outputStream.addTrack(t));
          outputStream.addTrack(virtualVideoTrack);

          // Связываем остановку треков
          const origStop = virtualVideoTrack.stop.bind(virtualVideoTrack);
          virtualVideoTrack.stop = () => {
            origStop();
            originalVideoTrack.stop();
          };

          return outputStream;
        } catch (e) {
          console.warn('[Maxitet Master] Ошибка проксирования видеопотока вебки:', e);
          return stream;
        }
      }

      return stream;
    };
  }

  // ─── 5. Мост к Pinia Store презентаций (Vue 3) ───────────────

  function getPresentationStoreData() {
    try {
      const appEl = document.querySelector('#app');
      const pinia = window.__pinia || appEl?.__vue_app__?.config?.globalProperties?.$pinia;
      if (pinia && pinia._s) {
        const store = pinia._s.get('presentations');
        if (store) {
          const file = store.presentationFile;
          return {
            srcTemplate: store.viewerSrc || file?.src || null,
            pagesCount: Number(store.viewerPagesCount || file?.pagesCount || 0),
            currentPage: Number(store.viewerPageNumber || 1),
            currentSrc: store.viewerSrcPage || null,
            isPresentationEnabled: Boolean(store.isPresentationEnabled),
          };
        }
      }
    } catch (e) {}
    return null;
  }

  setInterval(() => {
    const data = getPresentationStoreData();
    if (data) {
      window.__maxitet_presentation = data;
    }
  }, 1000);

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'MAXITET_GET_PRESENTATION_STORE') {
      const data = getPresentationStoreData() || window.__maxitet_presentation || null;
      window.postMessage({ type: 'MAXITET_PRESENTATION_STORE_DATA', data }, '*');
    }
  });

})();
