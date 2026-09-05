import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { backgrounds, defaults, margins, parseSettings, qualitySettings, type Margin, type StudioSettings } from './studio-settings';
import { disposeModel, fitFullRotation, readModel } from './model-tools';
import { renderExport } from './render-export';
import { makeBatchZip, outputName } from './batch-zip';
import { runBatch } from './run-batch';

type ExportResult = { url: string; name: string; format: 'gif' | 'webp' | 'png'; bytes: number; size: number; frames: number; seconds: number; transparent: boolean };
type Preset = { name: string; settings: StudioSettings };
type QueueItem = { id: string; file: File; status: 'queued' | 'loading' | 'rendering' | 'done' | 'failed'; progress: number; error?: string; blob?: Blob; result?: ExportResult };
type Job = 'animation' | 'png' | 'batch' | 'zip';
const STORAGE_KEY = 'meshy-turntable-studio-v1';
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The export could not be completed. Please try again.';

export default function Home() {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const floorRef = useRef<THREE.Mesh | null>(null);
  const animationRef = useRef(0);
  const exportingRef = useRef(false);
  const loadingRef = useRef(false);
  const settingsRef = useRef(defaults);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const resultUrlRef = useRef('');
  const zipUrlRef = useRef('');
  const queueRef = useRef<QueueItem[]>([]);
  const resultRef = useRef<HTMLElement>(null);

  const [fileName, setFileName] = useState('');
  const [modelSize, setModelSize] = useState('');
  const [settings, setSettings] = useState<StudioSettings>(defaults);
  const { format, quality, background, loopSeconds, margin, exposure, autoRotate } = settings;
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("My Portfolio");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [zip, setZip] = useState<{ url: string; bytes: number; count: number } | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const exporting = job !== null;
  const completed = queue.filter((item) => item.status === 'done');
  const remaining = queue.length - completed.length;

  const updateSettings = (patch: Partial<StudioSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  };
  const updateQueue = (update: (items: QueueItem[]) => QueueItem[]) => {
    queueRef.current = update(queueRef.current);
    if (mountedRef.current) setQueue(queueRef.current);
  };

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const restored = parseSettings(stored?.settings);
      if (restored) setSettings(restored);
      if (Array.isArray(stored?.presets)) {
        const valid: Preset[] = [];
        for (const item of stored.presets.slice(0, 50)) {
          const parsed = parseSettings(item?.settings);
          if (parsed && typeof item.name === 'string' && item.name.trim()) valid.push({ name: item.name.trim().slice(0, 40), settings: parsed });
        }
        setPresets(valid);
      }
    } catch { setNotice('Saved preferences are unavailable here. You can still use all export tools.'); }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    if (!preferencesReady) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, presets })); }
    catch { setNotice('These settings could not be saved on this device. Exports still work.'); }
  }, [settings, presets, preferencesReady]);

  useEffect(() => {
    mountedRef.current = true;
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ffffff');
    const camera = new THREE.PerspectiveCamera(30, 1, .01, 1000);
    camera.position.set(4.2, 2.8, 5.4);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true, powerPreference: 'high-performance' }); }
    catch { setError('This browser could not start the 3D preview. Please enable WebGL or try a current desktop browser.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .06;
    controls.autoRotate = false;
    controls.target.set(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554b44, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(4, 6, 7); scene.add(key);
    const fill = new THREE.DirectionalLight(0xbad8ff, 1.7); fill.position.set(-5, 3, 2); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd4b0, 2.1); rim.position.set(2, 4, -6); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.15, 96), new THREE.MeshStandardMaterial({ color: 0xc8c3b8, roughness: .95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor); floorRef.current = floor;
    const resize = () => {
      const width = Math.max(1, mount.clientWidth), height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(mount);
    let previousTime = performance.now();
    const onVisibility = () => { previousTime = performance.now(); };
    document.addEventListener('visibilitychange', onVisibility);
    const animate = (time: number) => {
      const deltaSeconds = document.hidden ? 0 : (time - previousTime) / 1000;
      previousTime = time;
      if (!exportingRef.current) {
        controls.update(deltaSeconds);
        // Use the same model rotation as export, so lighting and direction match.
        if (settingsRef.current.autoRotate && modelRef.current) {
          modelRef.current.rotation.y = (modelRef.current.rotation.y + deltaSeconds * Math.PI * 2 / settingsRef.current.loopSeconds) % (Math.PI * 2);
        }
      }
      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    rendererRef.current = renderer; sceneRef.current = scene; cameraRef.current = camera; controlsRef.current = controls;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect(); cancelAnimationFrame(animationRef.current);
      URL.revokeObjectURL(resultUrlRef.current); URL.revokeObjectURL(zipUrlRef.current);
      queueRef.current.forEach((item) => { if (item.result) URL.revokeObjectURL(item.result.url); });
      if (modelRef.current) disposeModel(modelRef.current);
      floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      controls.dispose(); renderer.dispose(); mount.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.background = background === 'transparent' ? null : new THREE.Color(background);
    if (rendererRef.current) { rendererRef.current.setClearAlpha(background === 'transparent' ? 0 : 1); rendererRef.current.toneMappingExposure = exposure; }
    if (floorRef.current) floorRef.current.visible = background !== 'transparent';
  }, [background, exposure]);

  const centerAndFitModel = (chosenMargin: Margin = margin) => {
    const model = modelRef.current, camera = cameraRef.current, controls = controlsRef.current;
    if (!model || !camera || !controls) return;
    camera.position.sub(controls.target);
    controls.target.set(0, 0, 0);
    const minY = fitFullRotation(model, camera, chosenMargin);
    if (floorRef.current && minY !== undefined) floorRef.current.position.y = minY;
  };
  const chooseMargin = (chosen: Margin) => { updateSettings({ margin: chosen }); centerAndFitModel(chosen); };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) { setNotice('Give your preset a name first.'); return; }
    const next = [...presets.filter((p) => p.name !== name), { name, settings: { ...settings } }].slice(-50);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, presets: next })); setPresets(next); setNotice(`Saved “${name}” on this device.`); }
    catch { setNotice('This browser could not save the preset. Check whether browser storage is disabled.'); }
  };
  const applyPreset = (name: string) => {
    const preset = presets.find((p) => p.name === name);
    if (!preset) return;
    setSettings({ ...preset.settings }); setPresetName(preset.name);
    centerAndFitModel(preset.settings.margin); setNotice(`Applied “${preset.name}”.`);
  };

  const loadModel = async (file: File) => {
    if (exportingRef.current || loadingRef.current) return;
    const scene = sceneRef.current, renderer = rendererRef.current;
    if (!scene || !renderer) { setError('The 3D preview is unavailable in this browser.'); return; }
    loadingRef.current = true; setLoading(true); setError('');
    try {
      const model = await readModel(file, renderer.capabilities.getMaxAnisotropy());
      if (!mountedRef.current) { disposeModel(model); return; }
      if (modelRef.current) { scene.remove(modelRef.current); disposeModel(modelRef.current); }
      scene.add(model); modelRef.current = model;
      centerAndFitModel();
      setFileName(file.name); setModelSize(formatBytes(file.size)); setModelReady(true);
    } catch (cause) { if (mountedRef.current) setError(`${file.name}: ${messageOf(cause)}`); }
    finally { loadingRef.current = false; if (mountedRef.current) setLoading(false); }
  };
  const clearZip = () => { URL.revokeObjectURL(zipUrlRef.current); zipUrlRef.current = ''; setZip(null); };
  const addBatch = (files: File[]) => {
    if (exportingRef.current || loadingRef.current) return;
    const valid = files.filter((file) => file.name.toLowerCase().endsWith('.glb'));
    if (valid.length !== files.length) setError('Only .GLB files were added to the batch.');
    clearZip();
    updateQueue((items) => [...items, ...valid.map((file): QueueItem => ({ id: crypto.randomUUID(), file, status: 'queued', progress: 0 }))]);
  };
  const chooseFiles = (files: File[]) => {
    if (!files.length || exportingRef.current || loadingRef.current) return;
    if (files.length > 1) addBatch(files);
    const first = files.find((file) => file.name.toLowerCase().endsWith('.glb')) ?? files[0];
    void loadModel(first);
  };
  const onInput = (event: ChangeEvent<HTMLInputElement>) => { chooseFiles(Array.from(event.target.files ?? [])); event.target.value = ''; };
  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); chooseFiles(Array.from(event.dataTransfer.files)); };

  const startJob = (kind: Job) => {
    if (exportingRef.current || loadingRef.current) return null;
    const controller = new AbortController(); abortRef.current = controller;
    exportingRef.current = true; if (controlsRef.current) controlsRef.current.enabled = false;
    setJob(kind); setProgress(0); setError(''); setNotice(''); return controller;
  };
  const finishJob = () => {
    exportingRef.current = false; abortRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (mountedRef.current) setJob(null);
  };
  const resultFor = (blob: Blob, name: string, snapshot: StudioSettings, png = false): ExportResult => ({
    url: URL.createObjectURL(blob), name: outputName(name, png ? 'png' : snapshot.format),
    format: png ? 'png' : snapshot.format, bytes: blob.size, size: qualitySettings[snapshot.quality].size,
    frames: png ? 1 : qualitySettings[snapshot.quality].frames, seconds: png ? 0 : snapshot.loopSeconds,
    transparent: png || snapshot.background === 'transparent',
  });
  const presentResult = (next: ExportResult) => {
    URL.revokeObjectURL(resultUrlRef.current); resultUrlRef.current = next.url; setResult(next);
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const exportAnimation = async (png = false) => {
    const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current, model = modelRef.current;
    if (!renderer || !scene || !camera || !model) return;
    const controller = startJob(png ? 'png' : 'animation'); if (!controller) return;
    const originalBackground = scene.background;
    const originalFloor = floorRef.current?.visible;
    try {
      if (png) { scene.background = null; if (floorRef.current) floorRef.current.visible = false; }
      const blob = await renderExport(scene, camera, model, renderer, { ...settings }, controller.signal, setProgress, png);
      controller.signal.throwIfAborted();
      presentResult(resultFor(blob, fileName, settings, png)); setProgress(100);
    } catch (cause) { if (mountedRef.current) { if (controller.signal.aborted) setNotice('Export cancelled.'); else setError(messageOf(cause)); } }
    finally { scene.background = originalBackground; if (floorRef.current && originalFloor !== undefined) floorRef.current.visible = originalFloor; finishJob(); }
  };

  const makeZip = async (items: QueueItem[], signal: AbortSignal) => {
    const entries = items.filter((item) => item.blob && item.result).map((item) => ({ blob: item.blob!, name: item.result!.name }));
    const blob = await makeBatchZip(entries, signal);
    signal.throwIfAborted();
    clearZip(); const url = URL.createObjectURL(blob); zipUrlRef.current = url;
    setZip({ url, bytes: blob.size, count: entries.length });
  };
  const exportBatch = async () => {
    const renderer = rendererRef.current, scene = sceneRef.current, camera = cameraRef.current, controls = controlsRef.current;
    if (!renderer || !scene || !camera || !controls) { setError('The 3D preview is unavailable in this browser.'); return; }
    const pending = queueRef.current.filter((item) => item.status !== 'done');
    if (!pending.length) return;
    const controller = startJob('batch'); if (!controller) return;
    const snapshot = { ...settings };
    const original = modelRef.current;
    const originalVisibility = original?.visible;
    const originalCamera = camera.clone();
    const originalFloorY = floorRef.current?.position.y;
    const direction = camera.position.clone().sub(controls.target).normalize();
    clearZip();
    if (original) original.visible = false;
    try {
      await runBatch(pending, controller.signal, {
        open: (item) => readModel(item.file, renderer.capabilities.getMaxAnisotropy()),
        render: async (model, onProgress) => {
          scene.add(model); camera.position.copy(direction);
          const minY = fitFullRotation(model, camera, snapshot.margin);
          if (floorRef.current && minY !== undefined) floorRef.current.position.y = minY;
          return renderExport(scene, camera, model, renderer, snapshot, controller.signal, onProgress);
        },
        dispose: (model) => { scene.remove(model); disposeModel(model); },
        started: (item) => updateQueue((items) => items.map((row) => row.id === item.id ? { ...row, status: 'loading', progress: 0, error: undefined } : row)),
        progress: (item, value, index) => {
          setProgress(Math.round((index + value / 100) / pending.length * 95));
          updateQueue((items) => items.map((row) => row.id === item.id ? { ...row, status: 'rendering', progress: value } : row));
        },
        finished: (item, blob) => {
          const next = resultFor(blob, item.file.name, snapshot);
          updateQueue((items) => items.map((row) => row.id === item.id ? { ...row, status: 'done', progress: 100, result: next, blob } : row));
        },
        failed: (item, cause, cancelled) => updateQueue((items) => items.map((row) => row.id === item.id ? { ...row, status: cancelled ? 'queued' : 'failed', progress: 0, error: cancelled ? undefined : messageOf(cause) } : row)),
      });
      if (queueRef.current.some((item) => item.status === 'done')) {
        setNotice('Preparing the batch download…');
        await makeZip(queueRef.current, controller.signal);
      }
      setProgress(100);
      const done = queueRef.current.filter((item) => item.status === 'done').length;
      setNotice(`${done} of ${queueRef.current.length} models exported. ${done < queueRef.current.length ? 'Check the failed items below; you can retry them.' : 'Your ZIP is ready to download.'}`);
    } catch (cause) { if (mountedRef.current) { if (controller.signal.aborted) setNotice('Batch stopped. Completed exports are kept; you can continue the remaining models.'); else setError(messageOf(cause)); } }
    finally {
      if (original && originalVisibility !== undefined) original.visible = originalVisibility;
      camera.copy(originalCamera); camera.updateMatrixWorld(true);
      if (floorRef.current && originalFloorY !== undefined) floorRef.current.position.y = originalFloorY;
      finishJob();
    }
  };
  const prepareZip = async () => {
    const controller = startJob('zip'); if (!controller) return;
    try { await makeZip(queueRef.current, controller.signal); }
    catch (cause) { if (mountedRef.current && !controller.signal.aborted) setError(messageOf(cause)); }
    finally { finishJob(); }
  };
  const removeBatchItem = (id: string) => {
    clearZip();
    updateQueue((items) => items.filter((item) => { if (item.id !== id) return true; if (item.result) URL.revokeObjectURL(item.result.url); return false; }));
  };
  const resetBatch = (clear = false) => {
    clearZip();
    updateQueue((items) => { items.forEach((item) => { if (item.result) URL.revokeObjectURL(item.result.url); }); return clear ? [] : items.map((item) => ({ id: item.id, file: item.file, status: 'queued', progress: 0 })); });
  };
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Meshy Turntable home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Meshy <b>Turntable</b></span>
        </a>
        <div className="privacy"><span /> Your model stays in your browser</div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">GLB → GIF or WebP, without the fuss</p>
          <h1>Give your 3D work<br />a proper <em>spin.</em></h1>
        </div>
        <p className="dek">
          Drop in a GLB, frame the perfect angle, and export a smooth looping GIF or full-color WebP.
          No uploads. No account. Just your model, ready to share.
        </p>
      </section>

      <section className="studio">
        <div className="viewer-column">
        <div className="viewer-card">
          <div className="viewer-head">
            <span className="step">01</span>
            <div><h2>Preview</h2><p>Drag to orbit · Scroll to zoom</p></div>
            {fileName && <span className="file-pill">{job === "batch" ? "Batch export in progress" : `${fileName} · ${modelSize}`}</span>}
          </div>
          <div
            className={`viewer ${background === "transparent" ? "transparency-grid" : ""} ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); if (!exporting && !loading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div ref={mountRef} className="canvas-mount" />
            {!fileName && job !== "batch" && (
              <button disabled={loading || exporting} className="drop-prompt" onClick={() => fileRef.current?.click()}>
                <span className="upload-icon">↥</span>
                <strong>{loading ? "Opening your model…" : "Drop your GLB here"}</strong>
                <small>or click to choose a file</small>
              </button>
            )}
            <input ref={fileRef} type="file" multiple accept=".glb,model/gltf-binary" onChange={onInput} disabled={loading || exporting} hidden />
            {fileName && (
              <>
                <button className="center-model" onClick={() => centerAndFitModel()} disabled={exporting || loading}>
                  <span aria-hidden="true">⊙</span> Center &amp; fit
                </button>
                <button className="replace" disabled={exporting || loading} onClick={() => fileRef.current?.click()}>{loading ? "Opening model…" : "Replace model"}</button>
              </>
            )}
          </div>
        </div>

        <section className="batch-panel" aria-labelledby="batch-title">
          <div className="batch-heading"><div><h2 id="batch-title">Batch export</h2><p>One setup for your whole collection.</p></div><span>{queue.length} models</span></div>
          <p>Choose several GLBs, or drop them into the preview. Each model is centered and fitted with your current settings.</p>
          <input ref={batchFileRef} type="file" multiple accept=".glb,model/gltf-binary" hidden disabled={exporting || loading} onChange={(event) => { addBatch(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
          <div className="batch-actions">
            <button className="secondary-button" disabled={exporting || loading} onClick={() => batchFileRef.current?.click()}>Add GLBs</button>
            <button className="secondary-button primary" disabled={!remaining || exporting || loading} onClick={exportBatch}>{completed.length ? `Export remaining (${remaining})` : 'Export batch'}</button>
            {queue.length > 0 && <button className="text-button" disabled={exporting || loading} onClick={() => resetBatch(true)}>Clear batch</button>}
            {completed.length > 0 && <button className="text-button" disabled={exporting || loading} onClick={() => resetBatch()}>Reset exports</button>}
          </div>
          {job === 'batch' && <div className="batch-progress" role="status"><span>{progress < 95 ? `Exporting batch · ${progress}%` : 'Preparing the ZIP…'}</span><button className="text-button" onClick={() => { abortRef.current?.abort(); setNotice('Stopping the batch… Completed exports will be kept.'); }}>Stop batch</button></div>}
          {queue.length > 0 && <ol className="batch-list">
            {queue.map((item) => <li key={item.id}>
              <div className="batch-file"><strong>{item.file.name}</strong><span>{item.status === 'queued' ? 'Ready' : item.status === 'loading' ? 'Opening model…' : item.status === 'rendering' ? `Rendering ${item.progress}%` : item.status === 'failed' ? item.error : `${item.result?.format.toUpperCase()} · ${item.result?.size}px · ${item.result?.seconds.toFixed(1)}s · ${formatBytes(item.blob?.size ?? 0)}`}</span></div>
              <div className="batch-row-actions">
                {item.result && item.blob && <><button className="text-button" disabled={exporting} onClick={() => presentResult({ ...item.result!, url: URL.createObjectURL(item.blob!) })}>Preview</button><a href={item.result.url} download={item.result.name}>Download</a></>}
                <button className="text-button" disabled={exporting || loading} aria-label={`Remove ${item.file.name} from batch`} onClick={() => removeBatchItem(item.id)}>Remove</button>
              </div>
            </li>)}
          </ol>}
          {zip ? <a className="download-button" href={zip.url} download="meshy-turntables.zip">Download ZIP · {zip.count} files · {formatBytes(zip.bytes)}</a> : completed.length > 0 && <button className="secondary-button" disabled={exporting || loading} onClick={prepareZip}>Prepare ZIP of completed exports</button>}
          <p className="batch-note">Models are processed one at a time. Keep this tab open until the batch finishes. Files and downloads stay here until you close or reload it. Use Reset exports to apply new settings to completed files.</p>
        </section>
        </div>

        <aside className="controls-card">
          <div className="panel-title"><span className="step">02</span><div><h2>Tune the loop</h2><p>Make it presentation-ready</p></div></div>
          <fieldset className="export-controls" disabled={exporting || loading}>
          <legend className="sr-only">Animation settings</legend>
          <details className="preset-panel">
            <summary>Saved presets</summary>
            <label htmlFor="saved-preset">Apply a preset</label>
            <select id="saved-preset" value="" onChange={(event) => applyPreset(event.target.value)} disabled={!presets.length}>
              <option value="">{presets.length ? 'Choose a saved preset…' : 'No presets yet'}</option>
              {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
            </select>
            <label htmlFor="preset-name">Preset name</label>
            <input id="preset-name" type="text" maxLength={40} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
            <button className="secondary-button" onClick={savePreset}>{presets.some((preset) => preset.name === presetName.trim()) ? 'Update preset' : 'Save current settings'}</button>
            <p>Background, timing, size, format, framing, and light level. Your last-used settings are remembered automatically on this device.</p>
          </details>
          <label className="control-label">Background</label>
          <div className="swatches">
            {backgrounds.map((option) => (
              <button
                key={option.value}
                aria-label={option.label}
                title={option.label}
                className={`${background === option.value ? "selected" : ""} ${option.value === "transparent" ? "transparent-swatch" : ""}`}
                style={option.value === "transparent" ? undefined : { backgroundColor: option.value }}
                aria-pressed={background === option.value}
                onClick={() => updateSettings({ background: option.value })}
              />
            ))}
          </div>

          <div className="control-row">
            <label htmlFor="duration">Seconds per rotation <b>{loopSeconds.toFixed(1)} s</b></label>
            <input id="duration" type="range" min="2" max="12" step=".5" value={loopSeconds} onChange={(event) => updateSettings({ loopSeconds: Number(event.target.value) })} />
            <small>Shared by the live preview, GIF, and WebP.</small>
          </div>

          <button className={`toggle-row ${autoRotate ? "on" : ""}`} onClick={() => updateSettings({ autoRotate: !autoRotate })} aria-pressed={autoRotate}>
            <span><b>Live rotation</b><small>Preview the loop in motion</small></span><i><u /></i>
          </button>

          <label className="control-label">Framing margin</label>
          <div className="segments" role="group" aria-label="Framing margin">
            {(Object.keys(margins) as Margin[]).map((choice) => <button key={choice} className={margin === choice ? 'active' : ''} aria-pressed={margin === choice} onClick={() => chooseMargin(choice)}>{choice.charAt(0).toUpperCase() + choice.slice(1)}</button>)}
          </div>
          <p className="format-note">Automatically refits the full rotation. Center &amp; fit uses this margin too.</p>
          <div className="control-row">
            <label htmlFor="exposure">Light level <b>{exposure.toFixed(2)}×</b></label>
            <input id="exposure" type="range" min=".5" max="2" step=".05" value={exposure} onChange={(event) => updateSettings({ exposure: Number(event.target.value) })} />
          </div>
          <label className="control-label">Export format</label>
          <div className="segments format-segments" role="group" aria-label="Export format">
            <button className={format === "gif" ? "active" : ""} aria-pressed={format === "gif"} onClick={() => updateSettings({ format: "gif" })}>Classic GIF<small>Existing settings</small></button>
            <button className={format === "webp" ? "active" : ""} aria-pressed={format === "webp"} onClick={() => updateSettings({ format: "webp" })}>Animated WebP<small>Full color · smooth alpha</small></button>
          </div>
          <p className="format-note">{format === "webp" ? "Smoother shading and transparent edges. Check that your destination accepts animated WebP." : "Your existing GIF recipe, preserved for familiar results and broad compatibility."}</p>

          <label className="control-label">Export quality</label>
          <div className="segments">
            {(Object.keys(qualitySettings) as (keyof typeof qualitySettings)[]).map((item) => (
              <button key={item} className={quality === item ? "active" : ""} aria-pressed={quality === item} onClick={() => updateSettings({ quality: item })}>
                {qualitySettings[item].label}<small>{qualitySettings[item].size}px</small>
              </button>
            ))}
          </div>

          <div className="export-info">
            <span>{qualitySettings[quality].frames} frames</span>
            <span>{loopSeconds.toFixed(1)}-second loop</span>
            <span>Square {format === "gif" ? "GIF" : "WebP"}</span>
          </div>

          </fieldset>
          <button className="export-button" disabled={!modelReady || exporting || loading} onClick={() => exportAnimation()}>
            {exporting ? (job === "zip" ? "Preparing ZIP…" : `${job === "batch" ? "Batch" : "Rendering"} ${progress}%`) : `Create ${format === "gif" ? "GIF" : "WebP"} preview`} <span>→</span>
          </button>
          <button className="png-button" disabled={!modelReady || exporting || loading} onClick={() => exportAnimation(true)}>Capture transparent PNG</button>
          <p className="format-note">Captures the current angle without a background. Pause live rotation to choose a precise pose.</p>
          {exporting && <><div className="progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div><button className="cancel-button" onClick={() => abortRef.current?.abort()}>{job === 'batch' ? 'Stop batch' : 'Cancel'}</button></>}
          {notice && <p className="format-note" role="status">{notice}</p>}
          {error && <p className="export-error" role="alert">{error}</p>}
          <p className="local-note">Everything is rendered locally on your device.</p>
        </aside>
      </section>

      {result && (
        <section className="result-card" ref={resultRef} aria-labelledby="result-title">
          <div className="result-image transparency-grid">
            {/* Display the exact encoded blob used by the download link. */}
            <img src={result.url} width={result.size} height={result.size} alt={`Finished ${result.format.toUpperCase()} of ${result.name}`} onError={() => setError("This browser could not display the finished animation. Try Classic GIF or another browser.")} />
          </div>
          <div className="result-details">
            <p className="eyebrow">Ready to review</p>
            <h2 id="result-title">{result.format === "png" ? "Your transparent PNG" : "Your finished animation"}</h2>
            <p>This is the actual exported file. Check the shading, edges, and framing before downloading.</p>
            <p className="result-name">{result.name}</p>
            <ul className="result-meta">
              <li>{result.size} × {result.size} px</li>{result.format !== 'png' && <><li>{result.frames} frames</li><li>{result.seconds.toFixed(2)}-second loop</li></>}<li>{formatBytes(result.bytes)}</li>
              <li>{result.transparent ? "Transparent background" : "Solid background"}</li>
            </ul>
            <a className="download-button" href={result.url} download={result.name}>Download {result.format === "webp" ? "WebP" : result.format.toUpperCase()} <span aria-hidden="true">↓</span></a>
            <p className="result-note">Changing settings leaves this preview in place. Create a new preview to see those changes.</p>
          </div>
        </section>
      )}

      <section className="how">
        <p className="eyebrow">A tiny studio in three steps</p>
        <div className="how-grid">
          <article><span>1</span><h3>Bring the model</h3><p>Choose one GLB or a batch of self-contained GLBs. Textures and materials come along for the ride.</p></article>
          <article><span>2</span><h3>Set the stage</h3><p>Orbit, zoom, choose a background, then preview the speed until the framing feels right.</p></article>
          <article><span>3</span><h3>Share the spin</h3><p>Export a looping GIF or WebP for your portfolio, shop listing, or social feed.</p></article>
        </div>
      </section>

      <footer><span>Meshy Turntable</span><p>Made for makers who want their work seen from every side.</p><b>GLB in · GIF / WebP out</b></footer>
    </main>
  );
}
