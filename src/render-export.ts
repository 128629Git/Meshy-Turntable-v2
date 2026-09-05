import * as THREE from 'three';
import GIF from 'gif.js';
import { AnimatedWebP, captureWebP } from './animated-webp';
import { frameTimeline, qualitySettings, type StudioSettings } from './studio-settings';

function nextFrame(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function finishGif(gif: GIF, signal: AbortSignal, progress: (value: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, blob?: Blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(blob!);
    };
    const abort = () => { finish(new DOMException('Export cancelled.', 'AbortError')); gif.abort(); };
    const timeout = setTimeout(() => { finish(new Error('GIF encoding took too long. Try Clean quality or WebP.')); gif.abort(); }, 180000);
    gif.on('finished', (blob) => finish(undefined, blob));
    gif.on('progress', (value) => progress(50 + Math.round(value * 50)));
    gif.on('abort', () => finish(new DOMException('Export cancelled.', 'AbortError')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      gif.render();
      const workers = gif as GIF & { activeWorkers?: Worker[]; freeWorkers?: Worker[] };
      [...(workers.activeWorkers ?? []), ...(workers.freeWorkers ?? [])].forEach((worker) => {
        worker.addEventListener('error', () => finish(new Error('The GIF encoder failed. Try exporting again or choose WebP.')), { once: true });
      });
    } catch (error) { finish(error); }
  });
}

export async function renderExport(
  scene: THREE.Scene, camera: THREE.PerspectiveCamera, model: THREE.Group,
  previewRenderer: THREE.WebGLRenderer, settings: StudioSettings,
  signal: AbortSignal, onProgress: (value: number) => void, png = false,
): Promise<Blob> {
  const { size } = qualitySettings[settings.quality];
  const startRotation = model.rotation.y;
  let renderer: THREE.WebGLRenderer | undefined;
  let gif: GIF | undefined;
  try {
    signal.throwIfAborted();
    const renderSize = Math.round(size * (size <= 480 ? 2 : 1.5));
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(renderSize, renderSize, false);
    renderer.outputColorSpace = previewRenderer.outputColorSpace;
    renderer.toneMapping = previewRenderer.toneMapping;
    renderer.toneMappingExposure = settings.exposure;
    renderer.setClearAlpha(png || settings.background === 'transparent' ? 0 : 1);
    const exportCamera = camera.clone();
    exportCamera.aspect = 1;
    exportCamera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const capture = canvas.getContext('2d', { alpha: true, willReadFrequently: !png && settings.format === 'gif' });
    if (!capture) throw new Error('This browser could not prepare the image exporter.');
    capture.imageSmoothingEnabled = true;
    capture.imageSmoothingQuality = 'high';
    const webp = !png && settings.format === 'webp' ? new AnimatedWebP(size, size) : null;
    if (webp) await captureWebP(canvas);
    if (!png && settings.format === 'gif') {
      // Preserve Classic GIF's color recipe; only frame timing is now corrected.
      const options: GIF.Options & { globalPalette: boolean } = {
        workers: Math.min(4, navigator.hardwareConcurrency || 2), quality: 1,
        width: size, height: size, workerScript: `${import.meta.env.BASE_URL}gif.worker.js`,
        transparent: settings.background === 'transparent' ? (0xff00ff as unknown as string) : null,
        dither: settings.background === 'transparent' ? false : 'FloydSteinberg-serpentine',
        globalPalette: settings.background !== 'transparent', repeat: 0,
      };
      gif = new GIF(options);
    }
    const timeline = png ? [{ angle: 0, delay: 0 }] : frameTimeline(settings);
    for (let i = 0; i < timeline.length; i++) {
      signal.throwIfAborted();
      model.rotation.y = startRotation + timeline[i].angle;
      renderer.render(scene, exportCamera);
      capture.clearRect(0, 0, size, size);
      capture.drawImage(renderer.domElement, 0, 0, renderSize, renderSize, 0, 0, size, size);
      if (png) {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
          if (value) resolve(value); else reject(new Error('The PNG could not be created.'));
        }, 'image/png'));
        signal.throwIfAborted();
        return blob;
      }
      if (webp) await webp.addFrame(await captureWebP(canvas), timeline[i].delay);
      else if (gif) {
        const frame = capture.getImageData(0, 0, size, size);
        if (settings.background === 'transparent') {
          for (let pixel = 0; pixel < frame.data.length; pixel += 4) {
            if (frame.data[pixel + 3] <= 127) {
              frame.data[pixel] = 255; frame.data[pixel + 1] = 0; frame.data[pixel + 2] = 255;
            }
            frame.data[pixel + 3] = 255;
          }
        }
        gif.addFrame(frame, { delay: timeline[i].delay, copy: true });
      }
      onProgress(Math.round((i + 1) / timeline.length * (webp ? 95 : 50)));
      await nextFrame(signal);
    }
    signal.throwIfAborted();
    return webp ? webp.finish() : await finishGif(gif!, signal, onProgress);
  } finally {
    if (gif) {
      const workers = gif as GIF & { activeWorkers?: Worker[]; freeWorkers?: Worker[] };
      [...(workers.activeWorkers ?? []), ...(workers.freeWorkers ?? [])].forEach((worker) => worker.terminate());
    }
    model.rotation.y = startRotation;
    model.updateMatrixWorld(true);
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}
