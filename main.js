import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- GLOBAL VARIABLES ---
let container;
let camera, scene, renderer;
let controller;
let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;

// Model & Logic
let currentModel = null;
let loadedGLTF = null;
let isDragging = false;
let previousX = 0;

// Reuse this vector to prevent memory crashes
const workingVec = new THREE.Vector3();

// Get Model Name from URL
const urlParams = new URLSearchParams(window.location.search);
const modelName = urlParams.get('model') || 'POT1';

init();
animate();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // --- LIGHTING ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    // --- RENDERER ---
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Prevent scrolling on the canvas
    renderer.domElement.style.touchAction = 'none'; 
    container.appendChild(renderer.domElement);

    // --- PLATFORM CHECK ---
    // If iOS, we skip WebXR setup and show the .usdz button instead
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
    
    if (isIOS) {
        setupIOSFallback(); // Call the Apple logic
        alert("ios")
    } else {
        // Setup Android/WebXR logic
        setupWebXR();
        console.log("webXr")
        alert("webxr")
    }

    window.addEventListener('resize', onWindowResize);
}

// --- ANDROID / WEBXR SETUP ---
function setupWebXR() {
    // 1. Add "Start AR" Button
    document.body.appendChild(ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] }));

    // 2. Load the .GLB Model dynamically
    const loader = new GLTFLoader();
    const glbPath = `./models/${modelName}.glb`;
    
    loader.load(glbPath, function (gltf) {
        loadedGLTF = gltf.scene;
        console.log(`Loaded: ${glbPath}`);
    }, undefined, function(error) {
        console.error("Error loading GLB:", error);
        alert(`Could not load ${glbPath}. Check file name.`);
    });

    // 3. Setup Reticle
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // 4. Setup Input
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    initTouchControls();
}

// --- IOS / AR QUICK LOOK SETUP ---
function setupIOSFallback() {
    // Create a styled button for iOS users
    const button = document.createElement('a');
    button.href = `./models/${modelName}.usdz`; // Link to the .usdz file
    button.rel = "ar"; // Trigger AR Quick Look
    
    // Button Styling
    button.style.position = 'absolute';
    button.style.bottom = '50px';
    button.style.left = '50%';
    button.style.transform = 'translateX(-50%)';
    button.style.padding = '15px 30px';
    button.style.backgroundColor = 'white';
    button.style.color = 'black';
    button.style.border = 'none';
    button.style.borderRadius = '30px';
    button.style.fontFamily = 'sans-serif';
    button.style.fontWeight = 'bold';
    button.style.textDecoration = 'none';
    button.style.boxShadow = '0px 4px 10px rgba(0,0,0,0.3)';
    
    // Add an icon (optional unicode cube)
    button.textContent = "📦 View in AR"; 
    
    // Only show the button if the file actually looks like an AR file
    const img = document.createElement('img');
    // You can add a preview image here if you want
    
    document.body.appendChild(button);
    
    // Add a helper text
    const msg = document.createElement('div');
    msg.textContent = "iOS detected: Using Apple Quick Look";
    msg.style.position = 'absolute';
    msg.style.top = '20px';
    msg.style.width = '100%';
    msg.style.textAlign = 'center';
    msg.style.color = '#888';
    document.body.appendChild(msg);
}

// --- INTERACTION LOGIC (WEBXR ONLY) ---

function onSelect() {
    if (isDragging) return; 

    if (reticle.visible && loadedGLTF) {
        if (currentModel) {
            currentModel.position.setFromMatrixPosition(reticle.matrix);
        } else {
            currentModel = loadedGLTF.clone();
            currentModel.position.setFromMatrixPosition(reticle.matrix);
            scene.add(currentModel);
        }
    }
}

function shouldShowReticle(reticleMatrix) {
    if (!currentModel) return true;
    
    // optimized vector (no memory leak)
    workingVec.setFromMatrixPosition(reticleMatrix);
    const distance = workingVec.distanceTo(currentModel.position);
    
    return distance > 0.5; // Hide if within 0.5m
}

function initTouchControls() {
    window.addEventListener('touchstart', (e) => {
        isDragging = true;
        previousX = e.touches[0].clientX;
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        // Prevent browser scrolling
        e.preventDefault(); 
        
        if (isDragging && currentModel) {
            const currentX = e.touches[0].clientX;
            const deltaX = currentX - previousX;
            currentModel.rotation.y += deltaX * 0.01;
            previousX = currentX;
        }
    }, { passive: false });

    window.addEventListener('touchend', () => {
        setTimeout(() => { isDragging = false; }, 100);
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    // Only run WebXR logic if we are actually in a session
    if (frame && renderer.xr.isPresenting) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then((referenceSpace) => {
                session.requestHitTestSource({ space: referenceSpace }).then((source) => {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const hitPose = hit.getPose(referenceSpace);

                // Update Matrix FIRST
                reticle.matrix.fromArray(hitPose.transform.matrix);

                // Then check logic
                if (shouldShowReticle(reticle.matrix)) {
                    reticle.visible = true;
                } else {
                    reticle.visible = false;
                }
            } else {
                reticle.visible = false;
            }
        }
    }
    renderer.render(scene, camera);
}