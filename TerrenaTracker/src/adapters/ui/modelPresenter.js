import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const STL_PATH = new URL("../../../assets/veleta.stl", import.meta.url).href;
const TARGET_MODEL_SIZE = 3.2;

let scene, camera, renderer, controls, model;
let initialized = false;

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
    () => {
      // keep empty scene if model fails to load
    }
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

function animate() {
  globalThis.requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

