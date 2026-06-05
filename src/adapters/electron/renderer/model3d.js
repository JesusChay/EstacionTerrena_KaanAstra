const MODEL_ASSET_PATH = '../../../../assets/cohete.stl';
const TARGET_MODEL_SIZE = 3.2;

let scene, camera, renderer, activeModel, fallbackModel, light;
let model3dInitialized = false;

function initializeModel3D() {
  if (model3dInitialized) return;

  scene = new THREE.Scene();

  const container = document.getElementById('model3d');
  camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(container.offsetWidth, container.offsetHeight);
  container.appendChild(renderer.domElement);

  fallbackModel = buildFallbackModel();
  activeModel = fallbackModel;
  scene.add(fallbackModel);
  loadRocketModel();

  light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1, 1, 2).normalize();
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  camera.position.z = 5;
  camera.lookAt(0, 0, 0);

  window.addEventListener('resize', handleResize);

  model3dInitialized = true;
}

function animate() {
  requestAnimationFrame(animate);
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

function loadRocketModel() {
  if (typeof THREE.STLLoader === 'undefined') {
    return;
  }

  const loader = new THREE.STLLoader();
  loader.load(
    MODEL_ASSET_PATH,
    (geometry) => {
      const rocketModel = buildLoadedModel(geometry);
      scene.remove(fallbackModel);
      activeModel = rocketModel;
      scene.add(rocketModel);
    },
    undefined,
    () => {
      activeModel = fallbackModel;
    }
  );
}

window.onload = () => {
  initializeModel3D();
  animate();
};

window.api.onPayloadData((data) => {
  if (activeModel) {
    const gx = data.gyroxRad !== undefined ? parseFloat(data.gyroxRad) : (data.gyrox !== undefined ? parseFloat(data.gyrox) * 0.0174533 : 0);
    const gy = data.gyroyRad !== undefined ? parseFloat(data.gyroyRad) : (data.gyroy !== undefined ? parseFloat(data.gyroy) * 0.0174533 : 0);
    const gz = data.gyrozRad !== undefined ? parseFloat(data.gyrozRad) : (data.gyroz !== undefined ? parseFloat(data.gyroz) * 0.0174533 : 0);

    applyTelemetryRotation(activeModel, gx, gy, gz);
  }

  if (data.gyroxRad !== undefined) document.getElementById('gyroX').textContent = `X: ${data.gyroxRad} rad/s`;
  if (data.gyroyRad !== undefined) document.getElementById('gyroY').textContent = `Y: ${data.gyroyRad} rad/s`;
  if (data.gyrozRad !== undefined) document.getElementById('gyroZ').textContent = `Z: ${data.gyrozRad} rad/s`;
});

window.api.onError((message) => {
  alert(message);
});

function buildFallbackModel() {
  const geometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 32);
  const material = new THREE.MeshPhongMaterial({ color: 0x555b5a });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 0, 0);
  mesh.userData.baseRotation = { x: 0, y: 0, z: 0 };
  return mesh;
}

function buildLoadedModel(geometry) {
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
  mesh.position.set(0, -0.4, 0);
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
