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
        this.dropzone = document.getElementById('dropzone');
        this.toastContainer = document.getElementById('toast-container');
        this.bufferingSpinner = document.getElementById('buffering-spinner');
        this.bufferingText = document.getElementById('buffering-text');
        this.debugPanel = document.getElementById('debug-panel');
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

        // Estado del Motor de Segmentos (Doble Búfer Ping-Pong)
        this.isSegmentedMode = true;
        this.segments = [...DEFAULT_SEGMENTS];
        this.currentSegmentIndex = 0;
        this.activeVideo = this.videoA;
        this.standbyVideo = this.videoB;
        this.totalDuration = this.segments[this.segments.length - 1].end;
        this.isTransitioning = false;
        this.engineInitialized = false;

        // Posición Inicial Solicitada:
        // Menos zoom (FOV = 95°), más rotado hacia arriba (Pitch = 50°), mirando entre frente e izquierda (Yaw = 45°)
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
        this.previousMousePosition = { x: 0, y: 0 };
        this.damping = 0.08;

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

        // Diagnóstico / Debug
        this.debugLogs = [];
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.currentFps = 60;
        this.pipActive = false;

        // 1. Inicializar Three.js, UI y Gatekeeper
        this.initThree();
        this.initEvents();
        this.initUI();
        this.initDebug();
        this.initGatekeeper();
        this.animate();

        this.logDebug('Visor 360 inicializado correctamente', 'success');
    }

    /* --------------------------------------------------------------------------
       PUERTA DE ENTRADA Y AHORRO DE DATOS (CERO DESCARGAS PREVIAS)
       -------------------------------------------------------------------------- */
    initGatekeeper() {
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
            if (this.dataWarningModal) this.dataWarningModal.classList.remove('hidden');
            if (this.splashScreen) this.splashScreen.classList.add('hidden');
            this.logDebug('Conexión de datos móviles detectada: Mostrando aviso', 'warn');
        } else {
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
                    this.logDebug(`Manifest cargado: ${this.segments.length} segmentos`, 'info');
                }
            })
            .catch(() => {
                this.logDebug(`Uso de manifest predeterminado (${this.segments.length} segmentos)`, 'info');
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

        const domeGeometry = new THREE.SphereGeometry(600, 96, 96);
        this.domeMesh = new THREE.Mesh(domeGeometry, this.domeMaterial);
        this.scene.add(this.domeMesh);
    }

    /* --------------------------------------------------------------------------
       ENTRADA A LA EXPERIENCIA Y GAPLESS PING-PONG PLAYBACK
       -------------------------------------------------------------------------- */
    enterExperience() {
        if (this.splashScreen) {
            this.splashScreen.classList.add('hidden');
            setTimeout(() => {
                this.splashScreen.style.display = 'none';
            }, 700);
        }

        // Fade in inicial de 4 segundos en la interfaz
        if (this.uiLayer) {
            this.uiLayer.classList.add('initial-fadein');
        }

        this.showBuffering('Iniciando 4K...');
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

                // Precargar inmediatamente el segmento 1 en standby
                if (this.segments.length > 1) {
                    this.videoB.src = this.segments[1].file;
                    this.videoB.preload = "auto";
                    this.videoB.load();
                }
            }).catch(err => {
                this.logDebug(`Play prevent: ${err.message}`, 'warn');
                this.videoA.muted = true;
                this.videoB.muted = true;
                this.videoA.play().then(() => {
                    this.setPlayState(true);
                    this.hideBuffering();
                    this.updateVolumeIcons();
                    this.showToast('Audio silenciado por navegador. Clic en volumen para sonido.', 4000);
                }).catch(() => {
                    this.setPlayState(false);
                    this.hideBuffering();
                });
            });
        }
    }

    setupVideoEvents(videoEl, name) {
        videoEl.addEventListener('loadedmetadata', () => {
            this.logDebug(`[${name}] metadata: ${videoEl.videoWidth}x${videoEl.videoHeight}`, 'success');
            if (videoEl === this.activeVideo) {
                this.updateTotalDuration();
            }
        });

        videoEl.addEventListener('loadeddata', () => {
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

        videoEl.addEventListener('waiting', () => {
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.showBuffering('Cargando 4K...');
            }
        });

        videoEl.addEventListener('canplay', () => {
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.hideBuffering();
            }
        });
    }

    onActiveTimeUpdate() {
        const seg = this.segments[this.currentSegmentIndex];
        if (!seg) return;

        const globalTime = seg.start + this.activeVideo.currentTime;
        this.updateTimelineWithTime(globalTime);

        // Precargar el siguiente segmento en standby
        const nextIndex = (this.currentSegmentIndex + 1) % this.segments.length;
        if (!this.standbyVideo.src || this.standbyVideo.src.indexOf(this.segments[nextIndex].file) === -1) {
            this.standbyVideo.src = this.segments[nextIndex].file;
            this.standbyVideo.preload = "auto";
            this.standbyVideo.load();
        }

        // Transición anticipada continua para evitar cualquier congelamiento
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
        this.logDebug(`Conmutando a segmento #${nextIndex + 1} (${this.segments[nextIndex].file})`, 'info');

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

        // Precargar el subsiguiente en standby
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

        this.showBuffering('Saltando...');
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
        }

        const btnSnapshotBottom = document.getElementById('btn-snapshot-bottom');
        if (btnSnapshotBottom) btnSnapshotBottom.addEventListener('click', () => this.takeSnapshot());

        const btnFullscreenBottom = document.getElementById('btn-fullscreen-bottom');
        if (btnFullscreenBottom) btnFullscreenBottom.addEventListener('click', () => this.toggleFullscreen());

        // Widget Esfera 360° -> Clic para resetear a la posición inicial
        const sphereWidget = document.getElementById('orientation-widget');
        if (sphereWidget) {
            sphereWidget.addEventListener('click', () => {
                this.targetYaw = this.defaultYaw;
                this.targetPitch = this.defaultPitch;
                this.targetFov = this.defaultFov;
                this.showToast('Vista reorientada al origen');
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
        this.showToast('Captura guardada en descargas');
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
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

        const dbgProj = document.getElementById('dbg-btn-proj');
        if (dbgProj) {
            dbgProj.addEventListener('click', () => {
                this.config.projectionMode = this.config.projectionMode === 0 ? 1 : 0;
                this.domeMaterial.uniforms.uProjectionMode.value = this.config.projectionMode;
                this.showToast(`Proyección: ${this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular'}`);
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
Segmento: #${this.currentSegmentIndex + 1} (${seg.file || 'N/A'}`;
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
       EVENTOS DE NAVEGACIÓN Y RATÓN (DIRECCIÓN NATURAL DIRECTA)
       -------------------------------------------------------------------------- */
    initEvents() {
        window.addEventListener('resize', () => this.onWindowResize());

        this.container.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('pointermove', (e) => this.onPointerMove(e));
        window.addEventListener('pointerup', () => this.onPointerUp());

        this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
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

        // NAVEGACIÓN DIRECTA (PARA DONDE SE MUEVE EL RATÓN):
        // Arriba/Abajo: mover ratón arriba mira arriba, mover abajo mira abajo (-deltaY)
        // Izquierda/Derecha: mover ratón izquierda mira izquierda, mover derecha mira derecha (-deltaX)
        this.targetYaw -= deltaX * sensitivity;
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
