export function createModelPresenter() {
  const Three = globalThis.window?.THREE;
  const MODEL_ASSET_PATH = resolveAssetUrl('assets/cohete.stl');
  const TARGET_MODEL_SIZE = 3.2;
  let scene;
  let camera;
  let renderer;
  let modelObject;
  let fallbackModel;
  let modelContainer;
  let modelInitialized = false;

  function initialize() {
    if (modelInitialized || !Three) return;

    modelContainer = document.getElementById('model3dView');
    scene = new Three.Scene();
    scene.background = null;
    camera = new Three.PerspectiveCamera(60, modelContainer.clientWidth / modelContainer.clientHeight, 0.1, 1000);
    renderer = new Three.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(globalThis.window?.devicePixelRatio || 1);
    renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
    renderer.outputEncoding = Three.sRGBEncoding;
    modelContainer.appendChild(renderer.domElement);

    fallbackModel = buildFallbackModel(Three);
    scene.add(fallbackModel);
    loadRealModel();

    const ambient = new Three.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const directional = new Three.DirectionalLight(0xffffff, 1.2);
    directional.position.set(3, 3, 4);
    scene.add(directional);

    camera.position.set(0, 0.4, 5.5);
    camera.lookAt(0, 0, 0);

    globalThis.window?.addEventListener('resize', handleResize);
    modelInitialized = true;
  }

  function animate() {
    globalThis.window?.requestAnimationFrame(animate);
    if (modelInitialized && renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  function handleResize() {
    if (!modelInitialized || !modelContainer || !renderer || !camera) return;
    camera.aspect = modelContainer.clientWidth / modelContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
  }

  function updateTelemetry(modelState) {
    if (!modelInitialized || !modelState) return;

    const activeModel = modelObject || fallbackModel;
    if (!activeModel) return;

    const gx = Number.isFinite(modelState.gyroxRad) ? modelState.gyroxRad : 0;
    const gy = Number.isFinite(modelState.gyroyRad) ? modelState.gyroyRad : 0;
    const gz = Number.isFinite(modelState.gyrozRad) ? modelState.gyrozRad : 0;

    applyTelemetryRotation(activeModel, gx, gy, gz);

    document.getElementById('gyroX').textContent = `X: ${Number.isFinite(gx) ? gx.toFixed(4) : '0.0000'} rad/s`;
    document.getElementById('gyroY').textContent = `Y: ${Number.isFinite(gy) ? gy.toFixed(4) : '0.0000'} rad/s`;
    document.getElementById('gyroZ').textContent = `Z: ${Number.isFinite(gz) ? gz.toFixed(4) : '0.0000'} rad/s`;
  }

  function loadRealModel() {
    if (typeof Three.STLLoader === 'undefined') {
      console.warn('[Model3D] STLLoader no disponible — usando modelo de respaldo');
      return;
    }

    console.log('[Model3D] Cargando STL desde:', MODEL_ASSET_PATH);
    const loader = new Three.STLLoader();
    loader.load(
      MODEL_ASSET_PATH,
      (geometry) => {
        console.log('[Model3D] STL cargado exitosamente');
        modelObject = buildLoadedModel(Three, geometry, {
          targetSize: TARGET_MODEL_SIZE,
          positionY: -0.4
        });
        scene.remove(fallbackModel);
        scene.add(modelObject);
      },
      undefined,
      (error) => {
        console.error('[Model3D] Error al cargar STL:', error);
        modelObject = fallbackModel;
      }
    );
  }

  return {
    initialize,
    animate,
    handleResize,
    updateTelemetry
  };
}

function buildFallbackModel(Three) {
  const group = new Three.Group();
  group.userData.baseRotation = { x: 0, y: 0, z: 0 };

  const bodyGeometry = new Three.CylinderGeometry(0.8, 0.8, 2.2, 32);
  const bodyMaterial = new Three.MeshPhongMaterial({ color: 0x6e7775, shininess: 60 });
  const body = new Three.Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  const capGeometry = new Three.ConeGeometry(0.82, 0.55, 32);
  const capMaterial = new Three.MeshPhongMaterial({ color: 0xd8b35e, shininess: 45 });
  const cap = new Three.Mesh(capGeometry, capMaterial);
  cap.position.y = 1.35;
  group.add(cap);

  const baseRing = new Three.Mesh(
    new Three.TorusGeometry(0.72, 0.06, 16, 40),
    new Three.MeshPhongMaterial({ color: 0x4bc0c0 })
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = -1.1;
  group.add(baseRing);

  return group;
}

function buildLoadedModel(Three, geometry, { targetSize, positionY }) {
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const size = new Three.Vector3();
  geometry.boundingBox.getSize(size);
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const scaleFactor = targetSize / maxDimension;

  const mesh = new Three.Mesh(
    geometry,
    new Three.MeshPhongMaterial({
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

function resolveAssetUrl(relativePath) {
  try {
    const moduleUrl = new URL('../..', import.meta.url);
    return new URL(relativePath, moduleUrl).href;
  } catch {
    const base = globalThis.window?.location?.href ?? './';
    const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
    return baseDir + relativePath;
  }
}
