/**
 * ==========================================================================
 * DOME 360° MASTER VIEWER - CONTROLADOR PRINCIPAL THREE.JS & REPRODUCTOR
 * CON SOPORTE PARA SEGMENTACIÓN 4K CONTINUA, DUAL BUFFERING Y DISEÑO FROSTED
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

const READY_STATE_MAP = [
    '0: HAVE_NOTHING',
    '1: HAVE_METADATA',
    '2: HAVE_CURRENT_DATA',
    '3: HAVE_FUTURE_DATA',
    '4: HAVE_ENOUGH_DATA'
];

class DomeViewer {
    constructor() {
        // Elementos DOM
        this.container = document.getElementById('canvas-container');
        this.videoA = document.getElementById('dome-video-a');
        this.videoB = document.getElementById('dome-video-b');
        this.uiLayer = document.getElementById('ui-layer');
        this.fileInput = document.getElementById('file-input');
        this.dataWarningModal = document.getElementById('data-warning-modal');
        this.splashScreen = document.getElementById('splash-screen');
        this.settingsDrawer = document.getElementById('settings-drawer');
        this.dropzone = document.getElementById('dropzone');
        this.toastContainer = document.getElementById('toast-container');
        this.bufferingSpinner = document.getElementById('buffering-spinner');
        this.bufferingText = document.getElementById('buffering-text');
        this.debugPanel = document.getElementById('debug-panel');

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
        this.engineInitialized = false;

        // Posición Inicial de Cámara Solicitada:
        // Mirando entre la izquierda y el frente (Yaw = 45°), 30° hacia arriba (Pitch = 30°), zoom más alejado (FOV = 88°)
        this.defaultYaw = 45;
        this.defaultPitch = 30;
        this.defaultFov = 88;

        this.yaw = this.defaultYaw;
        this.pitch = this.defaultPitch;
        this.fov = this.defaultFov;
        this.targetYaw = this.defaultYaw;
        this.targetPitch = this.defaultPitch;
        this.targetFov = this.defaultFov;

        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };
        this.damping = 0.08;
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

        // Temporizador de inactividad de UI
        this.uiTimeout = null;

        // Diagnóstico / Debug
        this.debugLogs = [];
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.currentFps = 60;
        this.pipActive = false;

        // 1. Inicializar Three.js y Eventos UI
        this.initThree();
        this.initEvents();
        this.initUI();
        this.initDebug();
        this.initGatekeeper();
        this.animate();

        this.logDebug('Visor 360 inicializado correctamente', 'success');
    }

    /* --------------------------------------------------------------------------
       PUERTA DE ENTRADA Y GESTIÓN DE DATOS MÓVILES (CERO DESCARGAS INICIALES)
       -------------------------------------------------------------------------- */
    initGatekeeper() {
        // Detectar si el usuario está en red celular / datos móviles
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const isCellular = conn && (conn.type === 'cellular' || conn.saveData === true || ['2g', '3g', '4g'].includes(conn.effectiveType));

        const btnDataContinue = document.getElementById('btn-data-continue');
        if (btnDataContinue) {
            btnDataContinue.addEventListener('click', () => {
                if (this.dataWarningModal) {
                    this.dataWarningModal.classList.add('hidden');
                }
                if (this.splashScreen) {
                    this.splashScreen.classList.remove('hidden');
                }
                this.loadManifestOnly();
            });
        }

        if (isCellular) {
            // Mostrar aviso de datos móviles primero
            if (this.dataWarningModal) this.dataWarningModal.classList.remove('hidden');
            if (this.splashScreen) this.splashScreen.classList.add('hidden');
            this.logDebug('Detectada conexión de datos móviles: Mostrando advertencia previa', 'warn');
        } else {
            // En Wi-Fi o Escritorio: pasar directo a la pantalla de bienvenida
            if (this.dataWarningModal) this.dataWarningModal.classList.add('hidden');
            if (this.splashScreen) this.splashScreen.classList.remove('hidden');
            this.loadManifestOnly();
        }
    }

    loadManifestOnly() {
        if (this.manifestLoaded) return;
        this.manifestLoaded = true;

        fetch('segments/manifest.json')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data) && data.length > 0) {
                    this.segments = data.map(item => ({
                        ...item,
                        file: item.file.replace(/\\/g, '/')
                    }));
                    this.totalDuration = this.segments[this.segments.length - 1].end;
                    this.updateTotalDuration();
                    this.logDebug(`Manifest cargado: ${this.segments.length} segmentos (Duración total: ${this.totalDuration.toFixed(1)}s)`, 'info');
                }
            })
            .catch(() => {
                this.logDebug(`Uso de lista por defecto (${this.segments.length} segmentos)`, 'info');
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
            antialias: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        // Texturas para Doble Búfer (Video A y Video B)
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

        // Material con Shader Fulldome
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

        // Geometría Esférica
        const domeGeometry = new THREE.SphereGeometry(600, 96, 96);
        this.domeMesh = new THREE.Mesh(domeGeometry, this.domeMaterial);
        this.scene.add(this.domeMesh);
    }

    /* --------------------------------------------------------------------------
       ENTRADA A LA EXPERIENCIA Y CEBADO DUAL DE VIDEO (SEAMLESS AUTOPLAY)
       -------------------------------------------------------------------------- */
    enterExperience() {
        if (this.splashScreen) {
            this.splashScreen.classList.add('hidden');
            setTimeout(() => {
                this.splashScreen.style.display = 'none';
            }, 700);
        }

        this.showBuffering('Iniciando 4K...');

        // Desbloquear / cebar ambos reproductores con el gesto del usuario
        this.primeAndStartPlayback();
    }

    primeAndStartPlayback() {
        if (!this.engineInitialized) {
            this.engineInitialized = true;
            this.setupVideoEvents(this.videoA, 'Video A');
            this.setupVideoEvents(this.videoB, 'Video B');
        }

        // Asignar primer segmento a Video A
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
                this.logDebug('Video A iniciado correctamente', 'success');

                // Precargar y desbloquear Video B en segundo plano con volumen sincronizado
                if (this.segments.length > 1) {
                    this.videoB.src = this.segments[1].file;
                    this.videoB.preload = "auto";
                    this.videoB.load();
                }
            }).catch(err => {
                this.logDebug(`Autoplay protegido: ${err.message}`, 'warn');
                this.videoA.muted = true;
                this.videoB.muted = true;
                this.videoA.play().then(() => {
                    this.setPlayState(true);
                    this.hideBuffering();
                    this.updateVolumeIcons();
                    this.showToast('Reproduciendo en silencio. Clic en altavoz para sonido.', 4000);
                }).catch(e => {
                    this.logDebug(`Error play: ${e.message}`, 'error');
                    this.setPlayState(false);
                    this.hideBuffering();
                });
            });
        }
    }

    setupVideoEvents(videoEl, name) {
        videoEl.addEventListener('loadstart', () => {
            this.logDebug(`[${name}] loadstart: ${videoEl.src.split('/').pop()}`, 'info');
        });

        videoEl.addEventListener('loadedmetadata', () => {
            this.logDebug(`[${name}] metadata: ${videoEl.videoWidth}x${videoEl.videoHeight} (${videoEl.duration.toFixed(1)}s)`, 'success');
            if (videoEl === this.activeVideo) {
                if (videoEl.videoWidth && videoEl.videoHeight) {
                    const aspect = videoEl.videoWidth / videoEl.videoHeight;
                    this.domeMaterial.uniforms.uAspect.value = aspect;
                }
                this.updateTotalDuration();
            }
        });

        videoEl.addEventListener('loadeddata', () => {
            this.logDebug(`[${name}] loadeddata listo`, 'info');
            if (videoEl === this.activeVideo && this.activeTexture) {
                this.activeTexture.needsUpdate = true;
            }
        });

        videoEl.addEventListener('timeupdate', () => {
            if (videoEl === this.activeVideo && !this.isScrubbing) {
                this.onActiveTimeUpdate();
            }
        });

        videoEl.addEventListener('ended', () => {
            this.logDebug(`[${name}] ended (fin de segmento)`, 'info');
            if (videoEl === this.activeVideo) {
                this.transitionToNextSegment();
            }
        });

        videoEl.addEventListener('play', () => {
            this.logDebug(`[${name}] play iniciado`, 'info');
            if (videoEl === this.activeVideo) {
                this.setPlayState(true);
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('playing', () => {
            this.logDebug(`[${name}] playing fluido`, 'success');
            if (videoEl === this.activeVideo) {
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('pause', () => {
            this.logDebug(`[${name}] pause`, 'info');
            if (videoEl === this.activeVideo && !this.isTransitioning) {
                this.setPlayState(false);
            }
        });

        videoEl.addEventListener('waiting', () => {
            this.logDebug(`[${name}] waiting buffer`, 'warn');
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.showBuffering('Cargando 4K...');
            }
        });

        videoEl.addEventListener('canplay', () => {
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('error', () => {
            const errCode = videoEl.error ? videoEl.error.code : 'Desconocido';
            this.logDebug(`[${name}] ERROR código ${errCode}`, 'error');
            if (videoEl === this.activeVideo) {
                this.hideBuffering();
                this.showToast(`Error de segmento (Código ${errCode})`, 4000);
            }
        });
    }

    onActiveTimeUpdate() {
        const seg = this.segments[this.currentSegmentIndex];
        if (!seg) return;

        const globalTime = seg.start + this.activeVideo.currentTime;
        this.updateTimelineWithTime(globalTime);

        // Precargar siguiente segmento en standby si aún no se asignó
        const nextIndex = (this.currentSegmentIndex + 1) % this.segments.length;
        if (!this.standbyVideo.src || this.standbyVideo.src.indexOf(this.segments[nextIndex].file) === -1) {
            this.standbyVideo.src = this.segments[nextIndex].file;
            this.standbyVideo.load();
        }

        // Transición anticipada ultra fluida (0.10s antes del final)
        const remaining = seg.duration - this.activeVideo.currentTime;
        if (remaining <= 0.10 && remaining > 0 && !this.isTransitioning) {
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
        this.logDebug(`Transición a Segmento #${nextIndex + 1} (${this.segments[nextIndex].file})`, 'info');

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
                }).catch(e => {
                    this.logDebug(`Reintento play transición: ${e.message}`, 'warn');
                    this.activeVideo.play().catch(() => {});
                });
            }
        }

        // Precargar subsiguiente en standby
        const futureIndex = (nextIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[futureIndex].file;
        this.standbyVideo.load();

        if (this.pipActive) this.updatePipPreview();

        setTimeout(() => {
            this.isTransitioning = false;
        }, 250);
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

        this.showBuffering('Saltando...');
        this.logDebug(`Seek ${targetTime.toFixed(1)}s -> Segmento #${targetIndex + 1}`, 'info');

        this.currentSegmentIndex = targetIndex;
        this.activeVideo.src = targetSeg.file;
        this.activeVideo.currentTime = offsetInSegment;

        if (this.isPlaying) {
            this.activeVideo.play().catch(e => this.logDebug(`Seek play catch: ${e.message}`, 'warn'));
        }

        const nextIndex = (targetIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[nextIndex].file;
        this.standbyVideo.load();

        this.updateTimelineWithTime(targetTime);
    }

    stopVideo() {
        this.pauseVideo();
        this.seekGlobalTime(0);
        this.showToast('Reproducción detenida (0:00)');
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
        }

        const projToggleBtn = document.getElementById('btn-projection-toggle');
        if (projToggleBtn) {
            projToggleBtn.addEventListener('click', () => {
                this.config.projectionMode = this.config.projectionMode === 0 ? 1 : 0;
                this.domeMaterial.uniforms.uProjectionMode.value = this.config.projectionMode;
                const label = this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular';
                const span = projToggleBtn.querySelector('span');
                if (span) span.textContent = label;
                this.showToast(`Proyección: ${label}`);
            });
        }

        const btnToggleHemi = document.getElementById('btn-toggle-hemi');
        if (btnToggleHemi) {
            btnToggleHemi.addEventListener('click', () => {
                this.config.hemisphereOnly = !this.config.hemisphereOnly;
                this.domeMaterial.uniforms.uHemisphereOnly.value = this.config.hemisphereOnly ? 1.0 : 0.0;
                this.showToast(`Modo: ${this.config.hemisphereOnly ? 'Semiesfera' : 'Esfera Completa'}`);
            });
        }

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

        const btnSnapshot = document.getElementById('btn-snapshot');
        if (btnSnapshot) btnSnapshot.addEventListener('click', () => this.takeSnapshot());

        const btnFullscreen = document.getElementById('btn-fullscreen');
        const btnFullscreenBottom = document.getElementById('btn-fullscreen-bottom');
        const handleFullscreen = () => this.toggleFullscreen();
        if (btnFullscreen) btnFullscreen.addEventListener('click', handleFullscreen);
        if (btnFullscreenBottom) btnFullscreenBottom.addEventListener('click', handleFullscreen);

        const btnSettings = document.getElementById('btn-settings-toggle');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        if (btnSettings) {
            btnSettings.addEventListener('click', () => this.settingsDrawer.classList.toggle('open'));
        }
        if (btnCloseSettings) {
            btnCloseSettings.addEventListener('click', () => this.settingsDrawer.classList.remove('open'));
        }

        // Widget de Brújula Multieje -> Clic para resetear a posición inicial
        const compWidget = document.getElementById('orientation-widget');
        if (compWidget) {
            compWidget.addEventListener('click', () => {
                this.targetYaw = this.defaultYaw;
                this.targetPitch = this.defaultPitch;
                this.targetFov = this.defaultFov;
                this.showToast('Orientación restablecida');
            });
        }

        this.initCalibrationControls();
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
            }).catch(err => {
                this.logDebug(`Play prevent: ${err.message}`, 'warn');
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
        this.showToast(`Cargado: ${file.name}`);
    }

    takeSnapshot() {
        this.renderer.render(this.scene, this.camera);
        const dataURL = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `paisajes-andinos-captura-${Date.now()}.png`;
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

    showBuffering(text = 'Cargando 4K...') {
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
       PANEL DE DEBUG
       -------------------------------------------------------------------------- */
    initDebug() {
        const toggleBtn = document.getElementById('btn-debug-toggle');
        const closeBtn = document.getElementById('btn-close-debug');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.debugPanel.classList.toggle('hidden');
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.debugPanel.classList.add('hidden');
            });
        }

        const dbgPlay = document.getElementById('dbg-btn-play');
        if (dbgPlay) dbgPlay.addEventListener('click', () => this.playVideo());

        const dbgNext = document.getElementById('dbg-btn-next');
        if (dbgNext) dbgNext.addEventListener('click', () => this.transitionToNextSegment());

        const dbgProj = document.getElementById('dbg-btn-proj');
        if (dbgProj) {
            dbgProj.addEventListener('click', () => {
                this.config.projectionMode = this.config.projectionMode === 0 ? 1 : 0;
                this.domeMaterial.uniforms.uProjectionMode.value = this.config.projectionMode;
                const label = this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular';
                const span = document.querySelector('#btn-projection-toggle span');
                if (span) span.textContent = label;
                this.showToast(`Proyección: ${label}`);
            });
        }

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
Resolución: ${this.activeVideo ? `${this.activeVideo.videoWidth}x${this.activeVideo.videoHeight}` : 'N/A'}
Three.js Texture: ${this.activeTexture ? 'Activa' : 'Inactiva'}
Shader Mode: ${this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular'}`;
    }

    updateDebugPanel() {
        if (!this.debugPanel || this.debugPanel.classList.contains('hidden')) return;

        const isA = this.activeVideo === this.videoA;
        const elActive = document.getElementById('dbg-active-buffer');
        if (elActive) elActive.textContent = isA ? 'Video A' : 'Video B';

        const elReady = document.getElementById('dbg-ready-state');
        if (elReady && this.activeVideo) {
            elReady.textContent = READY_STATE_MAP[this.activeVideo.readyState] || `${this.activeVideo.readyState}`;
        }

        const elSeg = document.getElementById('dbg-segment');
        if (elSeg) {
            elSeg.textContent = `#${this.currentSegmentIndex + 1} / ${this.segments.length}`;
        }

        const elRes = document.getElementById('dbg-resolution');
        if (elRes && this.activeVideo) {
            elRes.textContent = `${this.activeVideo.videoWidth || 0}x${this.activeVideo.videoHeight || 0} px`;
        }

        const elTime = document.getElementById('dbg-time');
        if (elTime && this.activeVideo) {
            const seg = this.segments[this.currentSegmentIndex];
            const gTime = seg ? seg.start + this.activeVideo.currentTime : this.activeVideo.currentTime;
            elTime.textContent = `${this.activeVideo.currentTime.toFixed(1)}s / ${gTime.toFixed(1)}s`;
        }

        const elTex = document.getElementById('dbg-texture');
        if (elTex) elTex.textContent = `${this.currentFps} FPS`;

        const elBuf = document.getElementById('dbg-buffered');
        if (elBuf && this.activeVideo && this.activeVideo.buffered.length > 0) {
            const bufEnd = this.activeVideo.buffered.end(this.activeVideo.buffered.length - 1);
            elBuf.textContent = `${bufEnd.toFixed(1)}s`;
        }

        const elStby = document.getElementById('dbg-standby');
        if (elStby && this.standbyVideo) {
            const nextIdx = (this.currentSegmentIndex + 1) % this.segments.length;
            elStby.textContent = `Seg #${nextIdx + 1} (${READY_STATE_MAP[this.standbyVideo.readyState] || '0'})`;
        }
    }

    /* --------------------------------------------------------------------------
       EVENTOS DE RATÓN, TECLADO Y VENTANA
       -------------------------------------------------------------------------- */
    initEvents() {
        window.addEventListener('resize', () => this.onWindowResize());

        this.container.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('pointermove', (e) => this.onPointerMove(e));
        window.addEventListener('pointerup', () => this.onPointerUp());

        this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

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
            this.updateDebugPanel();
        }

        // Actualizar textura de video en WebGL SOLO cuando hay fotogramas válidos
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
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.targetYaw += keySpeed;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) this.targetYaw -= keySpeed;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) this.targetPitch = Math.min(89.9, this.targetPitch + keySpeed);
        if (this.keys['KeyS'] || this.keys['ArrowDown']) this.targetPitch = Math.max(-89.9, this.targetPitch - keySpeed);

        if (this.autoRotate && !this.isDragging) {
            this.targetYaw += this.autoRotateSpeed;
        }

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

        // Agujas de la brújula multieje
        const compassWidget = document.getElementById('orientation-widget');
        if (compassWidget) {
            const axisContainer = compassWidget.querySelector('.compass-multi-axis');
            if (axisContainer) {
                axisContainer.style.transform = `rotate(${-this.yaw}deg)`;
            }
        }

        // Renderizar escena 3D
        this.renderer.render(this.scene, this.camera);
    }
}

// Inicializar la aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
    window.app = new DomeViewer();
});
