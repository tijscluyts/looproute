// Installation: npm install cannon-es
// Physics engine for realistic dice falling, bouncing, and rolling
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DraggableCube } from './cube.js';

let camera, scene, renderer, world, groundBody;

// Physics world setup
world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.NaiveBroadphase();
world.solver.iterations = 10;

// Scene setup
scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

// Camera
camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2, 5);
camera.lookAt(0, 0.5, 0);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7.5);
scene.add(dirLight);

// Ground
const groundGeo = new THREE.PlaneGeometry(10, 10);
const groundMat = new THREE.MeshLambertMaterial({ color: 0x3366cc });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// Ground physics body
groundBody = new CANNON.Body({ mass: 0 });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

// Renderer
renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Cube (with drag logic)
const cube = new DraggableCube(scene, camera, renderer, world);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  // Step physics simulation
  world.step(1/60);
  
  // Update cube physics
  cube.updatePhysics();
  
  renderer.render(scene, camera);
}
animate();

// Responsive resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});