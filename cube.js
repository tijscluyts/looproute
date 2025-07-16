import * as THREE from 'three';

export class DraggableCube {
    constructor(scene, camera, renderer) {
        this.camera = camera;
        this.renderer = renderer;

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
            this.dragPlane.setFromNormalAndCoplanarPoint(
                new THREE.Vector3(0, 1, 0), this.mesh.position
            );
            this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectPoint);
            this.dragOffset.copy(this.intersectPoint).sub(this.mesh.position);

            this.pointerMoveHandler = this.onPointerMove.bind(this);
            this.pointerUpHandler = this.onPointerUp.bind(this);
            // In onPointerDown
            this.mesh.position.y = 2; // lift the cube


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
            new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.5, 0)
        );
        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.intersectPoint)) {
            this.mesh.position.copy(this.intersectPoint.sub(this.dragOffset));
            this.mesh.position.y = 0.5;
            // Uncomment for debug: console.log("Dragging", this.mesh.position);
        }
        // In onPointerMove (allow moving at y=2 while dragging)
        this.mesh.position.y = 2;


    }

    onPointerUp() {
        this.dragging = false;
        document.removeEventListener('pointermove', this.pointerMoveHandler);
        document.removeEventListener('pointerup', this.pointerUpHandler);

        // Animate drop (or just set position)
        this.mesh.position.y = 0.5;

        // Collision detection
        // 1. Create Box3 for cube
        const cubeBox = new THREE.Box3().setFromObject(this.mesh);

        // 2. Create Box3 for table
        // Assuming your table mesh is called "ground" and its geometry is PlaneGeometry
        // and positioned at y=0
        const tableSize = 10; // (from your PlaneGeometry)
        const tableMin = new THREE.Vector3(-tableSize/2, 0, -tableSize/2);
        const tableMax = new THREE.Vector3( tableSize/2, 0.55, tableSize/2); // 0.55 for cube sitting exactly on table

        const tableBox = new THREE.Box3(tableMin, tableMax);

        // 3. Check intersection
        const intersects = cubeBox.intersectsBox(tableBox);

        if(intersects) {
            console.log("Cube collides with the table!");
        } else {
            console.log("Cube does NOT collide with the table!");
            // For realism, you may want to animate it falling down until it hits the table.
            // Or clamp its position so it can't go below y=0.5.
        }
    }
}