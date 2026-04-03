let scene, camera, renderer, cylinder, light;
let model3dInitialized = false;

function initializeModel3D() {
  if (model3dInitialized) return;

  scene = new THREE.Scene();

  const container = document.getElementById('model3d');
  camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(container.offsetWidth, container.offsetHeight);
  container.appendChild(renderer.domElement);

  const geometry = new THREE.CylinderGeometry(1.0, 1.0, 1.0, 32);
  const material = new THREE.MeshPhongMaterial({ color: 0x555b5a });
  cylinder = new THREE.Mesh(geometry, material);
  cylinder.position.set(0, 0, 0);
  scene.add(cylinder);

  light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(1, 1, 2).normalize();
  scene.add(light);

  camera.position.z = 5;
  camera.lookAt(0, 0, 0);

  model3dInitialized = true;
}

function animate() {
  requestAnimationFrame(animate);
  if (model3dInitialized && cylinder) {
    renderer.render(scene, camera);
  }
}

window.onload = () => {
  initializeModel3D();
  animate();
};

window.api.onPayloadData((data) => {
  if (cylinder) {
    const gx = data.gyroxRad !== undefined ? parseFloat(data.gyroxRad) : (data.gyrox !== undefined ? parseFloat(data.gyrox) * 0.0174533 : 0);
    const gy = data.gyroyRad !== undefined ? parseFloat(data.gyroyRad) : (data.gyroy !== undefined ? parseFloat(data.gyroy) * 0.0174533 : 0);
    const gz = data.gyrozRad !== undefined ? parseFloat(data.gyrozRad) : (data.gyroz !== undefined ? parseFloat(data.gyroz) * 0.0174533 : 0);

    cylinder.rotation.x = gx;
    cylinder.rotation.y = gy;
    cylinder.rotation.z = gz;
  }

  if (data.gyroxRad !== undefined) document.getElementById('gyroX').textContent = `X: ${data.gyroxRad} rad/s`;
  if (data.gyroyRad !== undefined) document.getElementById('gyroY').textContent = `Y: ${data.gyroyRad} rad/s`;
  if (data.gyrozRad !== undefined) document.getElementById('gyroZ').textContent = `Z: ${data.gyrozRad} rad/s`;
});

window.api.onError((message) => {
  alert(message);
});
