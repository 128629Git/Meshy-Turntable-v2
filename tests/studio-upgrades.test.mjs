import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const temporary = await mkdtemp(join(tmpdir(), 'meshy-tests-'));
after(() => rm(temporary, { recursive: true, force: true }));
await build({ stdin: { contents: `export * from './src/studio-settings'; export * from './src/model-tools'; export * from './src/batch-zip'; export * from './src/run-batch'; export * as THREE from 'three';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: join(temporary, 'helpers.mjs'), logLevel: 'silent' });
const { THREE, defaults, margins, parseSettings, frameTimeline, readModel, fitFullRotation, makeBatchZip, outputName, runBatch } = await import(pathToFileURL(join(temporary, 'helpers.mjs')).href);

test('all durations and qualities use one complete turn with exact GIF/WebP timing', () => {
  for (const format of ['gif', 'webp']) for (const quality of ['draft', 'standard', 'high']) {
    for (let loopSeconds = 2; loopSeconds <= 12; loopSeconds += .5) {
      const frames = frameTimeline({ ...defaults, format, quality, loopSeconds });
      assert.equal(frames.reduce((total, frame) => total + frame.delay, 0), loopSeconds * 1000);
      let elapsed = 0;
      for (const frame of frames) {
        assert.ok(frame.delay >= 20);
        if (format === 'gif') assert.equal(frame.delay % 10, 0);
        assert.ok(Math.abs(frame.angle - elapsed / (loopSeconds * 1000) * Math.PI * 2) < 1e-12);
        elapsed += frame.delay;
      }
      assert.ok(frames.at(-1).angle < Math.PI * 2, 'the seam does not repeat the first frame');
    }
  }
});

test('saved settings round-trip and reject corrupt preferences', () => {
  const settings = { ...defaults, format: 'webp', margin: 'roomy', quality: 'high', exposure: .75, background: 'transparent', loopSeconds: 7.5, autoRotate: false };
  assert.deepEqual(parseSettings(JSON.parse(JSON.stringify(settings))), settings);
  for (const bad of [null, [], {}, { ...settings, loopSeconds: 0 }, { ...settings, exposure: Infinity }, { ...settings, quality: '__proto__' }, { ...settings, margin: 'constructor' }, { ...settings, format: 'png' }]) assert.equal(parseSettings(bad), null);
});

function pointsOf(model) {
  const points = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const count = child instanceof THREE.InstancedMesh ? child.count : 1;
    for (let n = 0; n < count; n++) {
      const matrix = child.matrixWorld.clone();
      if (child instanceof THREE.InstancedMesh) { const instance = new THREE.Matrix4(); child.getMatrixAt(n, instance); matrix.multiply(instance); }
      for (let i = 0; i < child.geometry.attributes.position.count; i++) points.push(child.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(matrix));
    }
  });
  return points;
}

test('full-turn fit preserves tight/balanced/roomy margins for tall, wide, asymmetric, and instanced models', () => {
  const models = [];
  for (const dimensions of [[12, 1, 2], [.3, 12, .5], [1, 1, 1]]) {
    const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(...dimensions))); models.push(model);
  }
  const asymmetric = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(6, .25, 2)); wing.position.set(2, 1, .5);
  asymmetric.add(wing, new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1))); models.push(asymmetric);
  const instances = new THREE.Group();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 3, .5), new THREE.MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-3, 0, 0)); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 1, 2)); instances.add(mesh); models.push(instances);
  for (const model of models) for (const direction of [[0, .1, 1], [1, .7, 1], [.01, 1, .02], [-1, -.4, .2]]) {
    let previousDistance = 0;
    for (const margin of ['tight', 'balanced', 'roomy']) {
      model.rotation.y = .63;
      const camera = new THREE.PerspectiveCamera(30, 1, .01, 1000); camera.position.set(...direction);
      fitFullRotation(model, camera, margin);
      assert.ok(camera.position.length() > previousDistance); previousDistance = camera.position.length();
      const limit = 1 - 2 * margins[margin];
      for (let turn = 0; turn < 360; turn += 2) {
        model.rotation.y = THREE.MathUtils.degToRad(turn);
        for (const point of pointsOf(model)) {
          point.project(camera);
          assert.ok(Math.abs(point.x) <= limit + 1e-6 && Math.abs(point.y) <= limit + 1e-6, `${margin}: ${point.x}, ${point.y}`);
          assert.ok(point.z >= -1 && point.z <= 1, 'near/far clipping');
        }
      }
    }
  }
});

test('GLB loading centers an off-origin model under a separate rotation pivot', async () => {
  const positions = new Float32Array([0,0,0, 2,0,0, 0,4,0]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [35,-12,8] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0,0,0], max: [2,4,0] }], bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], buffers: [{ byteLength: positions.byteLength }] };
  const data = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(data.length / 4) * 4;
  const glb = new Uint8Array(12 + 8 + padded + 8 + positions.byteLength); const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); glb.fill(32, 20, 20 + padded); glb.set(data, 20);
  view.setUint32(20 + padded, positions.byteLength, true); view.setUint32(24 + padded, 0x004e4942, true); glb.set(new Uint8Array(positions.buffer), 28 + padded);
  const model = await readModel(new File([glb], 'offset.glb'), 1);
  const bounds = new THREE.Box3().setFromObject(model, true);
  assert.ok(bounds.getCenter(new THREE.Vector3()).length() < 1e-5);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - 2.45) < 1e-5);
  assert.deepEqual(model.position.toArray(), [0,0,0]);
});

test('batch releases each model and continues after an invalid file', async () => {
  const log = [], results = []; let live = 0, maximum = 0;
  await runBatch(['first','bad','third'], new AbortController().signal, {
    open: async (name) => { if (name === 'bad') throw new Error('bad GLB'); maximum = Math.max(maximum, ++live); return { name }; },
    render: async (model, progress) => { progress(100); return model.name; },
    dispose: (model) => { live--; log.push(`dispose ${model.name}`); },
    started: () => {}, progress: () => {}, finished: (_, value) => results.push(value), failed: (name) => log.push(`failed ${name}`),
  });
  assert.deepEqual(results, ['first','third']); assert.equal(maximum, 1); assert.equal(live, 0);
  assert.deepEqual(log, ['dispose first','failed bad','dispose third']);
});

test('stopping during model loading disposes it and keeps prior completed outputs', async () => {
  const controller = new AbortController(), results = [], disposed = [], failed = [];
  await assert.rejects(() => runBatch([1,2,3], controller.signal, {
    open: async (id) => { if (id === 2) controller.abort(); return { id }; },
    render: async (model) => model.id,
    dispose: (model) => disposed.push(model.id), started: () => {}, progress: () => {},
    finished: (_, value) => results.push(value), failed: (id, _, cancelled) => failed.push([id,cancelled]),
  }), { name: 'AbortError' });
  assert.deepEqual(results, [1]); assert.deepEqual(disposed, [1,2]); assert.deepEqual(failed, [[2,true]]);
});

test('ZIP independently extracts duplicate and Unicode filenames with correct bytes', async () => {
  const entries = [{ name: outputName('雪の竜.glb','webp'), blob: new Blob(['first animation']) }, { name: outputName('雪の竜.glb','webp'), blob: new Blob(['second animation']) }];
  const blob = await makeBatchZip(entries, new AbortController().signal);
  const path = join(temporary, 'batch.zip'); await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  const check = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', `import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n assert len(set(z.namelist())) == 2\n assert z.read(z.namelist()[0]) == b'first animation'\n assert z.read(z.namelist()[1]) == b'second animation'\n assert all('雪の竜' in n for n in z.namelist())`, path], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => makeBatchZip(entries, controller.signal), { name: 'AbortError' });
});

test('the real GIF worker retains exact loop duration after centisecond encoding', async () => {
  const source = await readFile('public/gif.worker.js', 'utf8');
  const timeline = frameTimeline({ ...defaults, quality: 'draft', loopSeconds: 4 });
  const parts = [];
  const context = { self: { postMessage: (frame) => {
    frame.data.forEach((page, i) => parts.push(Buffer.from(page.subarray(0, i === frame.data.length - 1 ? frame.cursor : frame.pageSize))));
  } }, Uint8Array, Uint32Array, Int32Array, Float64Array, Math };
  vm.runInNewContext(source, context);
  for (let i = 0; i < timeline.length; i++) {
    const pixels = new Uint8Array(16*16*4);
    for (let p = 0; p < pixels.length; p += 4) { pixels[p] = i*5; pixels[p+1] = (p/4)%16*16; pixels[p+2] = 80; pixels[p+3] = 255; }
    context.self.onmessage({ data: { index: i, last: i === timeline.length-1, width: 16, height: 16, data: pixels, delay: timeline[i].delay, quality: 1, dither: false, globalPalette: false, transparent: null, repeat: 0, canTransfer: false } });
  }
  const path = join(temporary, 'timing.gif'); await writeFile(path, Buffer.concat(parts));
  const check = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', `from PIL import Image\nimport sys\nim=Image.open(sys.argv[1]); assert im.n_frames==48\nt=0\nfor i in range(im.n_frames):\n im.seek(i); t+=im.info['duration']\nassert t==4000, t`, path], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
