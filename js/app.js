/**
 * ==========================================================================
 * DOME 360° MASTER VIEWER - CONTROLADOR PRINCIPAL THREE.JS & REPRODUCTOR
 * CON SOPORTE PARA SEGMENTACIÓN 4K CONTINUA, DOBLE BÚFER Y PANEL DE DEBUG
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
        this.standbyLoaded = false;

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

        // Diagnóstico / Debug
        this.debugLogs = [];
        this.frameCount = 0;
        this.lastFpsUpdate = performance.now();
        this.currentFps = 60;
        this.pipActive = false;

        // Inicialización
        this.initThree();
        this.initSegmentEngine();
        this.initEvents();
        this.initUI();
        this.initDebug();
        this.animate();

        this.logDebug('Visor 360 inicializado correctamente', 'success');
    }

    /* --------------------------------------------------------------------------
       INICIALIZACIÓN THREE.JS
       -------------------------------------------------------------------------- */
    initThree() {
        // 1. Escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05070c);

        // 2. Cámara
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

        // 5. Material con Shader Fulldome
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

        // 6. Geometría de Domo / Esfera
        const domeGeometry = new THREE.SphereGeometry(600, 96, 96);
        this.domeMesh = new THREE.Mesh(domeGeometry, this.domeMaterial);
        this.scene.add(this.domeMesh);

        // 7. Rejilla de Horizonte
        this.createHorizonMarkers();
    }

    createHorizonMarkers() {
        const horizonGroup = new THREE.Group();

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
                    this.segments = data.map(item => ({
                        ...item,
                        file: item.file.replace(/\\/g, '/')
                    }));
                    this.totalDuration = this.segments[this.segments.length - 1].end;
                    this.updateTotalDuration();
                    this.logDebug(`Manifest cargado: ${this.segments.length} segmentos (Duración total: ${this.totalDuration.toFixed(1)}s)`, 'info');
                }
            })
            .catch((err) => {
                this.logDebug(`Uso de lista por defecto (${this.segments.length} segmentos)`, 'info');
            });

        this.setupVideoEvents(this.videoA, 'Video A');
        this.setupVideoEvents(this.videoB, 'Video B');

        // Cargar primer segmento en Video A con prioridad
        this.videoA.src = this.segments[0].file;
        this.videoA.load();
        this.logDebug(`Cargando segmento inicial: ${this.segments[0].file}`, 'info');

        this.updateTotalDuration();
    }

    setupVideoEvents(videoEl, name) {
        videoEl.addEventListener('loadstart', () => {
            this.logDebug(`[${name}] loadstart: ${videoEl.src.split('/').pop()}`, 'info');
        });

        videoEl.addEventListener('loadedmetadata', () => {
            this.logDebug(`[${name}] loadedmetadata: ${videoEl.videoWidth}x${videoEl.videoHeight} (${videoEl.duration.toFixed(1)}s)`, 'success');
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
        });

        videoEl.addEventListener('timeupdate', () => {
            if (videoEl === this.activeVideo && !this.isScrubbing) {
                this.onActiveTimeUpdate();
            }
        });

        videoEl.addEventListener('ended', () => {
            this.logDebug(`[${name}] ended (fin del segmento)`, 'info');
            if (videoEl === this.activeVideo) {
                this.transitionToNextSegment();
            }
        });

        videoEl.addEventListener('play', () => {
            this.logDebug(`[${name}] play iniciado`, 'info');
            if (videoEl === this.activeVideo) {
                this.setPlayState(true);
                this.hideBuffering();

                // Precarga inteligente en segundo plano
                if (!this.standbyLoaded && this.segments.length > 1) {
                    this.standbyVideo.src = this.segments[1].file;
                    this.standbyVideo.load();
                    this.standbyLoaded = true;
                    this.logDebug(`[Standby] Precargando segmento 1`, 'info');
                }
            }
        });

        videoEl.addEventListener('playing', () => {
            this.logDebug(`[${name}] playing (reproduciendo fluido)`, 'success');
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
            this.logDebug(`[${name}] waiting (esperando buffer de red)`, 'warn');
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.showBuffering('Cargando 4K...');
            }
        });

        videoEl.addEventListener('canplay', () => {
            if (videoEl === this.activeVideo && this.isPlaying) {
                this.hideBuffering();
            }
        });

        videoEl.addEventListener('error', (e) => {
            const errCode = videoEl.error ? videoEl.error.code : 'Desconocido';
            const errMsg = videoEl.error ? videoEl.error.message : '';
            this.logDebug(`[${name}] ERROR (código: ${errCode}) ${errMsg}`, 'error');
            if (videoEl === this.activeVideo) {
                this.hideBuffering();
                this.showToast(`Error al cargar segmento (Código ${errCode}).`, 5000);
            }
        });
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

    onActiveTimeUpdate() {
        const seg = this.segments[this.currentSegmentIndex];
        if (!seg) return;

        const globalTime = seg.start + this.activeVideo.currentTime;
        this.updateTimelineWithTime(globalTime);

        // Precargar siguiente segmento en standby si aún no se cargó
        const nextIndex = (this.currentSegmentIndex + 1) % this.segments.length;
        if (!this.standbyVideo.src || this.standbyVideo.src.indexOf(this.segments[nextIndex].file) === -1) {
            this.standbyVideo.src = this.segments[nextIndex].file;
            this.standbyVideo.load();
        }

        // Transición suave justo antes de terminar
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
        this.logDebug(`Transición a Segmento #${nextIndex} (${this.segments[nextIndex].file})`, 'info');

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
                playProm.catch(e => this.logDebug(`Play transition catch: ${e.message}`, 'warn'));
            }
        }

        // Precargar subsiguiente en standby
        const futureIndex = (nextIndex + 1) % this.segments.length;
        this.standbyVideo.src = this.segments[futureIndex].file;
        this.standbyVideo.load();

        if (this.pipActive) this.updatePipPreview();

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

        this.showBuffering('Saltando...');
        this.logDebug(`Buscando ${targetTime.toFixed(1)}s -> Segmento #${targetIndex} (offset: ${offsetInSegment.toFixed(1)}s)`, 'info');

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

    /* --------------------------------------------------------------------------
       PANEL DE DIAGNÓSTICO Y DEBUG
       -------------------------------------------------------------------------- */
    initDebug() {
        const toggleBtn = document.getElementById('btn-debug-toggle');
        const closeBtn = document.getElementById('btn-close-debug');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.debugPanel.classList.toggle('hidden');
                if (!this.debugPanel.classList.contains('hidden')) {
                    this.showToast('Panel de Diagnóstico abierto');
                }
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.debugPanel.classList.add('hidden');
            });
        }

        // Botones de acción debug
        const dbgPlay = document.getElementById('dbg-btn-play');
        if (dbgPlay) {
            dbgPlay.addEventListener('click', () => {
                this.logDebug('Forzando play desde panel de debug', 'info');
                this.playVideo();
            });
        }

        const dbgNext = document.getElementById('dbg-btn-next');
        if (dbgNext) {
            dbgNext.addEventListener('click', () => {
                this.logDebug('Saltando manualmente al siguiente segmento', 'info');
                this.transitionToNextSegment();
            });
        }

        const dbgProj = document.getElementById('dbg-btn-proj');
        if (dbgProj) {
            dbgProj.addEventListener('click', () => {
                this.config.projectionMode = this.config.projectionMode === 0 ? 1 : 0;
                this.domeMaterial.uniforms.uProjectionMode.value = this.config.projectionMode;
                const label = this.config.projectionMode === 0 ? 'Fisheye Fulldome' : 'Equirectangular 360';
                this.logDebug(`Modo cambiado a: ${label}`, 'info');
                this.showToast(`Proyección: ${label}`);
                const span = document.querySelector('#btn-projection-toggle span');
                if (span) span.textContent = this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular';
                const badge = document.getElementById('projection-badge');
                if (badge) badge.textContent = this.config.projectionMode === 0 ? 'FULLDOME 180°' : 'ESFERA 360°';
            });
        }

        const dbgPip = document.getElementById('dbg-btn-pip');
        if (dbgPip) {
            dbgPip.addEventListener('click', () => {
                this.pipActive = !this.pipActive;
                const container = document.getElementById('debug-pip-container');
                if (container) container.classList.toggle('hidden', !this.pipActive);
                this.updatePipPreview();
                this.logDebug(`Mini preview de video: ${this.pipActive ? 'ACTIVADO' : 'DESACTIVADO'}`, 'info');
            });
        }

        const dbgCopy = document.getElementById('dbg-btn-copy');
        if (dbgCopy) {
            dbgCopy.addEventListener('click', () => {
                const report = this.generateDiagnosticReport();
                navigator.clipboard.writeText(report).then(() => {
                    this.showToast('Informe copiado al portapapeles');
                }).catch(() => {
                    this.showToast('No se pudo copiar el informe');
                });
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
        return `=== INFORME DE DIAGNÓSTICO VISOR 360 ===
Fecha: ${new Date().toISOString()}
Navegador: ${navigator.userAgent}
URL: ${window.location.href}
FPS: ${this.currentFps}
Buffer Activo: ${this.activeVideo === this.videoA ? 'Video A' : 'Video B'}
Active readyState: ${this.activeVideo ? READY_STATE_MAP[this.activeVideo.readyState] : 'null'}
Active currentTime: ${this.activeVideo ? this.activeVideo.currentTime.toFixed(2) : 0}s
Active videoWidth x Height: ${this.activeVideo ? `${this.activeVideo.videoWidth}x${this.activeVideo.videoHeight}` : 'N/A'}
Active src: ${this.activeVideo ? this.activeVideo.src : 'N/A'}
Segmento Actual: #${this.currentSegmentIndex} (${seg.file || 'N/A'})
Duración Total: ${this.totalDuration.toFixed(2)}s
Three.js Texture: ${this.activeTexture ? 'Activa' : 'Inactiva'}
Shader Mode: ${this.config.projectionMode === 0 ? 'Fisheye' : 'Equirectangular'}
WebGL Renderer: ${this.renderer ? this.renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1' : 'N/A'}

--- Últimos Eventos ---
${this.debugLogs.map(l => `[${l.time}] [${l.type}] ${l.message}`).join('\n')}
=========================================`;
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
            elSeg.textContent = `#${this.currentSegmentIndex + 1} / ${this.segments.length} (${this.segments[this.currentSegmentIndex]?.file.split('/').pop()})`;
        }

        const elRes = document.getElementById('dbg-resolution');
        if (elRes && this.activeVideo) {
            elRes.textContent = `${this.activeVideo.videoWidth || 0}x${this.activeVideo.videoHeight || 0} px`;
        }

        const elTime = document.getElementById('dbg-time');
        if (elTime && this.activeVideo) {
            const seg = this.segments[this.currentSegmentIndex];
            const gTime = seg ? seg.start + this.activeVideo.currentTime : this.activeVideo.currentTime;
            elTime.textContent = `${this.activeVideo.currentTime.toFixed(1)}s / ${gTime.toFixed(1)}s (${this.totalDuration.toFixed(1)}s)`;
        }

        const elTex = document.getElementById('dbg-texture');
        if (elTex) {
            elTex.textContent = `${this.currentFps} FPS (Texture OK)`;
        }

        const elBuf = document.getElementById('dbg-buffered');
        if (elBuf && this.activeVideo && this.activeVideo.buffered.length > 0) {
            const bufEnd = this.activeVideo.buffered.end(this.activeVideo.buffered.length - 1);
            elBuf.textContent = `${bufEnd.toFixed(1)}s buffer`;
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
        } else if (e.code === 'KeyD') {
            if (this.debugPanel) this.debugPanel.classList.toggle('hidden');
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
    enterExperience() {
        if (this.splashScreen) {
            this.splashScreen.classList.add('hidden');
            this.splashScreen.style.display = 'none';
        }
        this.showBuffering('Iniciando 4K...');
        this.playVideo();
    }

    initUI() {
        const btnStart = document.getElementById('btn-enter') || document.getElementById('btn-start-experience');
        if (btnStart) {
            btnStart.addEventListener('click', (e) => {
                if (e) e.stopPropagation();
                this.enterExperience();
            });
        }

        if (this.splashScreen) {
            this.splashScreen.addEventListener('click', (e) => {
                if (e.target === this.splashScreen) {
                    this.enterExperience();
                }
            });
        }

        const playBtn = document.getElementById('btn-play-pause') || document.getElementById('btn-play');
        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePlay();
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

        const autoRotBtn = document.getElementById('btn-auto-rotate');
        if (autoRotBtn) {
            autoRotBtn.addEventListener('click', () => {
                this.autoRotate = !this.autoRotate;
                autoRotBtn.classList.toggle('active', this.autoRotate);
                this.showToast(this.autoRotate ? 'Auto-rotación activada' : 'Auto-rotación desactivada');
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
                document.getElementById('projection-badge').textContent = this.config.projectionMode === 0 ? 'FULLDOME 180°' : 'ESFERA 360°';
                this.showToast(`Proyección: ${label}`);
            });
        }

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
        if (btnFullscreen) btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

        const btnSettings = document.getElementById('btn-settings-toggle');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        if (btnSettings) {
            btnSettings.addEventListener('click', () => this.settingsDrawer.classList.toggle('open'));
        }
        if (btnCloseSettings) {
            btnCloseSettings.addEventListener('click', () => this.settingsDrawer.classList.remove('open'));
        }

        this.initCalibrationControls();

        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const preset = e.currentTarget.dataset.view;
                this.setPresetView(preset);
                this.showToast(`Vista: ${preset.toUpperCase()}`);
            });
        });

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

        this.isPlaying = true;
        this.setPlayState(true);

        const playPromise = this.activeVideo.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.setPlayState(true);
                this.hideBuffering();
                this.logDebug('playPromise resuelto con éxito', 'success');
            }).catch(err => {
                this.logDebug(`Autoplay prevenido por navegador: ${err.message}`, 'warn');
                this.activeVideo.muted = true;
                this.videoA.muted = true;
                this.videoB.muted = true;
                this.activeVideo.play().then(() => {
                    this.setPlayState(true);
                    this.hideBuffering();
                    this.updateVolumeIcons();
                    this.showToast('Reproduciendo en silencio. Clic en altavoz para sonido.', 4000);
                }).catch(e => {
                    this.logDebug(`Error crítico en play: ${e.message}`, 'error');
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
        this.logDebug(`Audio: ${isMuted ? 'SILENCIADO' : 'ACTIVADO'}`, 'info');
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
        this.logDebug(`Archivo local cargado: ${file.name}`, 'success');
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
            if (!this.settingsDrawer.classList.contains('open') && (!this.debugPanel || this.debugPanel.classList.contains('hidden')) && this.isPlaying) {
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

        // Medir FPS
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsUpdate >= 500) {
            this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
            this.frameCount = 0;
            this.lastFpsUpdate = now;
            this.updateDebugPanel();
        }

        // 1. Forzar actualización continua de textura de video en WebGL
        if (this.activeTexture) {
            this.activeTexture.needsUpdate = true;
        }
        if (this.domeMaterial && this.domeMaterial.uniforms && this.domeMaterial.uniforms.tVideo) {
            this.domeMaterial.uniforms.tVideo.value = this.activeTexture;
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
