import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const STL_PATH = new URL("../../../assets/veleta.stl", import.meta.url).href;
const TARGET_MODEL_SIZE = 3.2;

const COMPASS_MAP = {
  "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
  "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
  "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
  "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5
};

let scene, camera, renderer, controls, model;
let initialized = false;
let currentCompassDeg = null;
let hasReceivedData = false;
let clock = new THREE.Clock();

function compassToDegrees(dir) {
  return COMPASS_MAP[dir] !== undefined ? COMPASS_MAP[dir] : null;
}

export function initModel3D(containerId) {
  if (initialized) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  scene = new THREE.Scene();

  const w = container.offsetWidth;
  const h = container.offsetHeight;
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
  camera.position.set(4, 3, 5);

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(2, 5, 3);
  scene.add(dirLight);

  const backLight = new THREE.DirectionalLight(0x88ccff, 0.4);
  backLight.position.set(-2, 0, -3);
  scene.add(backLight);

  loadModel();

  globalThis.addEventListener("resize", () => handleResize(containerId));

  initialized = true;
  animate();
}

function loadModel() {
  const loader = new STLLoader();
  loader.load(
    STL_PATH,
    (geometry) => {
      model = buildModel(geometry);
      scene.add(model);
    },
    undefined,
    () => {}
  );
}

function buildModel(geometry) {
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = TARGET_MODEL_SIZE / maxDim;

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({
      color: 0xd4d7d9,
      shininess: 60,
      specular: 0x6fd8d8
    })
  );

  mesh.scale.setScalar(scale);
  mesh.rotation.order = "YXZ";
  return mesh;
}

function handleResize(containerId) {
  if (!renderer || !camera) return;
  const container = document.getElementById(containerId);
  if (!container) return;
  const w = container.offsetWidth;
  const h = container.offsetHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

export function updateModelRotation(compassDir) {
  if (!compassDir) return;
  const deg = compassToDegrees(compassDir);
  if (deg === null) return;
  hasReceivedData = true;
  currentCompassDeg = deg;
  if (controls) controls.autoRotate = false;
}

function lerpAngleRad(current, target, factor) {
  let diff = target - current;
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * factor;
}

function animate() {
  globalThis.requestAnimationFrame(animate);

  if (model) {
    if (hasReceivedData && currentCompassDeg !== null) {
      const targetRad = THREE.MathUtils.degToRad(currentCompassDeg);
      const elapsed = clock.getElapsedTime();
      const windOscillation = THREE.MathUtils.degToRad(Math.sin(elapsed * 1.5) * 3);
      model.rotation.y = lerpAngleRad(model.rotation.y, targetRad + windOscillation, 0.05);
    } else {
      clock.getElapsedTime();
    }
  }

  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}
