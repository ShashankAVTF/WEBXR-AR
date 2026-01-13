import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, controls, transformControl;
let currentModel = null;

// --- GLOBAL REFERENCES FOR TEXTURES ---
let wallMeshReference = null;
let floorMeshReference = null;

// --- COLLISION VARIABLES ---
let almirahBox = null;
// room limits
const roomLimits = { 
    minX: -3.25, maxX: 3.25, 
    minZ: -3.92, maxZ: 2.8 
};

// Collision Helpers
const boxHelper = new THREE.Box3();
let lastValidPosition = new THREE.Vector3();
let lastValidRotation = new THREE.Euler();

// --- 1. SETUP URL PARAMS ---
// Example: mysite.com/?model=POT1
const urlParams = new URLSearchParams(window.location.search);
const modelName = urlParams.get('model') || 'recliner1'; // Default if empty

// --- 2. TEXTURE LOADER ---
const textureLoader = new THREE.TextureLoader();
const WALL_TEXTURES = [
    textureLoader.load('./textures/wall1.jpg'),
    textureLoader.load('./textures/wall2.jpg'),
    textureLoader.load('./textures/wall3.jpg')
];
const FLOOR_TEXTURES = [
    textureLoader.load('./textures/floor1.jpg'),
    textureLoader.load('./textures/floor2.jpg')
];

// Texture Settings
[...WALL_TEXTURES, ...FLOOR_TEXTURES].forEach(tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
});

init();
animate();

function init() {
    //Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 3, 3);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Camera Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // GIZMO SETUP
    transformControl = new TransformControls(camera, renderer.domElement);
    
    // Disable camera movement while dragging gizmo
    transformControl.addEventListener('dragging-changed', function (event) {
        controls.enabled = !event.value;
    });

    // --- COLLISION LOGIC ---
    transformControl.addEventListener('change', function () {
        if (!currentModel) return;

        //Calculate the new bounding box
        boxHelper.setFromObject(currentModel);

        //Check Room Boundaries
        const isOutside = 
            boxHelper.min.x < roomLimits.minX || boxHelper.max.x > roomLimits.maxX ||
            boxHelper.min.z < roomLimits.minZ || boxHelper.max.z > roomLimits.maxZ;

        //Check Almirah Collision
        const hitsAlmirah = almirahBox ? boxHelper.intersectsBox(almirahBox) : false;

        if (isOutside || hitsAlmirah) {
            //Revert to safe state
            currentModel.position.copy(lastValidPosition);
            currentModel.rotation.copy(lastValidRotation);
        } else {
            //Update safe state
            lastValidPosition.copy(currentModel.position);
            lastValidRotation.copy(currentModel.rotation);
        }
    });
    scene.add(transformControl);

    //Load Assets
    loadCustomRoom();
    loadProduct(); // Loads model based on URL

    //Event Listeners
    window.addEventListener('resize', onWindowResize);
    
    // UI
    window.addEventListener('updateWall', (e) => applyWallTexture(e.detail));
    window.addEventListener('updateFloor', (e) => applyFloorTexture(e.detail));
    window.addEventListener('setGizmoMode', (e) => setGizmoMode(e.detail));
}

function loadCustomRoom() {
    const loader = new GLTFLoader();
    loader.load('./models/room.glb', (gltf) => {
        const room = gltf.scene;
        
        room.traverse((child) => {
            if (child.isMesh) {
                child.receiveShadow = true;

                // Find and Save Wall Mesh
                if (child.name.includes('Wall')) {
                    wallMeshReference = child;
                    child.material = new THREE.MeshStandardMaterial({ map: WALL_TEXTURES[0] });
                }
                
                // Find and Save Floor Mesh
                if (child.name.includes('Floor')) {
                    floorMeshReference = child;
                    child.material = new THREE.MeshStandardMaterial({ map: FLOOR_TEXTURES[0] });
                }

                //Almirah for Collision
                if (child.name.includes('Almirah')) {
                    almirahBox = new THREE.Box3().setFromObject(child);
                }
            }
        });
        scene.add(room);
    });
}

function loadProduct() {
    const loader = new GLTFLoader();
    
    // Dynamic Path based on URL
    const modelPath = `./models/${modelName}.glb`;
    console.log(`Loading: ${modelPath}`);

    loader.load(modelPath, (gltf) => {
        currentModel = gltf.scene;
        
        // Center the model
        const box = new THREE.Box3().setFromObject(currentModel);
        const center = box.getCenter(new THREE.Vector3());
        currentModel.position.sub(center);
        currentModel.position.y = 0; 

        // Save initial valid state
        lastValidPosition.copy(currentModel.position);
        lastValidRotation.copy(currentModel.rotation);

        // Shadows
        currentModel.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true; }});

        scene.add(currentModel);

        // Attach Gizmo & Default to Move
        transformControl.attach(currentModel);
        setGizmoMode('translate');
    }, 
    undefined, 
    (error) => {
        console.error("Model load failed:", error);
        alert(`Could not load model: ${modelName}.glb`);
    });
}

// --- HELPER FUNCTIONS ---

function setGizmoMode(mode) {
    transformControl.setMode(mode);

    if (mode === 'translate') {
        // MOVE
        transformControl.showX = true;
        transformControl.showZ = true;
        transformControl.showY = false; 
    } else if (mode === 'rotate') {
        // ROTATE
        transformControl.showX = false;
        transformControl.showZ = false;
        transformControl.showY = true; 
    }
}

function applyWallTexture(index) {
    if (wallMeshReference && WALL_TEXTURES[index]) {
        wallMeshReference.material.map = WALL_TEXTURES[index];
        wallMeshReference.material.needsUpdate = true;
    }
}

function applyFloorTexture(index) {
    if (floorMeshReference && FLOOR_TEXTURES[index]) {
        floorMeshReference.material.map = FLOOR_TEXTURES[index];
        floorMeshReference.material.needsUpdate = true;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}