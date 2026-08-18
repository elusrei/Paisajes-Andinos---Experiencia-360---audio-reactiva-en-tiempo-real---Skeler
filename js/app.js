/**
 * ==========================================================================
 * DOME 360° MASTER VIEWER - CONTROLADOR THREE.JS & REPRODUCTOR ADAPTATIVO
 * CON MONITOR EN VIVO Y 4 TÉCNICAS INTERCAMBIABLES DE SENSORES DE MOVIMIENTO
 * ==========================================================================
 */

const DEFAULT_SEGMENTS = [
    { file: "segments/segment_00.mp4", start: 0.0, duration: 33.357, end: 33.357 },
    { file: "segments/segment_01.mp4", start: 33.357, duration: 28.700, end: 62.057 },
    { file: "segments/segment_02.mp4", start: 62.057, duration: 22.667, end: 84.723 },
    { file: "segments/segment_03.mp4", start: 84.723, duration: 29.100, end: 113.823 },
    { file: "segments/segment_04.mp4", start: 113.823, duration: 29.400, end: 143.223 },
    { file: "segments/segment_05.mp4", start: 143.223, duration: 28.867, end: 172.090 },
    { file: "segments/segment_06.mp4", start: 172.090, duration: 24.033, end: 196.123 },
    { file: "segments/segment_07.mp4", start: 196.123, duration: 22.133, end: 218.257 }
];

const DEFAULT_SEGMENTS_MOBILE = [
    { file: "segments_mobile/segment_00.mp4", start: 0.0, duration: 33.357, end: 33.357 },
    { file: "segments_mobile/segment_01.mp4", start: 33.357, duration: 28.700, end: 62.057 },
    { file: "segments_mobile/segment_02.mp4", start: 62.057, duration: 22.667, end: 84.723 },
    { file: "segments_mobile/segment_03.mp4", start: 84.723, duration: 29.100, end: 113.823 },
    { file: "segments_mobile/segment_04.mp4", start: 113.823, duration: 29.400, end: 143.223 },
    { file: "segments_mobile/segment_05.mp4", start: 143.223, duration: 28.867, end: 172.090 },
    { file: "segments_mobile/segment_06.mp4", start: 172.090, duration: 24.033, end: 196.123 },
    { file: "segments_mobile/segment_07.mp4", start: 196.123, duration: 22.133, end: 218.257 }
];

const READY_STATE_MAP = [
    '0: HAVE_NOTHING',
    '1: HAVE_METADATA',
    '2: HAVE_CURRENT_DATA',
    '3: HAVE_FUTURE_DATA',
    '4: HAVE_ENOUGH_DATA'
];

class DomeViewer {
    constructor() {
        // Detección Mobile
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window) || (window.innerWidth <= 768);

        // Elementos DOM
        this.container = document.getElementById('canvas-container');
        this.videoA = document.getElementById('dome-video-a');
        this.videoB = document.getElementById('dome-video-b');
        this.uiLayer = document.getElementById('ui-layer');
        this.fileInput = document.getElementById('file-input');
        this.dataWarningModal = document.getElementById('data-warning-modal');
        this.splashScreen = document.getElementById('splash-screen');
        this.orientationPrompt = document.getElementById('orientation-prompt');
        this.dropzone = document.getElementById('dropzone');
        this.toastContainer = document.getElementById('toast-container');
        this.bufferingSpinner = document.getElementById('buffering-spinner');
        this.bufferingText = document.getElementById('buffering-text');
        this.debugPanel = document.getElementById('debug-panel');
        this.sensorDebugOverlay = document.getElementById('sensor-debug-overlay');
        this.markerOrigin = document.getElementById('marker-origin');
        this.markerCurrent = document.getElementById('marker-current');

        // Estado Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.domeMesh = null;
        this.domeMaterial = null;
        this.textureA = null;
        this.textureB = null;
        this.activeTexture = null;

        // Estado del Motor de Segmentos
        this.isSegmentedMode = true;
        this.segments = this.isMobile ? [...DEFAULT_SEGMENTS_MOBILE] : [...DEFAULT_SEGMENTS];
        this.currentSegmentIndex = 0;
        this.activeVideo = this.videoA;
        this.standbyVideo = this.videoB;
        this.totalDuration = this.segments[this.segments.length - 1].end;
        this.isTransitioning = false;
        this.engineInitialized = false;

        // Posición Inicial
        this.defaultYaw = 45;
        this.defaultPitch = 50;
        this.defaultFov = 95;

        this.yaw = this.defaultYaw;
        this.pitch = this.defaultPitch;
        this.fov = this.defaultFov;
        this.targetYaw = this.defaultYaw;
        this.targetPitch = this.defaultPitch;
        this.targetFov = this.defaultFov;

        this.isDragging = false;
        this.touchMoved = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.touchStartDist = 0;
        this.damping = 0.08;

        // ====================================================================
        // MOTOR DE SENSORES CON 4 TÉCNICAS INTERCAMBIABLES
        // ====================================================================
        this.gyroActive = false;
        this.activeSensorTech = 1; // 1: Sensor API, 2: DeviceOrientation, 3: Accelerometer G, 4: Compass/Gravity
        this.sensorTicks = 0;
        this.sensorTicksPerSec = 0;
        this.lastSensorTickTime = performance.now();

        // Datos en vivo para diagnóstico en pantalla
        this.liveSensorData = {
            alpha: null,
            beta: null,
            gamma: null,
            gx: 0, gy: 0, gz: 0
        };

        this.gyroSensor = null;
        this.gyroInitialOrientation = null;
        this.gyroStartCamera = null;

        // Teclado & Mouse
        this.keys = {};
        this.mouseTimeout = null;

        // Estado de Reproducción
        this.isPlaying = false;
        this.isScrubbing = false;
        this.playbackSpeeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        this.speedIndex = 2; // 1.0x

        // Calibración y Shader
        this.config = {
            domeFov: 180,
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            rotation: 0,
            flipX: false,
            flipY: false,
            exposure: 1.0,
            projectionMode: 0,
            hemisphereOnly: false
        };

        // Diagnóstico / Debug
        this.debugLogs = [];
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.currentFps = 60;
        this.pipActive = false;

        // Inicializar componentes
        this.initThree();
        this.initEvents();
        this.initUI();
        this.initDebug();
        this.initSensorDebugUI();
        this.initGatekeeper();
        this.initMobileOrientationCheck();
        this.animate();

        this.logDebug(`Visor 360 listo (${this.isMobile ? 'Stream Mobile 2K' : 'Stream Desktop 4K'})`, 'success');
    }

    /* --------------------------------------------------------------------------
       PUERTA DE ENTRADA Y AHORRO DE DATOS
       -------------------------------------------------------------------------- */
    initGatekeeper() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const isCellular = conn && (conn.type === 'cellular' || conn.saveData === true || ['2g', '3g', '4g'].includes(conn.effectiveType));

        const btnDataContinue = document.getElementById('btn-data-continue');
        if (btnDataContinue) {
            btnDataContinue.addEventListener('click', () => {
                if (this.dataWarningModal) this.dataWarningModal.classList.add('hidden');
                if (this.splashScreen) this.splashScreen.classList.remove('hidden');
                this.loadManifestOnly();
            });
        }

        if (isCellular) {
            if (this.dataWarningModal) this.dataWarningModal.classList.remove('hidden');
            if (this.splashScreen) this.splashScreen.classList.add('hidden');
        } else {
            if (this.dataWarningModal) this.dataWarningModal.classList.add('hidden');
            if (this.splashScreen) this.splashScreen.classList.remove('hidden');
            this.loadManifestOnly();
        }
    }

    loadManifestOnly() {
        if (this.manifestLoaded) return;
        this.manifestLoaded = true;

        const manifestUrl = this.isMobile ? 'segments_mobile/manifest.json' : 'segments/manifest.json';
        this.logDebug(`Cargando stream: ${this.isMobile ? 'Mobile 2K' : 'Desktop 4K'}`, 'info');

        fetch(manifestUrl)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data) && data.length > 0) {
                    this.segments = data.map(item => ({
                        ...item,
                        file: item.file.replace(/\\/g, '/')
                    }));
                    this.totalDuration = this.segments[this.segments.length - 1].end;
                    this.updateTotalDuration();
                    this.logDebug(`Manifest listo: ${this.segments.length} segmentos`, 'info');
                }
            })
            .catch(() => {
                this.logDebug(`Uso de manifest local`, 'info');
            });
    }

    /* --------------------------------------------------------------------------
       INICIALIZACIÓN THREE.JS
       -------------------------------------------------------------------------- */
    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x04060a);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.1, 2000);
        this.camera.position.set(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            antialias: !this.isMobile,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        const maxDpr = this.isMobile ? 1.25 : 2.0;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        if (window.location.protocol.startsWith('http')) {
            this.videoA.crossOrigin = 'anonymous';
            this.videoB.crossOrigin = 'anonymous';
        }

        this.textureA = new THREE.VideoTexture(this.videoA);
        this.textureA.minFilter = THREE.LinearFilter;
        this.textureA.magFilter = THREE.LinearFilter;
        this.textureA.wrapS = THREE.ClampToEdgeWrapping;
        this.textureA.wrapT = THREE.ClampToEdgeWrapping;
        this.textureA.format = THREE.RGBAFormat;
        this.textureA.generateMipmaps = false;

        this.textureB = new THREE.VideoTexture(this.videoB);
        this.textureB.minFilter = THREE.LinearFilter;
        this.textureB.magFilter = THREE.LinearFilter;
        this.textureB.wrapS = THREE.ClampToEdgeWrapping;
        this.textureB.wrapT = THREE.ClampToEdgeWrapping;
        this.textureB.format = THREE.RGBAFormat;
        this.textureB.generateMipmaps = false;

        this.activeTexture = this.textureA;

        const uniforms = THREE.UniformsUtils.clone(DomeShader.uniforms);
        if (uniforms.tVideo) uniforms.tVideo.value = this.activeTexture;
        if (uniforms.uAspect) uniforms.uAspect.value = 1.0;
        if (uniforms.uDomeFov) uniforms.uDomeFov.value = (this.config.domeFov * Math.PI) / 180;
        if (uniforms.uScale) uniforms.uScale.value = this.config.scale;
        if (uniforms.uOffsetX) uniforms.uOffsetX.value = this.config.offsetX;
        if (uniforms.uOffsetY) uniforms.uOffsetY.value = this.config.offsetY;
        if (uniforms.uRotation) uniforms.uRotation.value = (this.config.rotation * Math.PI) / 180;
        if (uniforms.uFlipX) uniforms.uFlipX.value = this.config.flipX;
        if (uniforms.uFlipY) uniforms.uFlipY.value = this.config.flipY;
        if (uniforms.uProjectionMode) uniforms.uProjectionMode.value = this.config.projectionMode;
        if (uniforms.uExposure) uniforms.uExposure.value = this.config.exposure;
        if (uniforms.uHemisphereOnly) uniforms.uHemisphereOnly.value = this.config.hemisphereOnly ? 1.0 : 0.0;

        this.domeMaterial = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: DomeShader.vertexShader,
            fragmentShader: DomeShader.fragmentShader,
            side: THREE.BackSide,
            transparent: false,
            depthWrite: false,
            depthTest: false
        });

        const segmentsCount = this.isMobile ? 48 : 96;
        const domeGeometry = new THREE.SphereGeometry(600, segmentsCount, segmentsCount);
        this.domeMesh = new THREE.Mesh(domeGeometry, this.domeMaterial);
        this.scene.add(this.domeMesh);
    }

    /* --------------------------------------------------------------------------
       DETECCIÓN DE ROTACIÓN EN MOBILE
       -------------------------------------------------------------------------- */
    initMobileOrientationCheck() {
        if (!this.isMobile) return;

        const checkOrient = () => {
            const isPortrait = window.innerHeight > window.innerWidth;
            if (this.orientationPrompt) {
                if (isPortrait && !this.orientationDismissed) {
                    this.orientationPrompt.classList.remove('hidden');
                } else {
                    this.orientationPrompt.classList.add('hidden');
                }
            }
        };

        window.addEventListener('resize', checkOrient);
        window.addEventListener('orientationchange', () => setTimeout(checkOrient, 200));

        const btnDismiss = document.getElementById('btn-dismiss-orient');
        if (btnDismiss) {
            btnDismiss.addEventListener('click', () => {
                this.orientationDismissed = true;
                if (this.orientationPrompt) this.orientationPrompt.classList.add('hidden');
            });
        }

        checkOrient();
    }

    /* --------------------------------------------------------------------------
       SISTEMA MULTI-TÉCNICA DE SENSORES DE MOVIMIENTO (1, 2, 3, 4)
       -------------------------------------------------------------------------- */
    setSensorTechnique(techId) {
        this.activeSensorTech = techId;
        this.gyroInitialOrientation = null;
        this.gyroStartCamera = null;

        // Actualizar UI de botones de técnicas
        for (let i = 1; i <= 4; i++) {
            const btn = document.getElementById(`btn-tech-${i}`);
            if (btn) btn.classList.toggle('active', i === techId);
        }

        const names = [
            'T1: Generic Sensor API (Quaternions)',
            'T2: DeviceOrientation (Alpha/Beta/Gamma)',
            'T3: Pure Accelerometer Gravity (G-Vector)',
            'T4: Compass Heading + Gyro Fusion'
        ];
        const techNameEl = document.getElementById('live-tech-name');
        if (techNameEl) techNameEl.textContent = names[techId - 1];

        this.logDebug(`Cambiando a técnica de sensor: ${names[techId - 1]}`, 'info');
        this.showToast(`Activada ${names[techId - 1]}`, 2500);

        if (this.gyroActive) {
            this.stopAllSensors();
            this.startActiveTechnique();
        }
    }

    toggleGyro() {
        if (this.gyroActive) {
            this.stopAllSensors();
            this.showToast('Sensores desactivados');
            return;
        }

        this.gyroActive = true;
        const btnGyro = document.getElementById('btn-gyro');
        if (btnGyro) btnGyro.classList.add('active');
        const dbgGyro = document.getElementById('dbg-gyro');
        if (dbgGyro) dbgGyro.textContent = `Activo (T${this.activeSensorTech})`;

        this.startActiveTechnique();
    }

    startActiveTechnique() {
        this.gyroInitialOrientation = null;
        this.gyroStartCamera = null;

        if (this.activeSensorTech === 1) {
            // T1: Generic Sensor API
            this.startSensorAPI();
        } else if (this.activeSensorTech === 2) {
            // T2: DeviceOrientation
            this.startDeviceOrientation();
        } else if (this.activeSensorTech === 3) {
            // T3: Accelerometer G
            this.startDeviceMotion();
        } else if (this.activeSensorTech === 4) {
            // T4: Compass / Gravity
            this.startCompassAndMotion();
        }
    }

    stopAllSensors() {
        this.gyroActive = false;
        if (this.gyroSensor) {
            try { this.gyroSensor.stop(); } catch(e) {}
            this.gyroSensor = null;
        }
        if (this.handleDeviceOrientation) {
            window.removeEventListener('deviceorientationabsolute', this.handleDeviceOrientation);
            window.removeEventListener('deviceorientation', this.handleDeviceOrientation);
        }
        if (this.handleDeviceMotion) {
            window.removeEventListener('devicemotion', this.handleDeviceMotion);
        }
        const btnGyro = document.getElementById('btn-gyro');
        if (btnGyro) btnGyro.classList.remove('active');
        const dbgGyro = document.getElementById('dbg-gyro');
        if (dbgGyro) dbgGyro.textContent = 'Inactivo';
    }

    // TÉCNICA 1: Generic Sensor API
    startSensorAPI() {
        if ('RelativeOrientationSensor' in window || 'AbsoluteOrientationSensor' in window) {
            try {
                const SensorClass = window.RelativeOrientationSensor || window.AbsoluteOrientationSensor;
                this.gyroSensor = new SensorClass({ frequency: 60 });
                this.gyroSensor.addEventListener('reading', () => {
                    this.onSensorTick();
                    const q = this.gyroSensor.quaternion;
                    if (!q) return;

                    const qObj = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
                    const euler = new THREE.Euler().setFromQuaternion(qObj, 'YXZ');

                    const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
                    const yawDeg = THREE.MathUtils.radToDeg(euler.y);
                    const rollDeg = THREE.MathUtils.radToDeg(euler.z);

                    this.liveSensorData.beta = pitchDeg.toFixed(1);
                    this.liveSensorData.alpha = yawDeg.toFixed(1);
                    this.liveSensorData.gamma = rollDeg.toFixed(1);

                    if (this.gyroInitialOrientation === null) {
                        this.gyroInitialOrientation = { pitch: pitchDeg, yaw: yawDeg };
                        this.gyroStartCamera = { pitch: this.pitch, yaw: this.yaw };
                    }

                    const deltaPitch = pitchDeg - this.gyroInitialOrientation.pitch;
                    const deltaYaw = yawDeg - this.gyroInitialOrientation.yaw;

                    this.targetPitch = Math.max(-89.9, Math.min(89.9, this.gyroStartCamera.pitch - deltaPitch));
                    this.targetYaw = this.gyroStartCamera.yaw - deltaYaw;
                });
                this.gyroSensor.addEventListener('error', (err) => {
                    this.logDebug(`Error Sensor API: ${err.error.name}. Cambiando a T2...`, 'warn');
                    this.setSensorTechnique(2);
                });
                this.gyroSensor.start();
                this.showToast('T1 (Sensor API 60Hz) Activo 📱');
            } catch(e) {
                this.setSensorTechnique(2);
            }
        } else {
            this.setSensorTechnique(2);
        }
    }

    // TÉCNICA 2: DeviceOrientation Event
    startDeviceOrientation() {
        this.handleDeviceOrientation = (e) => {
            this.onSensorTick();
            this.liveSensorData.alpha = e.alpha !== null ? e.alpha.toFixed(1) : 'null';
            this.liveSensorData.beta = e.beta !== null ? e.beta.toFixed(1) : 'null';
            this.liveSensorData.gamma = e.gamma !== null ? e.gamma.toFixed(1) : 'null';

            if (e.beta === null && e.gamma === null && e.alpha === null) return;

            const screenOrient = (window.screen && window.screen.orientation && window.screen.orientation.angle !== undefined)
                ? window.screen.orientation.angle
                : (window.orientation || 0);

            let pitchVal = e.beta || 0;
            let yawVal = (e.alpha !== null ? e.alpha : e.webkitCompassHeading) || 0;

            if (screenOrient === 90) {
                pitchVal = -(e.gamma || 0);
                yawVal = (e.alpha || 0) + 90;
            } else if (screenOrient === -90 || screenOrient === 270) {
                pitchVal = (e.gamma || 0);
                yawVal = (e.alpha || 0) - 90;
            }

            if (this.gyroInitialOrientation === null) {
                this.gyroInitialOrientation = { pitch: pitchVal, yaw: yawVal };
                this.gyroStartCamera = { pitch: this.pitch, yaw: this.yaw };
            }

            const deltaPitch = pitchVal - this.gyroInitialOrientation.pitch;
            const deltaYaw = yawVal - this.gyroInitialOrientation.yaw;

            this.targetPitch = Math.max(-89.9, Math.min(89.9, this.gyroStartCamera.pitch - deltaPitch));
            this.targetYaw = this.gyroStartCamera.yaw + deltaYaw;
        };

        window.addEventListener('deviceorientationabsolute', this.handleDeviceOrientation);
        window.addEventListener('deviceorientation', this.handleDeviceOrientation);
        this.showToast('T2 (DeviceOrientation) Activo 📱');
    }

    // TÉCNICA 3: Pure Accelerometer Gravity
    startDeviceMotion() {
        this.handleDeviceMotion = (e) => {
            this.onSensorTick();
            const ag = e.accelerationIncludingGravity;
            if (!ag) return;

            const gx = ag.x || 0;
            const gy = ag.y || 0;
            const gz = ag.z || 0;

            this.liveSensorData.gx = gx.toFixed(2);
            this.liveSensorData.gy = gy.toFixed(2);
            this.liveSensorData.gz = gz.toFixed(2);

            const pitchRad = Math.atan2(gy, Math.sqrt(gx * gx + gz * gz));
            const rollRad = Math.atan2(gx, gz);

            const pitchDeg = pitchRad * (180 / Math.PI);
            const rollDeg = rollRad * (180 / Math.PI);

            this.liveSensorData.beta = pitchDeg.toFixed(1);
            this.liveSensorData.gamma = rollDeg.toFixed(1);

            if (this.gyroInitialOrientation === null) {
                this.gyroInitialOrientation = { pitch: pitchDeg, roll: rollDeg };
                this.gyroStartCamera = { pitch: this.pitch, yaw: this.yaw };
            }

            const deltaPitch = pitchDeg - this.gyroInitialOrientation.pitch;
            const deltaRoll = rollDeg - this.gyroInitialOrientation.roll;

            this.targetPitch = Math.max(-89.9, Math.min(89.9, this.gyroStartCamera.pitch + deltaPitch * 1.4));
            this.targetYaw = this.gyroStartCamera.yaw - deltaRoll * 1.4;
        };

        window.addEventListener('devicemotion', this.handleDeviceMotion);
        this.showToast('T3 (Acelerómetro por Gravedad) Activo 📱');
    }

    // TÉCNICA 4: Compass Heading + Accelerometer Pitch
    startCompassAndMotion() {
        this.handleDeviceMotion = (e) => {
            this.onSensorTick();
            const ag = e.accelerationIncludingGravity;
            if (!ag) return;
            const gx = ag.x || 0, gy = ag.y || 0, gz = ag.z || 0;
            this.liveSensorData.gx = gx.toFixed(2);
            this.liveSensorData.gy = gy.toFixed(2);
            this.liveSensorData.gz = gz.toFixed(2);

            const pitchDeg = Math.atan2(gy, Math.sqrt(gx * gx + gz * gz)) * (180 / Math.PI);
            this.liveSensorData.beta = pitchDeg.toFixed(1);

            if (this.gyroInitialOrientation === null) {
                this.gyroInitialOrientation = { pitch: pitchDeg, compass: this.yaw };
                this.gyroStartCamera = { pitch: this.pitch, yaw: this.yaw };
            }

            const deltaPitch = pitchDeg - this.gyroInitialOrientation.pitch;
            this.targetPitch = Math.max(-89.9, Math.min(89.9, this.gyroStartCamera.pitch + deltaPitch * 1.3));
        };

        this.handleDeviceOrientation = (e) => {
            const compass = (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) 
                ? e.webkitCompassHeading 
                : (e.alpha || 0);

            this.liveSensorData.alpha = compass.toFixed(1);

            if (this.gyroInitialOrientation && this.gyroInitialOrientation.compassInit === undefined) {
                this.gyroInitialOrientation.compassInit = compass;
            }

            if (this.gyroInitialOrientation && this.gyroInitialOrientation.compassInit !== undefined) {
                const deltaYaw = compass - this.gyroInitialOrientation.compassInit;
                this.targetYaw = this.gyroStartCamera.yaw - deltaYaw;
            }
        };

        window.addEventListener('devicemotion', this.handleDeviceMotion);
        window.addEventListener('deviceorientation', this.handleDeviceOrientation);
        this.showToast('T4 (Brújula + Gravedad) Activo 📱');
    }

    onSensorTick() {
        this.sensorTicks++;
        const now = performance.now();
        if (now - this.lastSensorTickTime >= 1000) {
            this.sensorTicksPerSec = this.sensorTicks;
            this.sensorTicks = 0;
            this.lastSensorTickTime = now;
            this.updateSensorDebugHUD();
        }
    }

    /* --------------------------------------------------------------------------
       PANEL DE DIAGNÓSTICO EN VIVO DE SENSORES (UI)
       -------------------------------------------------------------------------- */
    initSensorDebugUI() {
        const btnOpen = document.getElementById('btn-open-sensor-dbg');
        const btnClose = document.getElementById('btn-close-sensor-dbg');
        const overlay = document.getElementById('sensor-debug-overlay');

        if (btnOpen) {
            btnOpen.addEventListener('click', (e) => {
                e.stopPropagation();
                if (overlay) overlay.classList.remove('hidden');
                if (!this.gyroActive) this.toggleGyro();
            });
        }

        if (btnClose) {
            btnClose.addEventListener('click', () => {
                if (overlay) overlay.classList.add('hidden');
            });
        }

        // Botones de las 4 técnicas
        for (let i = 1; i <= 4; i++) {
            const btn = document.getElementById(`btn-tech-${i}`);
            if (btn) {
                btn.addEventListener('click', () => this.setSensorTechnique(i));
            }
        }

        const btnCycle = document.getElementById('btn-cycle-tech');
        if (btnCycle) {
            btnCycle.addEventListener('click', () => {
                const nextTech = (this.activeSensorTech % 4) + 1;
                this.setSensorTechnique(nextTech);
            });
        }

        const btnReqPerm = document.getElementById('btn-req-sensor-perm');
        if (btnReqPerm) {
            btnReqPerm.addEventListener('click', () => {
                if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    DeviceOrientationEvent.requestPermission().then(st => this.showToast(`Permiso iOS: ${st}`));
                } else if ('permissions' in navigator && navigator.permissions.query) {
                    navigator.permissions.query({ name: 'accelerometer' }).then(r => this.showToast(`Acelerómetro: ${r.state}`)).catch(() => {});
                    navigator.permissions.query({ name: 'gyroscope' }).then(r => this.showToast(`Giroscopio: ${r.state}`)).catch(() => {});
                } else {
                    this.showToast('Permisos estándar listos');
                }
            });
        }
    }

    updateSensorDebugHUD() {
        if (!this.sensorDebugOverlay || this.sensorDebugOverlay.classList.contains('hidden')) return;

        const elHz = document.getElementById('live-events-sec');
        if (elHz) elHz.textContent = `${this.sensorTicksPerSec} Hz`;

        const elAlpha = document.getElementById('live-alpha');
        if (elAlpha) elAlpha.textContent = this.liveSensorData.alpha !== null ? `${this.liveSensorData.alpha}°` : '--';

        const elBeta = document.getElementById('live-beta');
        if (elBeta) elBeta.textContent = this.liveSensorData.beta !== null ? `${this.liveSensorData.beta}°` : '--';

        const elGamma = document.getElementById('live-gamma');
        if (elGamma) elGamma.textContent = this.liveSensorData.gamma !== null ? `${this.liveSensorData.gamma}°` : '--';

        const elGrav = document.getElementById('live-gravity');
        if (elGrav) elGrav.textContent = `[${this.liveSensorData.gx}, ${this.liveSensorData.gy}, ${this.liveSensorData.gz}]`;

        const elCam = document.getElementById('live-camera');
        if (elCam) elCam.textContent = `P: ${this.pitch.toFixed(1)}°, Y: ${this.yaw.toFixed(1)}°`;
    }

    /* --------------------------------------------------------------------------
       ENTRADA A LA EXPERIENCIA Y REPRODUCCIÓN CONTINUA
       -------------------------------------------------------------------------- */
    enterExperience() {
        if (this.splashScreen) {
            this.splashScreen.classList.add('hidden');
            setTimeout(() => {
                this.splashScreen.style.display = 'none';
            }, 700);
        }

        this.showBuffering('Iniciando...');
        this.primeAndStartPlayback();
    }

    primeAndStartPlayback() {
        if (!this.engineInitialized) {
            this.engineInitialized = true;
            this.setupVideoEvents(this.videoA, 'Video A');
            this.setupVideoEvents(this.videoB, 'Video B');
        }

        this.currentSegmentIndex = 0;
        this.activeVideo = this.videoA;
        this.standbyVideo = this.videoB;
        this.activeTexture = this.textureA;
        this.domeMaterial.uniforms.tVideo.value = this.activeTexture;

        this.videoA.src = this.segments[0].file;
        this.videoA.preload = "auto";
        this.videoA.load();

        this.isPlaying = true;
        this.setPlayState(true);

        const playA = this.videoA.play();
        if (playA !== undefined) {
            playA.then(() => {
                this.setPlayState(true);
                this.hideBuffering();

                if (this.segments.length > 1) {
                    this.standbyVideo.src = this.segments[1].file;
                    this.standbyVideo.preload = "auto";
                    this.standbyVideo.load();
                }
            }).catch(() => {
                this.videoA.muted = true;
                this.videoB.muted = true;
                this.videoA.play().then(() => {
                    this.setPlayState(true);
                    this.hideBuffering();
                    this.updateVolumeIcons();
                    this.showToast('Audio en silencio. Tocá el parlante para activar.', 4000);
                }).catch(() => {
                    this.setPlayState(false);
                    this.hideBuffering();
                });
            });
        }
    }

    setupVideoEvents(videoEl, name) {
        videoEl.addEventListener('loadedmetadata', () => {
            if (videoEl === this.activeVideo) {
                this.updateTotalDuration();
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('loadeddata', () => {
            if (videoEl === this.activeVideo) {
                if (this.activeTexture) this.activeTexture.needsUpdate = true;
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('timeupdate', () => {
            if (videoEl === this.activeVideo) {
                if (this.bufferingSpinner && !this.bufferingSpinner.classList.contains('hidden')) {
                    this.hideBuffering();
                }
                if (!this.isScrubbing) {
                    this.onActiveTimeUpdate();
                }
            }
        });

        videoEl.addEventListener('ended', () => {
            if (videoEl === this.activeVideo) {
                this.transitionToNextSegment();
            }
        });

        videoEl.addEventListener('play', () => {
            if (videoEl === this.activeVideo) {
                this.setPlayState(true);
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('playing', () => {
            if (videoEl === this.activeVideo) {
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('waiting', () => {
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.showBuffering('Cargando...');
            }
        });

        videoEl.addEventListener('canplay', () => {
            if (videoEl === this.activeVideo) {
                this.hideBuffering();
            }
        });
    }

    onActiveTimeUpdate() {
        const seg = this.segments[this.currentSegmentIndex];
        if (!seg) return;

        const globalTime = seg.start + this.activeVideo.currentTime;
        this.updateTimelineWithTime(globalTime);

        // Precargar siguiente segmento en standby
        const nextIndex = (this.currentSegmentIndex + 1) % this.segments.length;
        if (!this.standbyVideo.src || this.standbyVideo.src.indexOf(this.segments[nextIndex].file) === -1) {
            this.standbyVideo.src = this.segments[nextIndex].file;
            this.standbyVideo.preload = "auto";
            this.standbyVideo.load();
        }

        // Transición anticipada
        const remaining = seg.duration - this.activeVideo.currentTime;
        if (remaining <= 0.08 && remaining > 0 && !this.isTransitioning) {
            this.transitionToNextSegment();
        }
    }

    transitionToNextSegment() {
        if (!this.isSegmentedMode) {
            this.setPlayState(false);
            return;
        }

        const nextIndex = (this.currentSegmentIndex + 1) % this.segments.length;
        this.isTransitioning = true;

        const nextActive = this.standbyVideo;
        const nextStandby = this.activeVideo;
        const nextTexture = (nextActive === this.videoA) ? this.textureA : this.textureB;

        this.currentSegmentIndex = nextIndex;
        this.activeVideo = nextActive;
        this.standbyVideo = nextStandby;
        this.activeTexture = nextTexture;

        this.domeMaterial.uniforms.tVideo.value = this.activeTexture;

        this.activeVideo.volume = this.standbyVideo.volume;
        this.activeVideo.muted = this.standbyVideo.muted;
        this.activeVideo.playbackRate = this.playbackSpeeds[this.speedIndex];

        if (this.isPlaying) {
            const playProm = this.activeVideo.play();
            if (playProm !== undefined) {
                playProm.then(() => {
                    this.setPlayState(true);
                    this.hideBuffering();
                }).catch(() => {
                    this.activeVideo.play().catch(() => {});
                });
            }
        }

        const futureIndex = (nextIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[futureIndex].file;
        this.standbyVideo.preload = "auto";
        this.standbyVideo.load();

        if (this.pipActive) this.updatePipPreview();

        setTimeout(() => {
            this.isTransitioning = false;
        }, 200);
    }

    seekGlobalTime(targetTime) {
        targetTime = Math.max(0, Math.min(this.totalDuration, targetTime));

        let targetIndex = 0;
        for (let i = 0; i < this.segments.length; i++) {
            if (targetTime >= this.segments[i].start && targetTime < this.segments[i].end) {
                targetIndex = i;
                break;
            }
        }
        if (targetTime >= this.segments[this.segments.length - 1].end) {
            targetIndex = this.segments.length - 1;
        }

        const targetSeg = this.segments[targetIndex];
        const offsetInSegment = targetTime - targetSeg.start;

        this.showBuffering('Buscando...');
        this.currentSegmentIndex = targetIndex;
        this.activeVideo.src = targetSeg.file;
        this.activeVideo.currentTime = offsetInSegment;

        if (this.isPlaying) {
            this.activeVideo.play().catch(() => {});
        }

        const nextIndex = (targetIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[nextIndex].file;
        this.standbyVideo.load();

        this.updateTimelineWithTime(targetTime);
    }

    stopVideo() {
        this.pauseVideo();
        this.seekGlobalTime(0);
        this.showToast('Detenido (0:00)');
    }

    /* --------------------------------------------------------------------------
       CONSTRUCCIÓN Y EVENTOS DE INTERFAZ (UI)
       -------------------------------------------------------------------------- */
    initUI() {
        const btnEnter = document.getElementById('btn-enter');
        if (btnEnter) {
            btnEnter.addEventListener('click', (e) => {
                if (e) e.stopPropagation();
                this.enterExperience();
            });
        }

        const playBtn = document.getElementById('btn-play-pause');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePlay();
            });
        }

        const stopBtn = document.getElementById('btn-stop');
        if (stopBtn) {
            stopBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.stopVideo();
            });
        }

        const muteBtn = document.getElementById('btn-mute');
        if (muteBtn) {
            muteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMute();
            });
        }

        const volumeSlider = document.getElementById('volume-slider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.videoA.volume = val;
                this.videoB.volume = val;
                this.videoA.muted = false;
                this.videoB.muted = false;
                this.updateVolumeIcons();
            });
        }

        const timelineContainer = document.getElementById('timeline-container');
        if (timelineContainer) {
            timelineContainer.addEventListener('mousedown', (e) => this.startScrubbing(e));
            window.addEventListener('mousemove', (e) => {
                if (this.isScrubbing) this.scrub(e);
            });
            window.addEventListener('mouseup', () => {
                this.isScrubbing = false;
            });
            timelineContainer.addEventListener('touchstart', (e) => this.startScrubbingTouch(e), { passive: false });
            window.addEventListener('touchmove', (e) => {
                if (this.isScrubbing) this.scrubTouch(e);
            }, { passive: false });
            window.addEventListener('touchend', () => {
                this.isScrubbing = false;
            });
        }

        const btnGyro = document.getElementById('btn-gyro');
        if (btnGyro) {
            btnGyro.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleGyro();
            });
        }

        const btnSnapshotBottom = document.getElementById('btn-snapshot-bottom');
        if (btnSnapshotBottom) btnSnapshotBottom.addEventListener('click', () => this.takeSnapshot());

        const btnFullscreenBottom = document.getElementById('btn-fullscreen-bottom');
        if (btnFullscreenBottom) btnFullscreenBottom.addEventListener('click', () => this.toggleFullscreen());

        const sphereWidget = document.getElementById('orientation-widget-container');
        if (sphereWidget) {
            sphereWidget.addEventListener('click', () => {
                this.targetYaw = this.defaultYaw;
                this.targetPitch = this.defaultPitch;
                this.targetFov = this.defaultFov;
                this.gyroInitialOrientation = null;
                this.showToast('Vista reorientada al origen');
            });
        }
    }

    startScrubbingTouch(e) {
        if (e.touches && e.touches.length > 0) {
            e.preventDefault();
            this.isScrubbing = true;
            this.scrubTouch(e);
        }
    }

    scrubTouch(e) {
        if (!e.touches || e.touches.length === 0) return;
        const timeline = document.getElementById('timeline-container');
        if (!timeline) return;
        const rect = timeline.getBoundingClientRect();
        const touch = e.touches[0];
        const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        const targetTime = pos * this.totalDuration;
        this.seekGlobalTime(targetTime);
    }

    /* --------------------------------------------------------------------------
       ACCIONES DE REPRODUCCIÓN Y CONTROL
       -------------------------------------------------------------------------- */
    playVideo() {
        if (!this.activeVideo.src) {
            this.enterExperience();
            return;
        }

        this.isPlaying = true;
        this.setPlayState(true);

        const playPromise = this.activeVideo.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.setPlayState(true);
                this.hideBuffering();
            }).catch(() => {
                this.activeVideo.muted = true;
                this.videoA.muted = true;
                this.videoB.muted = true;
                this.activeVideo.play().then(() => {
                    this.setPlayState(true);
                    this.hideBuffering();
                    this.updateVolumeIcons();
                }).catch(() => {
                    this.setPlayState(false);
                    this.hideBuffering();
                });
            });
        }
    }

    pauseVideo() {
        this.isPlaying = false;
        this.activeVideo.pause();
        this.standbyVideo.pause();
        this.setPlayState(false);
        this.hideBuffering();
    }

    togglePlay() {
        if (this.activeVideo.paused || !this.isPlaying) {
            this.playVideo();
        } else {
            this.pauseVideo();
        }
    }

    setPlayState(playing) {
        this.isPlaying = playing;
        const iconPlay = document.getElementById('icon-play');
        const iconPause = document.getElementById('icon-pause');
        if (iconPlay) iconPlay.style.display = playing ? 'none' : 'block';
        if (iconPause) iconPause.style.display = playing ? 'block' : 'none';
    }

    toggleMute() {
        const isMuted = !this.activeVideo.muted;
        this.videoA.muted = isMuted;
        this.videoB.muted = isMuted;
        this.updateVolumeIcons();
        this.showToast(isMuted ? 'Sonido silenciado' : 'Sonido activado');
    }

    updateVolumeIcons() {
        const isMuted = this.activeVideo.muted || this.activeVideo.volume === 0;
        const iconVol = document.getElementById('icon-volume');
        const iconMute = document.getElementById('icon-mute');
        if (iconVol) iconVol.style.display = isMuted ? 'none' : 'block';
        if (iconMute) iconMute.style.display = isMuted ? 'block' : 'none';
    }

    startScrubbing(e) {
        this.isScrubbing = true;
        this.scrub(e);
    }

    scrub(e) {
        const timeline = document.getElementById('timeline-container');
        if (!timeline) return;
        const rect = timeline.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const targetTime = pos * this.totalDuration;
        this.seekGlobalTime(targetTime);
    }

    updateTimelineWithTime(currentTime) {
        if (!this.totalDuration || this.totalDuration <= 0) return;
        const progress = (currentTime / this.totalDuration) * 100;
        const pBar = document.getElementById('timeline-progress');
        const handle = document.getElementById('timeline-handle');
        const tCur = document.getElementById('time-current');
        if (pBar) pBar.style.width = `${progress}%`;
        if (handle) handle.style.left = `${progress}%`;
        if (tCur) tCur.textContent = this.formatTime(currentTime);

        if (this.activeVideo.buffered.length > 0) {
            const bufferedLocal = this.activeVideo.buffered.end(this.activeVideo.buffered.length - 1);
            const segStart = this.isSegmentedMode ? (this.segments[this.currentSegmentIndex]?.start || 0) : 0;
            const bufferedGlobal = segStart + bufferedLocal;
            const bufferedPercent = (bufferedGlobal / this.totalDuration) * 100;
            const bBar = document.getElementById('timeline-buffer');
            if (bBar) bBar.style.width = `${Math.min(100, bufferedPercent)}%`;
        }
    }

    updateTotalDuration() {
        const tTot = document.getElementById('time-total');
        if (tTot && this.totalDuration) {
            tTot.textContent = this.formatTime(this.totalDuration);
        }
    }

    formatTime(sec) {
        const mins = Math.floor(sec / 60);
        const secs = Math.floor(sec % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    takeSnapshot() {
        this.renderer.render(this.scene, this.camera);
        const dataURL = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `paisajes-andinos-${Date.now()}.png`;
        link.href = dataURL;
        link.click();
        this.showToast('Captura guardada');
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    }

    showBuffering(text = 'Cargando...') {
        if (this.bufferingSpinner) {
            if (this.bufferingText) this.bufferingText.textContent = text;
            this.bufferingSpinner.classList.remove('hidden');
        }
    }

    hideBuffering() {
        if (this.bufferingSpinner) {
            this.bufferingSpinner.classList.add('hidden');
        }
    }

    showToast(message, duration = 3000) {
        if (!this.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span>${message}</span>`;
        this.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = '0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    logDebug(message, type = 'info') {
        const time = new Date().toTimeString().split(' ')[0];
        const entry = { time, message, type };
        this.debugLogs.push(entry);
        if (this.debugLogs.length > 50) this.debugLogs.shift();

        const logContainer = document.getElementById('debug-log');
        if (logContainer) {
            const item = document.createElement('div');
            item.className = `debug-log-item ${type}`;
            item.textContent = `[${time}] ${message}`;
            logContainer.appendChild(item);
            logContainer.scrollTop = logContainer.scrollHeight;
        }
        console.log(`[Visor360 ${type.toUpperCase()}] ${message}`);
    }

    /* --------------------------------------------------------------------------
       PANEL DE DEBUG (TECLA D)
       -------------------------------------------------------------------------- */
    initDebug() {
        const closeBtn = document.getElementById('btn-close-debug');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.debugPanel.classList.add('hidden');
            });
        }

        const dbgPlay = document.getElementById('dbg-btn-play');
        if (dbgPlay) dbgPlay.addEventListener('click', () => this.playVideo());

        const dbgNext = document.getElementById('dbg-btn-next');
        if (dbgNext) dbgNext.addEventListener('click', () => this.transitionToNextSegment());

        const dbgPip = document.getElementById('dbg-btn-pip');
        if (dbgPip) {
            dbgPip.addEventListener('click', () => {
                this.pipActive = !this.pipActive;
                const container = document.getElementById('debug-pip-container');
                if (container) container.classList.toggle('hidden', !this.pipActive);
                this.updatePipPreview();
            });
        }

        const dbgCopy = document.getElementById('dbg-btn-copy');
        if (dbgCopy) {
            dbgCopy.addEventListener('click', () => {
                const report = this.generateDiagnosticReport();
                navigator.clipboard.writeText(report).then(() => this.showToast('Informe copiado'));
            });
        }
    }

    updatePipPreview() {
        const view = document.getElementById('debug-pip-view');
        if (!view) return;
        view.innerHTML = '';
        if (this.pipActive && this.activeVideo) {
            const clone = document.createElement('video');
            clone.src = this.activeVideo.src;
            clone.currentTime = this.activeVideo.currentTime;
            clone.muted = true;
            clone.autoplay = this.isPlaying;
            clone.playsInline = true;
            clone.controls = true;
            clone.style.width = '100%';
            clone.style.height = '100%';
            clone.style.objectFit = 'contain';
            view.appendChild(clone);
        }
    }

    generateDiagnosticReport() {
        const seg = this.segments[this.currentSegmentIndex] || {};
        return `=== INFORME VISOR 360 ===
FPS: ${this.currentFps}
Buffer: ${this.activeVideo === this.videoA ? 'Video A' : 'Video B'}
ReadyState: ${this.activeVideo ? READY_STATE_MAP[this.activeVideo.readyState] : 'null'}
Tiempo: ${this.activeVideo ? this.activeVideo.currentTime.toFixed(2) : 0}s / ${this.totalDuration.toFixed(2)}s
Segmento: #${this.currentSegmentIndex + 1} (${seg.file || 'N/A'})
Sensor Técnica: T${this.activeSensorTech} (${this.sensorTicksPerSec} Hz)`;
    }

    /* --------------------------------------------------------------------------
       EVENTOS DE NAVEGACIÓN TOUCH & MOUSE (ADAPTATIVOS)
       -------------------------------------------------------------------------- */
    initEvents() {
        window.addEventListener('resize', () => this.onWindowResize());

        const triggerMouseActive = () => {
            if (this.uiLayer) {
                this.uiLayer.classList.add('mouse-active');
                clearTimeout(this.mouseTimeout);
                this.mouseTimeout = setTimeout(() => {
                    this.uiLayer.classList.remove('mouse-active');
                }, 3000);
            }
        };

        window.addEventListener('mousemove', triggerMouseActive);

        this.container.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('pointermove', (e) => {
            this.onPointerMove(e);
            triggerMouseActive();
        });
        window.addEventListener('pointerup', () => this.onPointerUp());

        this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Eventos táctiles
        this.container.addEventListener('touchstart', (e) => {
            triggerMouseActive();
            this.onTouchStart(e);
        }, { passive: false });
        this.container.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.container.addEventListener('touchend', (e) => this.onTouchEnd(e));

        // Teclado
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
    }

    onPointerDown(e) {
        if (e.target !== this.renderer.domElement) return;
        this.isDragging = true;
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onPointerMove(e) {
        if (!this.isDragging || this.gyroActive) return;

        const deltaX = e.clientX - this.previousMousePosition.x;
        const deltaY = e.clientY - this.previousMousePosition.y;

        const sensitivity = 0.18 * (this.fov / 75);

        this.targetYaw -= deltaX * sensitivity;
        this.targetPitch -= deltaY * sensitivity;
        this.targetPitch = Math.max(-89.9, Math.min(89.9, this.targetPitch));

        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onPointerUp() {
        this.isDragging = false;
    }

    onTouchStart(e) {
        this.touchMoved = false;
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.touches.length === 2) {
            this.isDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this.touchStartDist = Math.hypot(dx, dy);
        }
    }

    onTouchMove(e) {
        this.touchMoved = true;
        if (this.gyroActive) return;

        if (e.touches.length === 1 && this.isDragging) {
            e.preventDefault();
            const deltaX = e.touches[0].clientX - this.previousMousePosition.x;
            const deltaY = e.touches[0].clientY - this.previousMousePosition.y;

            const sensitivity = 0.22 * (this.fov / 75);

            this.targetYaw -= deltaX * sensitivity;
            this.targetPitch -= deltaY * sensitivity;
            this.targetPitch = Math.max(-89.9, Math.min(89.9, this.targetPitch));

            this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            const deltaDist = dist - this.touchStartDist;

            this.targetFov -= deltaDist * 0.08;
            this.targetFov = Math.max(30, Math.min(125, this.targetFov));
            this.touchStartDist = dist;
        }
    }

    onTouchEnd(e) {
        if (!this.touchMoved && this.isMobile && e.target === this.renderer.domElement) {
            this.uiLayer.classList.toggle('controls-locked');
        }
        this.isDragging = false;
    }

    onWheel(e) {
        e.preventDefault();
        const zoomSpeed = 0.05;
        this.targetFov += e.deltaY * zoomSpeed;
        this.targetFov = Math.max(30, Math.min(125, this.targetFov));
    }

    onKeyDown(e) {
        this.keys[e.code] = true;

        if (e.code === 'Space') {
            e.preventDefault();
            this.togglePlay();
        } else if (e.code === 'KeyF') {
            this.toggleFullscreen();
        } else if (e.code === 'KeyM') {
            this.toggleMute();
        } else if (e.code === 'KeyD') {
            if (this.debugPanel) this.debugPanel.classList.toggle('hidden');
        } else if (e.code === 'KeyR') {
            this.targetYaw = this.defaultYaw;
            this.targetPitch = this.defaultPitch;
            this.targetFov = this.defaultFov;
            this.gyroInitialOrientation = null;
        }
    }

    onKeyUp(e) {
        this.keys[e.code] = false;
    }

    onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /* --------------------------------------------------------------------------
       BUCLE DE ANIMACIÓN Y RENDERIZADO (60 FPS+)
       -------------------------------------------------------------------------- */
    animate() {
        requestAnimationFrame(() => this.animate());

        // Medir FPS
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsUpdate >= 500) {
            this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            this.updateSensorDebugHUD();
        }

        // Actualizar textura de video en WebGL
        if (this.activeVideo && this.activeVideo.readyState >= 2) {
            if (this.activeTexture) {
                this.activeTexture.needsUpdate = true;
            }
        }
        if (this.domeMaterial && this.domeMaterial.uniforms && this.domeMaterial.uniforms.tVideo) {
            this.domeMaterial.uniforms.tVideo.value = this.activeTexture;
        }

        // Manejo de Teclado
        const keySpeed = 1.2;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.targetYaw -= keySpeed;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) this.targetYaw += keySpeed;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) this.targetPitch = Math.min(89.9, this.targetPitch + keySpeed);
        if (this.keys['KeyS'] || this.keys['ArrowDown']) this.targetPitch = Math.max(-89.9, this.targetPitch - keySpeed);

        // Suavizado inercial
        this.yaw += (this.targetYaw - this.yaw) * this.damping;
        this.pitch += (this.targetPitch - this.pitch) * this.damping;
        this.fov += (this.targetFov - this.fov) * this.damping;

        if (Math.abs(this.camera.fov - this.fov) > 0.01) {
            this.camera.fov = this.fov;
            this.camera.updateProjectionMatrix();
        }

        // Vector de vista de la cámara
        const phi = THREE.MathUtils.degToRad(90 - this.pitch);
        const theta = THREE.MathUtils.degToRad(this.yaw);

        const targetX = 500 * Math.sin(phi) * Math.sin(theta);
        const targetY = 500 * Math.cos(phi);
        const targetZ = 500 * Math.sin(phi) * Math.cos(theta);

        this.camera.lookAt(targetX, targetY, targetZ);

        // Actualizar Esfera 360° de Orientación
        if (this.markerCurrent) {
            const radYaw = THREE.MathUtils.degToRad(this.yaw);
            const radPitch = THREE.MathUtils.degToRad(this.pitch);

            const currX = 50 + 36 * Math.cos(radPitch) * Math.sin(radYaw);
            const currY = 50 - 36 * Math.sin(radPitch);

            this.markerCurrent.style.left = `${currX}%`;
            this.markerCurrent.style.top = `${currY}%`;
        }

        if (this.markerOrigin) {
            const radDefYaw = THREE.MathUtils.degToRad(this.defaultYaw);
            const radDefPitch = THREE.MathUtils.degToRad(this.defaultPitch);

            const origX = 50 + 36 * Math.cos(radDefPitch) * Math.sin(radDefYaw);
            const origY = 50 - 36 * Math.sin(radDefPitch);

            this.markerOrigin.style.left = `${origX}%`;
            this.markerOrigin.style.top = `${origY}%`;
        }

        // Renderizar escena 3D
        this.renderer.render(this.scene, this.camera);
    }
}

// Inicializar la aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
    window.app = new DomeViewer();
});
