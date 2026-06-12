import {
  AmbientLight,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshPhongMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export function createModelPresenter({ containerElement }) {
  const ROCKET_ASSET_PATH = new URL('../../assets/cohete.stl', import.meta.url).href;
  const CANSAT_ASSET_PATH = new URL('../../assets/cansat.stl', import.meta.url).href;
  const TARGET_MODEL_SIZE = 3.2;
  let scene;
  let camera;
  let renderer;
  let rocketObject;
  let cansatObject;
  let activeModel;
  let fallbackModel;
  let modelContainer;
  let modelInitialized = false;
  let animationFrameId = null;
  let isDeployed = false;

  function initialize() {
    if (modelInitialized || !containerElement) return;

    modelContainer = containerElement;
    scene = new Scene();
    scene.background = null;
    camera = new PerspectiveCamera(60, modelContainer.clientWidth / modelContainer.clientHeight, 0.1, 1000);
    renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(globalThis.window?.devicePixelRatio || 1);
    renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
    if ('outputColorSpace' in renderer) {
      renderer.outputColorSpace = SRGBColorSpace;
    }
    modelContainer.appendChild(renderer.domElement);

    fallbackModel = buildFallbackModel();
    scene.add(fallbackModel);
    activeModel = fallbackModel;
    loadModels();

    const ambient = new AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const directional = new DirectionalLight(0xffffff, 1.2);
    directional.position.set(3, 3, 4);
    scene.add(directional);

    camera.position.set(0, 0.4, 5.5);
    camera.lookAt(0, 0, 0);

    globalThis.window?.addEventListener('resize', handleResize);
    modelInitialized = true;
  }

  function animate() {
    if (animationFrameId) return;

    const renderFrame = () => {
      animationFrameId = globalThis.window?.requestAnimationFrame(renderFrame) || null;
      if (modelInitialized && renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };

    renderFrame();
  }

  function handleResize() {
    if (!modelInitialized || !modelContainer || !renderer || !camera) return;
    camera.aspect = modelContainer.clientWidth / modelContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(modelContainer.clientWidth, modelContainer.clientHeight);
  }

  function setDeploymentStatus(deployed) {
    isDeployed = deployed === true;
    if (rocketObject && cansatObject) {
      rocketObject.visible = !isDeployed;
      cansatObject.visible = isDeployed;
      activeModel = isDeployed ? cansatObject : rocketObject;
    }
  }

  function updateTelemetry(modelState) {
    if (!modelInitialized || !modelState) return;

    const target = activeModel || fallbackModel;
    if (!target) return;

    const gx = Number.isFinite(modelState.gyroxRad) ? modelState.gyroxRad : 0;
    const gy = Number.isFinite(modelState.gyroyRad) ? modelState.gyroyRad : 0;
    const gz = Number.isFinite(modelState.gyrozRad) ? modelState.gyrozRad : 0;

    applyTelemetryRotation(target, gx, gy, gz);
  }

  function dispose() {
    if (animationFrameId) {
      globalThis.window?.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    globalThis.window?.removeEventListener('resize', handleResize);

    if (renderer) {
      renderer.dispose?.();
    }

    if (renderer?.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }

    renderer = null;
    scene = null;
    camera = null;
    rocketObject = null;
    cansatObject = null;
    activeModel = null;
    fallbackModel = null;
    modelContainer = null;
    modelInitialized = false;
  }

  function loadModels() {
    const loader = new STLLoader();

    loader.load(
      ROCKET_ASSET_PATH,
      (geometry) => {
        rocketObject = buildLoadedModel(geometry, {
          targetSize: TARGET_MODEL_SIZE,
          positionY: -0.4
        });
        rocketObject.visible = !isDeployed;
        scene.add(rocketObject);
        onModelLoaded();
      },
      undefined,
      () => {}
    );

    loader.load(
      CANSAT_ASSET_PATH,
      (geometry) => {
        cansatObject = buildLoadedModel(geometry, {
          targetSize: TARGET_MODEL_SIZE,
          positionY: 0
        });
        cansatObject.visible = isDeployed;
        scene.add(cansatObject);
        onModelLoaded();
      },
      undefined,
      () => {}
    );
  }

  function onModelLoaded() {
    if (!rocketObject || !cansatObject) return;
    scene.remove(fallbackModel);
    activeModel = isDeployed ? cansatObject : rocketObject;
  }

  return {
    initialize,
    animate,
    dispose,
    handleResize,
    updateTelemetry,
    setDeploymentStatus
  };
}

function buildFallbackModel() {
  const group = new Group();
  group.userData.baseRotation = { x: 0, y: 0, z: 0 };

  const bodyGeometry = new CylinderGeometry(0.8, 0.8, 2.2, 32);
  const bodyMaterial = new MeshPhongMaterial({ color: 0x6e7775, shininess: 60 });
  const body = new Mesh(bodyGeometry, bodyMaterial);
  group.add(body);

  const capGeometry = new ConeGeometry(0.82, 0.55, 32);
  const capMaterial = new MeshPhongMaterial({ color: 0xd8b35e, shininess: 45 });
  const cap = new Mesh(capGeometry, capMaterial);
  cap.position.y = 1.35;
  group.add(cap);

  const baseRing = new Mesh(
    new TorusGeometry(0.72, 0.06, 16, 40),
    new MeshPhongMaterial({ color: 0x4bc0c0 })
  );
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.y = -1.1;
  group.add(baseRing);

  return group;
}

function buildLoadedModel(geometry, { targetSize, positionY }) {
  geometry.center();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const size = new Vector3();
  geometry.boundingBox.getSize(size);
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const scaleFactor = targetSize / maxDimension;

  const mesh = new Mesh(
    geometry,
    new MeshPhongMaterial({
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
