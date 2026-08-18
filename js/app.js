/**
 * ==========================================================================
 * DOME 360° MASTER VIEWER - CONTROLADOR PRINCIPAL THREE.JS & REPRODUCTOR
 * CON SOPORTE PARA SEGMENTACIÓN 4K CONTINUA Y DOBLE BÚFER (PING-PONG)
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

class DomeViewer {
    constructor() {
        // Elementos DOM
        this.container = document.getElementById('canvas-container');
        this.videoA = document.getElementById('dome-video-a');
        this.videoB = document.getElementById('dome-video-b');
        this.uiLayer = document.getElementById('ui-layer');
        this.fileInput = document.getElementById('file-input');
        this.splashScreen = document.getElementById('splash-screen');
        this.settingsDrawer = document.getElementById('settings-drawer');
        this.dropzone = document.getElementById('dropzone');
        this.toastContainer = document.getElementById('toast-container');

        // Estado Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.domeMesh = null;
        this.domeMaterial = null;
        this.textureA = null;
        this.textureB = null;
        this.activeTexture = null;
        this.horizonGrid = null;

        // Estado del Motor de Segmentos (Doble Búfer)
        this.isSegmentedMode = true;
        this.segments = [...DEFAULT_SEGMENTS];
        this.currentSegmentIndex = 0;
        this.activeVideo = this.videoA;
        this.standbyVideo = this.videoB;
        this.totalDuration = this.segments[this.segments.length - 1].end;
        this.isTransitioning = false;

        // Estado de Navegación de Cámara
        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.yaw = 0;           // Azimut (grados)
        this.pitch = 70;        // Elevación inicial mirando hacia la cúpula/cenit (grados)
        this.targetYaw = 0;
        this.targetPitch = 70;
        this.fov = 75;
        this.targetFov = 75;
        this.damping = 0.08;    // Inercia suave
        this.autoRotate = false;
        this.autoRotateSpeed = 0.15;

        // Teclado
        this.keys = {};

        // Estado de Reproducción
        this.isPlaying = false;
        this.isScrubbing = false;
        this.playbackSpeeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        this.speedIndex = 2; // 1.0x

        // Calibración y Shader
        this.config = {
            domeFov: 180,           // Grados
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            rotation: 0,            // Grados
            flipX: false,
            flipY: false,
            exposure: 1.0,
            projectionMode: 0,      // 0: Fisheye Fulldome, 1: Equirectangular
            hemisphereOnly: true
        };

        // Temporizador de inactividad de UI
        this.uiTimeout = null;

        // Inicialización
        this.initThree();
        this.initSegmentEngine();
        this.initEvents();
        this.initUI();
        this.animate();
    }

    /* --------------------------------------------------------------------------
       INICIALIZACIÓN THREE.JS
       -------------------------------------------------------------------------- */
    initThree() {
        // 1. Escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05070c);

        // 2. Cámara (situada en el centro geométrico del domo)
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(this.fov, aspect, 0.1, 2000);
        this.camera.position.set(0, 0, 0);

        // 3. Renderizador WebGL
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // 4. Texturas para Doble Búfer (Video A y Video B)
        this.textureA = new THREE.VideoTexture(this.videoA);
        this.textureA.minFilter = THREE.LinearFilter;
        this.textureA.magFilter = THREE.LinearFilter;
        this.textureA.format = THREE.RGBAFormat;
        this.textureA.generateMipmaps = false;

        this.textureB = new THREE.VideoTexture(this.videoB);
        this.textureB.minFilter = THREE.LinearFilter;
        this.textureB.magFilter = THREE.LinearFilter;
        this.textureB.format = THREE.RGBAFormat;
        this.textureB.generateMipmaps = false;

        this.activeTexture = this.textureA;

        // 5. Material con Shader Fulldome
        const uniforms = THREE.UniformsUtils.clone(DomeShader.uniforms);
        uniforms.tVideo.value = this.activeTexture;
        uniforms.uAspect.value = 1.0;
        uniforms.uDomeFov.value = (this.config.domeFov * Math.PI) / 180;
        uniforms.uScale.value = this.config.scale;
        uniforms.uOffsetX.value = this.config.offsetX;
        uniforms.uOffsetY.value = this.config.offsetY;
        uniforms.uRotation.value = (this.config.rotation * Math.PI) / 180;
        uniforms.uFlipX.value = this.config.flipX;
        uniforms.uFlipY.value = this.config.flipY;
        uniforms.uProjectionMode.value = this.config.projectionMode;
        uniforms.uExposure.value = this.config.exposure;
        uniforms.uHemisphereOnly.value = this.config.hemisphereOnly ? 1.0 : 0.0;

        this.domeMaterial = new THREE.ShaderMaterial({
            uniforms: uniforms,
            vertexShader: DomeShader.vertexShader,
            fragmentShader: DomeShader.fragmentShader,
            side: THREE.BackSide // Renderizar cara interior
        });

        // 6. Geometría de Domo / Esfera
        const domeGeometry = new THREE.SphereGeometry(600, 96, 96);
        this.domeMesh = new THREE.Mesh(domeGeometry, this.domeMaterial);
        this.scene.add(this.domeMesh);

        // 7. Rejilla y Marcadores de Horizonte Planetario
        this.createHorizonMarkers();
    }

    createHorizonMarkers() {
        const horizonGroup = new THREE.Group();

        // Anillo de horizonte
        const ringGeo = new THREE.RingGeometry(585, 595, 64);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        ringMesh.position.y = -0.1;
        horizonGroup.add(ringMesh);

        // Líneas guía cardinales (N, S, E, O)
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.3 });
        const directions = [
            { x: 0, z: 590, name: 'FRENTE (S)' },
            { x: 0, z: -590, name: 'ATRÁS (N)' },
            { x: 590, z: 0, name: 'DER (E)' },
            { x: -590, z: 0, name: 'IZQ (O)' }
        ];

        directions.forEach(dir => {
            const points = [new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(dir.x, -0.2, dir.z)];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(lineGeo, lineMat);
            horizonGroup.add(line);
        });

        this.horizonGrid = horizonGroup;
        this.scene.add(this.horizonGrid);
    }

    /* --------------------------------------------------------------------------
       MOTOR DE REPRODUCCIÓN SEGMENTADA (DOBLE BÚFER PING-PONG)
       -------------------------------------------------------------------------- */
    initSegmentEngine() {
        fetch('segments/manifest.json')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data) && data.length > 0) {
                    this.segments = data;
                    this.totalDuration = this.segments[this.segments.length - 1].end;
                    this.updateTotalDuration();
                }
            })
            .catch(() => {
                // Fallback ya configurado
            });

        // Configurar fuentes iniciales
        this.setupVideoEvents(this.videoA, 'A');
        this.setupVideoEvents(this.videoB, 'B');

        // Cargar primer segmento en Video A
        this.videoA.src = this.segments[0].file;
        this.videoA.load();

        // Precargar segundo segmento en Video B
        if (this.segments.length > 1) {
            this.videoB.src = this.segments[1].file;
            this.videoB.load();
        }

        this.updateTotalDuration();
    }

    setupVideoEvents(videoEl, id) {
        videoEl.addEventListener('loadedmetadata', () => {
            if (videoEl === this.activeVideo) {
                if (videoEl.videoWidth && videoEl.videoHeight) {
                    const aspect = videoEl.videoWidth / videoEl.videoHeight;
                    this.domeMaterial.uniforms.uAspect.value = aspect;
                }
                this.updateTotalDuration();
            }
        });

        videoEl.addEventListener('timeupdate', () => {
            if (videoEl === this.activeVideo && !this.isScrubbing) {
                this.onActiveTimeUpdate();
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
            }
        });

        videoEl.addEventListener('pause', () => {
            if (videoEl === this.activeVideo && !this.isTransitioning) {
                this.setPlayState(false);
            }
        });

        videoEl.addEventListener('error', (e) => {
            console.warn(`Video ${id} error:`, e);
        });
    }

    onActiveTimeUpdate() {
        const seg = this.segments[this.currentSegmentIndex];
        if (!seg) return;

        const globalTime = seg.start + this.activeVideo.currentTime;
        this.updateTimelineWithTime(globalTime);

        // Precarga y transición suave antes del final
        const remaining = seg.duration - this.activeVideo.currentTime;
        if (remaining <= 0.12 && remaining > 0 && !this.isTransitioning) {
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

        // Actualizar textura Three.js inmediatamente
        this.domeMaterial.uniforms.tVideo.value = this.activeTexture;

        // Sincronizar parámetros
        this.activeVideo.volume = this.standbyVideo.volume;
        this.activeVideo.muted = this.standbyVideo.muted;
        this.activeVideo.playbackRate = this.playbackSpeeds[this.speedIndex];

        if (this.isPlaying) {
            const playProm = this.activeVideo.play();
            if (playProm !== undefined) {
                playProm.catch(e => console.warn("Next segment play error:", e));
            }
        }

        // Precargar el segmento subsiguiente en el standby
        const futureIndex = (nextIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[futureIndex].file;
        this.standbyVideo.load();

        setTimeout(() => {
            this.isTransitioning = false;
        }, 200);
    }

    seekGlobalTime(targetTime) {
        targetTime = Math.max(0, Math.min(this.totalDuration, targetTime));

        if (!this.isSegmentedMode) {
            this.activeVideo.currentTime = targetTime;
            this.updateTimelineWithTime(targetTime);
            return;
        }

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

        this.currentSegmentIndex = targetIndex;
        this.activeVideo.src = targetSeg.file;
        this.activeVideo.currentTime = offsetInSegment;

        if (this.isPlaying) {
            this.activeVideo.play().catch(e => console.warn("Seek play error:", e));
        }

        // Precargar siguiente en standby
        const nextIndex = (targetIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[nextIndex].file;
        this.standbyVideo.load();

        this.updateTimelineWithTime(targetTime);
    }

    /* --------------------------------------------------------------------------
       EVENTOS DE RATÓN, TECLADO Y VENTANA
       -------------------------------------------------------------------------- */
    initEvents() {
        window.addEventListener('resize', () => this.onWindowResize());

        // Ratón / Puntero para navegar la cámara
        this.container.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('pointermove', (e) => this.onPointerMove(e));
        window.addEventListener('pointerup', () => this.onPointerUp());

        // Zoom con Rueda del Ratón
        this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Atajos de Teclado
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Drag and Drop de archivos de video
        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropzone.classList.add('active');
        });

        window.addEventListener('dragleave', (e) => {
            if (e.relatedTarget === null) {
                this.dropzone.classList.remove('active');
            }
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropzone.classList.remove('active');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                this.loadCustomVideoFile(e.dataTransfer.files[0]);
            }
        });

        window.addEventListener('mousemove', () => this.resetUiTimeout());
    }

    onPointerDown(e) {
        if (e.target !== this.renderer.domElement) return;
        this.isDragging = true;
        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onPointerMove(e) {
        if (!this.isDragging) return;

        const deltaX = e.clientX - this.previousMousePosition.x;
        const deltaY = e.clientY - this.previousMousePosition.y;

        const sensitivity = 0.18 * (this.fov / 75);

        this.targetYaw += deltaX * sensitivity;
        this.targetPitch -= deltaY * sensitivity;
        this.targetPitch = Math.max(-89.9, Math.min(89.9, this.targetPitch));

        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onPointerUp() {
        this.isDragging = false;
    }

    onWheel(e) {
        e.preventDefault();
        const zoomSpeed = 0.05;
        this.targetFov += e.deltaY * zoomSpeed;
        this.targetFov = Math.max(30, Math.min(120, this.targetFov));
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
        } else if (e.code === 'KeyH') {
            this.uiLayer.classList.toggle('ui-hidden');
        } else if (e.code === 'KeyR') {
            this.setPresetView('zenith');
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
       CONSTRUCCIÓN Y EVENTOS DE INTERFAZ (UI & CONTROLES)
       -------------------------------------------------------------------------- */
    initUI() {
        // Botón Start Splash (Soporta btn-enter y btn-start-experience)
        const btnStart = document.getElementById('btn-enter') || document.getElementById('btn-start-experience');
        const handleStart = (e) => {
            if (e) e.stopPropagation();
            if (this.splashScreen) {
                this.splashScreen.classList.add('hidden');
            }
            this.playVideo();
        };

        if (btnStart) {
            btnStart.addEventListener('click', handleStart);
        }

        if (this.splashScreen) {
            this.splashScreen.addEventListener('click', (e) => {
                if (e.target === this.splashScreen) {
                    handleStart(e);
                }
            });
        }

        // Botón Play/Pausa (Soporta btn-play-pause y btn-play)
        const playBtn = document.getElementById('btn-play-pause') || document.getElementById('btn-play');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePlay();
            });
        }

        // Botón Volumen / Mute
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

        // Timeline Scrubbing
        const timelineContainer = document.getElementById('timeline-container');
        if (timelineContainer) {
            timelineContainer.addEventListener('mousedown', (e) => this.startScrubbing(e));
            window.addEventListener('mousemove', (e) => {
                if (this.isScrubbing) this.scrub(e);
            });
            window.addEventListener('mouseup', () => {
                this.isScrubbing = false;
            });
        }

        // Velocidad de Reproducción
        const btnSpeed = document.getElementById('btn-speed');
        if (btnSpeed) {
            btnSpeed.addEventListener('click', () => {
                this.speedIndex = (this.speedIndex + 1) % this.playbackSpeeds.length;
                const speed = this.playbackSpeeds[this.speedIndex];
                this.videoA.playbackRate = speed;
                this.videoB.playbackRate = speed;
                btnSpeed.textContent = `${speed}x`;
                this.showToast(`Velocidad: ${speed}x`);
            });
        }

        // Auto-rotación
        const autoRotBtn = document.getElementById('btn-auto-rotate');
        if (autoRotBtn) {
            autoRotBtn.addEventListener('click', () => {
                this.autoRotate = !this.autoRotate;
                autoRotBtn.classList.toggle('active', this.autoRotate);
                this.showToast(this.autoRotate ? 'Auto-rotación activada' : 'Auto-rotación desactivada');
            });
        }

        // Conmutador de Proyección Fisheye / Equirectangular
        const projToggleBtn = document.getElementById('btn-projection-toggle');
        if (projToggleBtn) {
            projToggleBtn.addEventListener('click', () => {
                this.config.projectionMode = this.config.projectionMode === 0 ? 1 : 0;
                this.domeMaterial.uniforms.uProjectionMode.value = this.config.projectionMode;
                const label = this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular';
                const span = projToggleBtn.querySelector('span');
                if (span) span.textContent = label;
                document.getElementById('projection-badge').textContent = this.config.projectionMode === 0 ? 'FULLDOME 180°' : 'ESFERA 360°';
                this.showToast(`Proyección: ${label}`);
            });
        }

        // Conmutador Semiesfera / Esfera Completa
        const btnToggleHemi = document.getElementById('btn-toggle-hemi');
        if (btnToggleHemi) {
            btnToggleHemi.addEventListener('click', () => {
                this.config.hemisphereOnly = !this.config.hemisphereOnly;
                this.domeMaterial.uniforms.uHemisphereOnly.value = this.config.hemisphereOnly ? 1.0 : 0.0;
                this.horizonGrid.visible = this.config.hemisphereOnly;
                const modeName = this.config.hemisphereOnly ? 'Semiesfera Superior (Domo)' : 'Esfera Completa 360°';
                document.getElementById('projection-badge').textContent = this.config.hemisphereOnly ? 'FULLDOME 180°' : 'ESFERA 360°';
                this.showToast(`Modo: ${modeName}`);
            });
        }

        // Cargar Archivo Local
        const btnLoadFile = document.getElementById('btn-load-file');
        if (btnLoadFile) {
            btnLoadFile.addEventListener('click', () => this.fileInput.click());
        }
        if (this.fileInput) {
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.loadCustomVideoFile(e.target.files[0]);
                }
            });
        }

        // Captura de pantalla
        const btnSnapshot = document.getElementById('btn-snapshot');
        if (btnSnapshot) btnSnapshot.addEventListener('click', () => this.takeSnapshot());

        // Pantalla Completa
        const btnFullscreen = document.getElementById('btn-fullscreen');
        if (btnFullscreen) btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

        // Drawer de Calibración
        const btnSettings = document.getElementById('btn-settings-toggle');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        if (btnSettings) {
            btnSettings.addEventListener('click', () => this.settingsDrawer.classList.toggle('open'));
        }
        if (btnCloseSettings) {
            btnCloseSettings.addEventListener('click', () => this.settingsDrawer.classList.remove('open'));
        }

        // Controles de Calibración
        this.initCalibrationControls();

        // Presets de Cámara
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const preset = e.currentTarget.dataset.view;
                this.setPresetView(preset);
                this.showToast(`Vista: ${preset.toUpperCase()}`);
            });
        });

        // Widget Brújula
        const compWidget = document.getElementById('orientation-widget') || document.getElementById('compass-widget');
        if (compWidget) {
            compWidget.addEventListener('click', () => {
                this.setPresetView('zenith');
                document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                document.querySelector('.btn-preset[data-view="zenith"]')?.classList.add('active');
                this.showToast('Reorientado al Cenit');
            });
        }
    }

    initCalibrationControls() {
        const sFov = document.getElementById('slider-dome-fov');
        const lFov = document.getElementById('lbl-dome-fov');
        if (sFov) {
            sFov.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.config.domeFov = val;
                this.domeMaterial.uniforms.uDomeFov.value = (val * Math.PI) / 180;
                if (lFov) lFov.textContent = `${val}°`;
            });
        }

        const sScale = document.getElementById('slider-scale');
        const lScale = document.getElementById('lbl-scale');
        if (sScale) {
            sScale.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.config.scale = val;
                this.domeMaterial.uniforms.uScale.value = val;
                if (lScale) lScale.textContent = `${val.toFixed(2)}x`;
            });
        }

        const sOffX = document.getElementById('slider-offset-x');
        const lOffX = document.getElementById('lbl-offset-x');
        if (sOffX) {
            sOffX.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.config.offsetX = val;
                this.domeMaterial.uniforms.uOffsetX.value = val;
                if (lOffX) lOffX.textContent = val.toFixed(2);
            });
        }

        const sOffY = document.getElementById('slider-offset-y');
        const lOffY = document.getElementById('lbl-offset-y');
        if (sOffY) {
            sOffY.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.config.offsetY = val;
                this.domeMaterial.uniforms.uOffsetY.value = val;
                if (lOffY) lOffY.textContent = val.toFixed(2);
            });
        }

        const sRot = document.getElementById('slider-rotation');
        const lRot = document.getElementById('lbl-rotation');
        if (sRot) {
            sRot.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.config.rotation = val;
                this.domeMaterial.uniforms.uRotation.value = (val * Math.PI) / 180;
                if (lRot) lRot.textContent = `${val}°`;
            });
        }

        const sExp = document.getElementById('slider-exposure');
        const lExp = document.getElementById('lbl-exposure');
        if (sExp) {
            sExp.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                this.config.exposure = val;
                this.domeMaterial.uniforms.uExposure.value = val;
                if (lExp) lExp.textContent = `${val.toFixed(2)}x`;
            });
        }

        const chkFlipX = document.getElementById('chk-flip-x');
        if (chkFlipX) {
            chkFlipX.addEventListener('change', (e) => {
                this.config.flipX = e.target.checked;
                this.domeMaterial.uniforms.uFlipX.value = e.target.checked;
            });
        }

        const chkFlipY = document.getElementById('chk-flip-y');
        if (chkFlipY) {
            chkFlipY.addEventListener('change', (e) => {
                this.config.flipY = e.target.checked;
                this.domeMaterial.uniforms.uFlipY.value = e.target.checked;
            });
        }

        const btnResetCal = document.getElementById('btn-reset-calibration');
        if (btnResetCal) {
            btnResetCal.addEventListener('click', () => {
                if (sFov) { sFov.value = 180; sFov.dispatchEvent(new Event('input')); }
                if (sScale) { sScale.value = 1.0; sScale.dispatchEvent(new Event('input')); }
                if (sOffX) { sOffX.value = 0.0; sOffX.dispatchEvent(new Event('input')); }
                if (sOffY) { sOffY.value = 0.0; sOffY.dispatchEvent(new Event('input')); }
                if (sRot) { sRot.value = 0; sRot.dispatchEvent(new Event('input')); }
                if (sExp) { sExp.value = 1.0; sExp.dispatchEvent(new Event('input')); }
                if (chkFlipX) { chkFlipX.checked = false; chkFlipX.dispatchEvent(new Event('change')); }
                if (chkFlipY) { chkFlipY.checked = false; chkFlipY.dispatchEvent(new Event('change')); }
                this.showToast('Calibración restablecida');
            });
        }
    }

    /* --------------------------------------------------------------------------
       ACCIONES DE REPRODUCCIÓN Y CONTROL
       -------------------------------------------------------------------------- */
    playVideo() {
        if (!this.activeVideo.src || this.activeVideo.src === window.location.href) {
            const seg = this.segments[this.currentSegmentIndex] || this.segments[0];
            if (seg) {
                this.activeVideo.src = seg.file;
                this.activeVideo.load();
            }
        }

        const playPromise = this.activeVideo.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.setPlayState(true);
            }).catch(err => {
                console.warn('Autoplay prevenido:', err);
                // Si el navegador bloqueó audio, reintentar silenciado
                this.activeVideo.muted = true;
                this.videoA.muted = true;
                this.videoB.muted = true;
                this.activeVideo.play().then(() => {
                    this.setPlayState(true);
                    this.updateVolumeIcons();
                    this.showToast('Reproduciendo en silencio. Clic en altavoz para sonido.', 4000);
                }).catch(e => {
                    console.error('Error al reproducir:', e);
                    this.setPlayState(false);
                });
            });
        }
    }

    pauseVideo() {
        this.activeVideo.pause();
        this.standbyVideo.pause();
        this.setPlayState(false);
    }

    togglePlay() {
        if (this.activeVideo.paused) {
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
    }

    updateVolumeIcons() {
        const isMuted = this.activeVideo.muted || this.activeVideo.volume === 0;
        const iconVol = document.getElementById('icon-volume');
        const iconMute = document.getElementById('icon-mute');
        if (iconVol) iconVol.style.display = isMuted ? 'none' : 'block';
        if (iconMute) iconMute.style.display = isMuted ? 'block' : 'none';
        if (!isMuted && this.activeVideo.volume === 0) {
            this.videoA.volume = 0.5;
            this.videoB.volume = 0.5;
            const volSlider = document.getElementById('volume-slider');
            if (volSlider) volSlider.value = 0.5;
        }
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

        // Buffer progress
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

    loadCustomVideoFile(file) {
        this.isSegmentedMode = false;
        const url = URL.createObjectURL(file);
        this.activeVideo.src = url;
        this.activeVideo.load();
        this.activeVideo.addEventListener('loadedmetadata', () => {
            this.totalDuration = this.activeVideo.duration;
            this.updateTotalDuration();
        }, { once: true });
        this.playVideo();
        const badge = document.getElementById('file-name-badge');
        if (badge) badge.textContent = file.name;
        this.showToast(`Cargado archivo local: ${file.name}`);
    }

    setPresetView(preset) {
        switch (preset) {
            case 'zenith':
                this.targetPitch = 85;
                this.targetYaw = 0;
                break;
            case 'front':
                this.targetPitch = 15;
                this.targetYaw = 0;
                break;
            case 'back':
                this.targetPitch = 15;
                this.targetYaw = 180;
                break;
            case 'left':
                this.targetPitch = 15;
                this.targetYaw = 90;
                break;
            case 'right':
                this.targetPitch = 15;
                this.targetYaw = -90;
                break;
        }
    }

    takeSnapshot() {
        this.renderer.render(this.scene, this.camera);
        const dataURL = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `domo-360-captura-${Date.now()}.png`;
        link.href = dataURL;
        link.click();
        this.showToast('Captura guardada en descargas');
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => console.warn(err));
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    }

    resetUiTimeout() {
        if (this.uiLayer) this.uiLayer.classList.remove('ui-hidden');
        clearTimeout(this.uiTimeout);
        this.uiTimeout = setTimeout(() => {
            if (!this.settingsDrawer.classList.contains('open') && this.isPlaying) {
                if (this.uiLayer) this.uiLayer.classList.add('ui-hidden');
            }
        }, 4000);
    }

    showToast(message, duration = 3000) {
        if (!this.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4m0 4h.01"/>
            </svg>
            <span>${message}</span>
        `;
        this.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = '0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /* --------------------------------------------------------------------------
       BUCLE DE ANIMACIÓN Y RENDERIZADO (60 FPS+)
       -------------------------------------------------------------------------- */
    animate() {
        requestAnimationFrame(() => this.animate());

        // 1. Forzar actualización de textura de video en WebGL si hay datos
        if (this.activeVideo && this.activeVideo.readyState >= this.activeVideo.HAVE_CURRENT_DATA) {
            if (this.activeTexture) {
                this.activeTexture.needsUpdate = true;
            }
        }

        // 2. Manejo de Teclado (WASD / Flechas)
        const keySpeed = 1.2;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.targetYaw += keySpeed;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) this.targetYaw -= keySpeed;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) this.targetPitch = Math.min(89.9, this.targetPitch + keySpeed);
        if (this.keys['KeyS'] || this.keys['ArrowDown']) this.targetPitch = Math.max(-89.9, this.targetPitch - keySpeed);

        // 3. Rotación automática
        if (this.autoRotate && !this.isDragging) {
            this.targetYaw += this.autoRotateSpeed;
        }

        // 4. Suavizado inercial (Lerp Damping)
        this.yaw += (this.targetYaw - this.yaw) * this.damping;
        this.pitch += (this.targetPitch - this.pitch) * this.damping;
        this.fov += (this.targetFov - this.fov) * this.damping;

        if (Math.abs(this.camera.fov - this.fov) > 0.01) {
            this.camera.fov = this.fov;
            this.camera.updateProjectionMatrix();
        }

        // 5. Vector de vista de la cámara
        const phi = THREE.MathUtils.degToRad(90 - this.pitch);
        const theta = THREE.MathUtils.degToRad(this.yaw);

        const targetX = 500 * Math.sin(phi) * Math.sin(theta);
        const targetY = 500 * Math.cos(phi);
        const targetZ = 500 * Math.sin(phi) * Math.cos(theta);

        this.camera.lookAt(targetX, targetY, targetZ);

        // 6. Aguja de brújula
        const needle = document.getElementById('compass-needle');
        if (needle) {
            needle.style.transform = `rotate(${-this.yaw}deg)`;
        }

        // 7. Renderizar escena 3D
        this.renderer.render(this.scene, this.camera);
    }
}

// Inicializar la aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
    window.app = new DomeViewer();
});
