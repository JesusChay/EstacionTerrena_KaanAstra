import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const ROCKET_ASSET_PATH = new URL('../../../../assets/cohete.stl', import.meta.url).href;
const CANSAT_ASSET_PATH = new URL('../../../../assets/cansat.stl', import.meta.url).href;
const TARGET_MODEL_SIZE = 3.2;

let scene;
let camera;
let renderer;
let rocketModel;
let cansatModel;
let activeModel;
let fallbackModel;
let light;
let model3dInitialized = false;
let isDeployed = false;

function initializeModel3D() {
  if (model3dInitialized) return;

  scene = new THREE.Scene();

  const container = document.getElementById('model3d');
  camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(globalThis.window.devicePixelRatio || 1);
  renderer.setSize(container.offsetWidth, container.offsetHeight);
  container.appendChild(renderer.domElement);

  fallbackModel = buildFallbackModel();
  activeModel = fallbackModel;
  scene.add(fallbackModel);
  loadModels();

  light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1, 1, 2).normalize();
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  camera.position.z = 5;
  camera.lookAt(0, 0, 0);

  globalThis.window.addEventListener('resize', handleResize);

  model3dInitialized = true;
}

function animate() {
  globalThis.window.requestAnimationFrame(animate);
  if (model3dInitialized && activeModel) {
    renderer.render(scene, camera);
  }
}

function handleResize() {
  if (!model3dInitialized || !renderer || !camera) return;

  const container = document.getElementById('model3d');
  camera.aspect = container.offsetWidth / container.offsetHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.offsetWidth, container.offsetHeight);
}

function loadModels() {
  const loader = new STLLoader();

  loader.load(
    ROCKET_ASSET_PATH,
    (geometry) => {
      rocketModel = buildLoadedModel(geometry, -0.4);
      rocketModel.visible = !isDeployed;
      scene.add(rocketModel);
      onModelLoaded();
    },
    undefined,
    () => {}
  );

  loader.load(
    CANSAT_ASSET_PATH,
    (geometry) => {
      cansatModel = buildLoadedModel(geometry, 0);
      cansatModel.visible = isDeployed;
      scene.add(cansatModel);
      onModelLoaded();
    },
    undefined,
    () => {}
  );
}

function onModelLoaded() {
  if (!rocketModel || !cansatModel) return;
  scene.remove(fallbackModel);
  activeModel = isDeployed ? cansatModel : rocketModel;
}

function setDeploymentStatus(deployed) {
  isDeployed = deployed === true;
  if (rocketModel && cansatModel) {
    rocketModel.visible = !isDeployed;
    cansatModel.visible = isDeployed;
    activeModel = isDeployed ? cansatModel : rocketModel;
  }

  const modeChip = document.getElementById('modelModeChip');
  if (modeChip) {
    modeChip.textContent = isDeployed ? 'CanSat' : 'Cohete';
    modeChip.className = `chip-chip ${isDeployed ? 'chip-cansat' : 'chip-cohete'}`;
  }
}

window.api.onPayloadData((data) => {
  const deployed = data.decouplingStatus === true;
  if (deployed !== isDeployed) {
    setDeploymentStatus(deployed);
  }

  if (activeModel) {
    const gyroxRad = data.gyroxRad !== undefined ? Number.parseFloat(data.gyroxRad) : (data.gyrox !== undefined ? Number.parseFloat(data.gyrox) * 0.0174533 : 0);
    const gyroyRad = data.gyroyRad !== undefined ? Number.parseFloat(data.gyroyRad) : (data.gyroy !== undefined ? Number.parseFloat(data.gyroy) * 0.0174533 : 0);
    const gyrozRad = data.gyrozRad !== undefined ? Number.parseFloat(data.gyrozRad) : (data.gyroz !== undefined ? Number.parseFloat(data.gyroz) * 0.0174533 : 0);

    applyTelemetryRotation(activeModel, gyroxRad, gyroyRad, gyrozRad);
  }

  if (data.gyroxRad !== undefined) document.getElementById('gyroX').textContent = `X: ${data.gyroxRad} rad/s`;
  if (data.gyroyRad !== undefined) document.getElementById('gyroY').textContent = `Y: ${data.gyroyRad} rad/s`;
  if (data.gyrozRad !== undefined) document.getElementById('gyroZ').textContent = `Z: ${data.gyrozRad} rad/s`;
});

window.api.onError((message) => {
  globalThis.window.alert(message);
});

function buildFallbackModel() {
  const geometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 32);
  const material = new THREE.MeshPhongMaterial({ color: 0x555b5a });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  mesh.userData.baseRotation = { x: 0, y: 0, z: 0 };
  return mesh;
}

function buildLoadedModel(geometry, positionY) {
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const scaleFactor = TARGET_MODEL_SIZE / maxDimension;

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({
      color: 0xd4d7d9,
      shininess: 75,
      specular: 0x6fd8d8
    })
  );

  mesh.scale.setScalar(scaleFactor);
  mesh.position.set(0, positionY, 0);
  mesh.userData.baseRotation = { x: -Math.PI / 2, y: 0, z: 0 };
  applyTelemetryRotation(mesh, 0, 0, 0);
  return mesh;
}

function applyTelemetryRotation(mesh, gx, gy, gz) {
  const baseRotation = mesh.userData.baseRotation || { x: 0, y: 0, z: 0 };
  mesh.rotation.x = baseRotation.x + (Number.isFinite(gx) ? gx : 0);
  mesh.rotation.y = baseRotation.y + (Number.isFinite(gy) ? gy : 0);
  mesh.rotation.z = baseRotation.z + (Number.isFinite(gz) ? gz : 0);
}

initializeModel3D();
animate();
