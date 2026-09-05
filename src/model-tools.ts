import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { margins, type Margin } from './studio-settings';

export function disposeModel(model: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => materials.add(m));
    if (child instanceof THREE.SkinnedMesh) child.skeleton.dispose();
  });
  materials.forEach((material) => {
    Object.values(material).forEach((v) => { if (v instanceof THREE.Texture) textures.add(v); });
    material.dispose();
  });
  textures.forEach((texture) => {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
}

export async function readModel(file: File, anisotropy: number): Promise<THREE.Group> {
  if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('Please choose a .GLB file.');
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  const root = gltf.scene;
  try {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (box.isEmpty() || !Number.isFinite(largest) || largest <= 0) throw new Error('This GLB has no visible geometry to frame.');
    const center = box.getCenter(new THREE.Vector3());
    // A parent at the true center makes the turntable rotate around the model,
    // including GLBs whose original pivot is off to one side.
    root.position.sub(center);
    const model = new THREE.Group();
    model.add(root);
    model.scale.setScalar(2.45 / largest);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => {
        if ('map' in material && material.map instanceof THREE.Texture) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.anisotropy = Math.min(8, anisotropy);
          material.map.needsUpdate = true;
        }
      });
    });
    model.updateMatrixWorld(true);
    return model;
  } catch (error) { disposeModel(root); throw error; }
}

// Maximize the projection of every vertex over a continuous full Y rotation.
// This fits wings, tails, and weapons between sampled export angles too.
export function fitFullRotation(model: THREE.Group, camera: THREE.PerspectiveCamera, margin: Margin) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  if (box.isEmpty()) return;
  const direction = camera.position.clone().normalize();
  if (direction.lengthSq() < .01) direction.set(0, .3, 1).normalize();
  camera.position.copy(direction);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (1 - 2 * margins[margin]);
  // Fit both the live aspect and the square export.
  const tanH = tanV * Math.min(1, camera.aspect);
  const planes = [right.clone().divideScalar(tanH), up.clone().divideScalar(tanV)]
    .flatMap((axis) => [direction.clone().add(axis), direction.clone().sub(axis)])
    .map((p) => ({ radial: Math.hypot(p.x, p.z), y: p.y }));
  let distance = 0;
  let radius = 0;
  let minY = Infinity;
  const vertex = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry.attributes.position) return;
    const count = child instanceof THREE.InstancedMesh ? child.count : 1;
    for (let n = 0; n < count; n++) {
      matrix.copy(child.matrixWorld);
      if (child instanceof THREE.InstancedMesh) { child.getMatrixAt(n, instance); matrix.multiply(instance); }
      for (let i = 0; i < child.geometry.attributes.position.count; i++) {
        child.getVertexPosition(i, vertex).applyMatrix4(matrix);
        const radial = Math.hypot(vertex.x, vertex.z);
        for (const plane of planes) distance = Math.max(distance, radial * plane.radial + vertex.y * plane.y);
        radius = Math.max(radius, vertex.length());
        minY = Math.min(minY, vertex.y);
      }
    }
  });
  distance = Math.max(distance * 1.002, .1);
  camera.position.copy(direction.multiplyScalar(distance));
  camera.near = Math.max(.001, distance - radius * 1.05);
  camera.far = distance + radius * 2 + 1;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return minY;
}
