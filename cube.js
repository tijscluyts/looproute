import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class DraggableCube {
    constructor(scene, camera, renderer, world) {
        this.camera = camera;
        this.renderer = renderer;
        this.world = world;

        // Create cube
        function createDiceFace(pipCount) {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, size, size);

            ctx.fillStyle = '#000';
            const r = 16;
            const positions = [
                [], // unused
                [[0.5, 0.5]],
                [[0.25, 0.25], [0.75, 0.75]],
                [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
                [[0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75]],
                [[0.25, 0.25], [0.25, 0.75], [0.5, 0.5], [0.75, 0.25], [0.75, 0.75]],
                [[0.25, 0.25], [0.25, 0.5], [0.25, 0.75], [0.75, 0.25], [0.75, 0.5], [0.75, 0.75]],
            ];
            positions[pipCount].forEach(([x, y]) => {
                ctx.beginPath();
                ctx.arc(x * size, y * size, r, 0, Math.PI * 2);
                ctx.fill();
            });
            return new THREE.CanvasTexture(canvas);
        }

        const diceTextures = [
            createDiceFace(1),
            createDiceFace(2),
            createDiceFace(3),
            createDiceFace(4),
            createDiceFace(5),
            createDiceFace(6),
        ];

        const diceMaterials = [
            new THREE.MeshLambertMaterial({ map: diceTextures[3] }), // right = 4
            new THREE.MeshLambertMaterial({ map: diceTextures[2] }), // left = 3
            new THREE.MeshLambertMaterial({ map: diceTextures[0] }), // top = 1
            new THREE.MeshLambertMaterial({ map: diceTextures[5] }), // bottom = 6
            new THREE.MeshLambertMaterial({ map: diceTextures[1] }), // front = 2
            new THREE.MeshLambertMaterial({ map: diceTextures[4] }), // back = 5
        ];

// Replace your cube creation:
        this.mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            diceMaterials
        );
        this.mesh.position.y = 0.5;
        scene.add(this.mesh);

        // Physics body
        this.body = new CANNON.Body({ mass: 1 });
        this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
        this.body.position.set(0, 0.5, 0);
        this.body.material = new CANNON.Material({ friction: 0.4, restitution: 0.3 });
        this.world.addBody(this.body);

        // Internal state
        this.dragging = false;
        this.dragOffset = new THREE.Vector3();
        this.dragPlane = new THREE.Plane();
        this.mouse = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.intersectPoint = new THREE.Vector3();

        // Event listeners
        this.pointerDownHandler = this.onPointerDown.bind(this);
        renderer.domElement.addEventListener('pointerdown', this.pointerDownHandler);
    }

    getMouse(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    onPointerDown(event) {
        this.getMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.mesh);
        if (intersects.length > 0) {
            this.dragging = true;
            
            // Disable physics while dragging
            this.body.type = CANNON.Body.KINEMATIC;
            
            this.dragPlane.setFromNormalAndCoplanarPoint(
                new THREE.Vector3(0, 1, 0), this.mesh.position
            );
            this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectPoint);
            this.dragOffset.copy(this.intersectPoint).sub(this.mesh.position);

            this.pointerMoveHandler = this.onPointerMove.bind(this);
            this.pointerUpHandler = this.onPointerUp.bind(this);
            
            // Lift the cube
            this.mesh.position.y = 2;
            this.body.position.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);


            document.addEventListener('pointermove', this.pointerMoveHandler);
            document.addEventListener('pointerup', this.pointerUpHandler);

            console.log("Drag started");
        }
    }

    onPointerMove(event) {
        if (!this.dragging) return;
        this.getMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        this.dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 0)
        );
        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectPoint)) {
            this.mesh.position.copy(this.intersectPoint.sub(this.dragOffset));
            this.mesh.position.y = 2; // Keep elevated while dragging
            
            // Sync physics body with mesh while dragging
            this.body.position.set(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
        }
    }

    onPointerUp() {
        this.dragging = false;
        document.removeEventListener('pointermove', this.pointerMoveHandler);
        document.removeEventListener('pointerup', this.pointerUpHandler);

        // Re-enable physics when released
        this.body.type = CANNON.Body.DYNAMIC;
        
        // Add some angular velocity for realistic rolling
        this.body.angularVelocity.set(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        );
        
        console.log("Cube released - physics enabled");
    }
    
    // Method to update physics synchronization
    updatePhysics() {
        if (!this.dragging) {
            // Sync Three.js mesh with cannon-es body
            this.mesh.position.copy(this.body.position);
            this.mesh.quaternion.copy(this.body.quaternion);
        }
    }
}