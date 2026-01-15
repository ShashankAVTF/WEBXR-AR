import * as THREE from 'three';
import {
    ARButton
} from 'three/addons/webxr/ARButton.js';
import {
    GLTFLoader
} from 'three/addons/loaders/GLTFLoader.js';

// --- GLOBAL VARIABLES ---
let container;
let camera, scene, renderer;
let controller;
let reticle;

// WebXR Hit Sources
let hitTestSource = null;
let hitTestSourceRequested = false;
let transientHitTestSource = null; // For Dragging

// Model & Logic
let currentModel = null;
let loadedGLTF = null;

// Reuse this vector to prevent memory crashes during math
const workingVec = new THREE.Vector3();

// Get Model Name from URL
const urlParams = new URLSearchParams(window.location.search);
const modelName = urlParams.get('model') || 'POT1';

// --- GESTURE VARIABLES ---
let isDragging = false;
let isTwoFinger = false;

// For Scaling (Pinch)
let initialDistance = 0;
let initialScale = new THREE.Vector3();

// For Rotation (Twist)
let initialAngle = 0;
let initialModelRotation = 0;


init();
animate();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // --- LIGHTING ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 3);
    dirLight.position.set(1, 10, 1);
    dirLight.castShadow = true;

    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;

    // SHADOW BOX SIZE (Crucial for visibility)
    const d = 10;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;

    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.blurSamples= 25; //high means smooth
    dirLight.shadow.radius = 1; //high means smooth

    scene.add(dirLight);

    // --- RENDERER ---
    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;

    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    // --- PLATFORM CHECK ---
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
        setupIOSFallback();
    } else {
        setupWebXR();
    }

    window.addEventListener('resize', onWindowResize);
}

// --- ANDROID / WEBXR SETUP ---
function setupWebXR() {
    document.body.appendChild(ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: {
            root: document.body
        }
    }));

    // Load Model
    const loader = new GLTFLoader();
    const glbPath = `./models/${modelName}.glb`;

    loader.load(glbPath, function (gltf) {
        loadedGLTF = gltf.scene;

        // Shadow Setup
        loadedGLTF.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = false;
            }
        });

        // Shadow Plane
        const shadowGeo = new THREE.PlaneGeometry(10, 10);
        const shadowMat = new THREE.ShadowMaterial({
            opacity: 0.1,
            color: 0x000000
        });

        const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        shadowMesh.rotation.x = -Math.PI / 2;
        shadowMesh.receiveShadow = true;
        shadowMesh.position.y = 0.0; // Tiny offset

        loadedGLTF.add(shadowMesh);

        console.log(`Loaded: ${glbPath}`);
    }, undefined, function (error) {
        console.error("Error loading GLB:", error);
    });

    // Reticle
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Controller
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    initTouchControls();
}

// --- IOS SETUP ---
function setupIOSFallback() {
    const button = document.createElement('a');
    button.href = `./models/${modelName}.usdz`;
    button.rel = "ar";

    Object.assign(button.style, {
        position: 'absolute',
        bottom: '50px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '15px 30px',
        backgroundColor: 'white',
        color: 'black',
        border: 'none',
        borderRadius: '30px',
        fontFamily: 'sans-serif',
        fontWeight: 'bold',
        textDecoration: 'none',
        boxShadow: '0px 4px 10px rgba(0,0,0,0.3)'
    });
    button.textContent = "📦 View in AR";
    document.body.appendChild(button);
}

// --- INTERACTION LOGIC ---

function onSelect() {
    if (isDragging) return;

    // Only allow placement if the reticle is actually visible
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

// --- NEW HELPER FUNCTION: RETICLE DISTANCE CHECK ---
function shouldShowReticle(reticleMatrix) {
    // If no model exists yet, always show reticle
    if (!currentModel) return true;

    // Calculate distance between Reticle and Model
    workingVec.setFromMatrixPosition(reticleMatrix);
    const distance = workingVec.distanceTo(currentModel.position);

    // If distance is less than 0.6 meters (60cm), hide reticle
    return distance > 0.6;
}

// --- GESTURES ---
function initTouchControls() {
    window.addEventListener('touchstart', (e) => {
        if (!currentModel) return;

        if (e.touches.length === 1) {
            isDragging = true;
            isTwoFinger = false;
        } else if (e.touches.length === 2) {
            isDragging = false;
            isTwoFinger = true;

            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;

            initialDistance = Math.sqrt(dx * dx + dy * dy);
            initialScale.copy(currentModel.scale);

            initialAngle = Math.atan2(dy, dx);
            initialModelRotation = currentModel.rotation.y;
        }
    }, {
        passive: false
    });

    window.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!currentModel) return;

        if (e.touches.length === 2 && isTwoFinger) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;

            // Scale
            const currentDistance = Math.sqrt(dx * dx + dy * dy);
            const scaleFactor = currentDistance / initialDistance;
            const newScale = Math.max(0.1, Math.min(initialScale.x * scaleFactor, 5.0));
            currentModel.scale.set(newScale, newScale, newScale);

            // Rotate
            const currentAngle = Math.atan2(dy, dx);
            const angleDiff = currentAngle - initialAngle;
            currentModel.rotation.y = initialModelRotation - angleDiff;
        }
    }, {
        passive: false
    });

    window.addEventListener('touchend', () => {
        setTimeout(() => {
            isDragging = false;
            isTwoFinger = false;
        }, 100);
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

// --- RENDER LOOP ---
function render(timestamp, frame) {
    if (frame && renderer.xr.isPresenting) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then((refSpace) => {
                session.requestHitTestSource({
                    space: refSpace
                }).then((source) => {
                    hitTestSource = source;
                });
                session.requestHitTestSourceForTransientInput({
                    profile: 'generic-touchscreen'
                }).then((source) => {
                    transientHitTestSource = source;
                });
            });
            session.addEventListener('end', () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
                transientHitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        // --- RETICLE LOGIC ---
        if (hitTestSource) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];

                // Update Reticle Position First
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);

                // CHECK DISTANCE: Only show if far enough away from model
                if (shouldShowReticle(reticle.matrix)) {
                    reticle.visible = true;
                } else {
                    reticle.visible = false;
                }

            } else {
                reticle.visible = false;
            }
        }

        // --- DRAG LOGIC ---
        if (transientHitTestSource && isDragging && !isTwoFinger && currentModel) {
            const hitTestResults = frame.getHitTestResultsForTransientInput(transientHitTestSource);
            if (hitTestResults.length > 0 && hitTestResults[0].results.length > 0) {
                const hit = hitTestResults[0].results[0];
                const hitPose = hit.getPose(referenceSpace);

                currentModel.position.setFromMatrixPosition(
                    new THREE.Matrix4().fromArray(hitPose.transform.matrix)
                );
            }
        }
    }
    renderer.render(scene, camera);
}