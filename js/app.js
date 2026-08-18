/**
 * ==========================================================================
 * DOME 360° MASTER VIEWER - CONTROLADOR PRINCIPAL THREE.JS & REPRODUCTOR
 * ==========================================================================
 */

class DomeViewer {
    constructor() {
        // Elementos DOM
        this.container = document.getElementById('canvas-container');
        this.video = document.getElementById('dome-video');
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
        this.videoTexture = null;
        this.horizonGrid = null;

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
        this.autoRotateSpeed = 0.08;

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
        this.initVideo();
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

        // 4. Textura de Video
        this.videoTexture = new THREE.VideoTexture(this.video);
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;
        this.videoTexture.format = THREE.RGBAFormat;

        // 5. Material con Shader Fulldome
        const uniforms = THREE.UniformsUtils.clone(DomeShader.uniforms);
        uniforms.tVideo.value = this.videoTexture;
        uniforms.uAspect.value = 16 / 9;
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
        const ringGeo = new THREE.RingGeometry(595, 600, 96);
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
       CONTROL DEL ELEMENTO DE VIDEO
       -------------------------------------------------------------------------- */
    initVideo() {
        this.video.addEventListener('loadedmetadata', () => {
            if (this.video.videoWidth && this.video.videoHeight) {
                const aspect = this.video.videoWidth / this.video.videoHeight;
                this.domeMaterial.uniforms.uAspect.value = aspect;
            }
            this.updateTotalDuration();
            this.showToast(`Video cargado: ${this.video.videoWidth}x${this.video.videoHeight}px`);
        });

        this.video.addEventListener('timeupdate', () => {
            if (!this.isScrubbing) {
                this.updateTimeline();
            }
        });

        this.video.addEventListener('ended', () => {
            this.setPlayState(false);
        });

        this.video.addEventListener('error', () => {
            this.showToast('Nota: Usa "Cargar Video" o arrastra el archivo si el navegador bloquea la reproducción directa.', 6000);
        });
    }

    /* --------------------------------------------------------------------------
       EVENTOS DE RATÓN, TECLADO Y VENTANA
       -------------------------------------------------------------------------- */
    initEvents() {
        // Redimensión de ventana
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
                this.loadVideoFile(e.dataTransfer.files[0]);
            }
        });

        // Actividad de UI para auto-ocultar
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

        // Sensibilidad ajustada según FOV actual (más suave con zoom)
        const sensitivity = 0.18 * (this.fov / 75);

        this.targetYaw -= deltaX * sensitivity;
        this.targetPitch += deltaY * sensitivity;

        // Limitar pitch para no voltear la cámara (máx cenit 89.9°, mín nadir -89.9°)
        this.targetPitch = Math.max(-89.9, Math.min(89.9, this.targetPitch));

        this.previousMousePosition = { x: e.clientX, y: e.clientY };
    }

    onPointerUp() {
        this.isDragging = false;
    }

    onWheel(e) {
        e.preventDefault();
        const zoomDelta = e.deltaY * 0.05;
        this.targetFov = Math.max(25, Math.min(115, this.targetFov + zoomDelta));
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
        } else if (e.code === 'KeyR') {
            this.setPresetView('zenith');
        } else if (e.code === 'KeyH') {
            this.uiLayer.classList.toggle('ui-hidden');
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
       CONTROLES DE UI E INTERACCIÓN
       -------------------------------------------------------------------------- */
    initUI() {
        // Botón Entrar en Splash Screen
        document.getElementById('btn-enter').addEventListener('click', () => {
            this.splashScreen.classList.add('hidden');
            this.playVideo();
        });

        // Botón Play / Pausa
        const btnPlay = document.getElementById('btn-play-pause');
        btnPlay.addEventListener('click', () => this.togglePlay());

        // Botón Mute y Slider Volumen
        const btnMute = document.getElementById('btn-mute');
        const volumeSlider = document.getElementById('volume-slider');
        btnMute.addEventListener('click', () => this.toggleMute());
        volumeSlider.addEventListener('input', (e) => {
            this.video.volume = parseFloat(e.target.value);
            this.video.muted = (this.video.volume === 0);
            this.updateVolumeIcons();
        });

        // Botón Velocidad de Reproducción
        const btnSpeed = document.getElementById('btn-speed');
        btnSpeed.addEventListener('click', () => {
            this.speedIndex = (this.speedIndex + 1) % this.playbackSpeeds.length;
            const speed = this.playbackSpeeds[this.speedIndex];
            this.video.playbackRate = speed;
            btnSpeed.textContent = `${speed.toFixed(speed % 1 === 0 ? 1 : 2)}x`;
            this.showToast(`Velocidad: ${speed}x`);
        });

        // Botón Rotación Automática
        const btnAutoRotate = document.getElementById('btn-auto-rotate');
        btnAutoRotate.addEventListener('click', () => {
            this.autoRotate = !this.autoRotate;
            btnAutoRotate.classList.toggle('active', this.autoRotate);
            this.showToast(this.autoRotate ? 'Rotación automática: ON' : 'Rotación automática: OFF');
        });

        // Conmutador Semiesfera / Esfera Completa
        const btnToggleHemi = document.getElementById('btn-toggle-hemi');
        btnToggleHemi.addEventListener('click', () => {
            this.config.hemisphereOnly = !this.config.hemisphereOnly;
            this.domeMaterial.uniforms.uHemisphereOnly.value = this.config.hemisphereOnly ? 1.0 : 0.0;
            btnToggleHemi.classList.toggle('active', !this.config.hemisphereOnly);
            if (this.horizonGrid) this.horizonGrid.visible = this.config.hemisphereOnly;
            this.showToast(this.config.hemisphereOnly ? 'Modo: Semiesfera Superior (Domo)' : 'Modo: Esfera 360 Completa');
        });

        // Selector de Proyección (Fisheye Fulldome / Equirectangular)
        const btnProjection = document.getElementById('btn-projection-toggle');
        const projBadge = document.getElementById('projection-badge');
        btnProjection.addEventListener('click', () => {
            this.config.projectionMode = this.config.projectionMode === 0 ? 1 : 0;
            this.domeMaterial.uniforms.uProjectionMode.value = this.config.projectionMode;
            if (this.config.projectionMode === 0) {
                btnProjection.querySelector('span').textContent = 'Fisheye';
                projBadge.textContent = 'FULLDOME 180°';
                this.showToast('Proyección: Ojo de Pez (Fulldome Master)');
            } else {
                btnProjection.querySelector('span').textContent = 'Equirect';
                projBadge.textContent = 'EQUIRECTANGULAR 360°';
                this.showToast('Proyección: Equirectangular 360°');
            }
        });

        // Presets de Visión de Cámara
        document.querySelectorAll('.btn-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.setPresetView(e.target.dataset.view);
            });
        });

        // Brújula / Widget de Orientación (clic para volver al cenit)
        document.getElementById('orientation-widget').addEventListener('click', () => {
            this.setPresetView('zenith');
        });

        // Scrubber / Línea de Tiempo
        const timeline = document.getElementById('timeline-container');
        timeline.addEventListener('mousedown', (e) => this.startScrubbing(e));
        window.addEventListener('mousemove', (e) => {
            if (this.isScrubbing) this.scrub(e);
        });
        window.addEventListener('mouseup', () => {
            if (this.isScrubbing) this.isScrubbing = false;
        });

        // Cargar Archivo Local
        document.getElementById('btn-load-file').addEventListener('click', () => {
            this.fileInput.click();
        });
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.loadVideoFile(e.target.files[0]);
            }
        });

        // Captura de Pantalla
        document.getElementById('btn-snapshot').addEventListener('click', () => this.takeSnapshot());

        // Pantalla Completa
        document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());

        // Drawer de Calibración
        const btnSettings = document.getElementById('btn-settings-toggle');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        btnSettings.addEventListener('click', () => {
            this.settingsDrawer.classList.toggle('open');
            btnSettings.classList.toggle('active', this.settingsDrawer.classList.contains('open'));
        });
        btnCloseSettings.addEventListener('click', () => {
            this.settingsDrawer.classList.remove('open');
            btnSettings.classList.remove('active');
        });

        // Sliders de Calibración
        this.bindCalibrationSliders();
    }

    bindCalibrationSliders() {
        const sFov = document.getElementById('slider-dome-fov');
        const lFov = document.getElementById('lbl-dome-fov');
        sFov.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.domeFov = val;
            this.domeMaterial.uniforms.uDomeFov.value = (val * Math.PI) / 180;
            lFov.textContent = `${val}°`;
        });

        const sScale = document.getElementById('slider-scale');
        const lScale = document.getElementById('lbl-scale');
        sScale.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.scale = val;
            this.domeMaterial.uniforms.uScale.value = val;
            lScale.textContent = `${val.toFixed(2)}x`;
        });

        const sOffX = document.getElementById('slider-offset-x');
        const lOffX = document.getElementById('lbl-offset-x');
        sOffX.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.offsetX = val;
            this.domeMaterial.uniforms.uOffsetX.value = val;
            lOffX.textContent = val.toFixed(2);
        });

        const sOffY = document.getElementById('slider-offset-y');
        const lOffY = document.getElementById('lbl-offset-y');
        sOffY.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.offsetY = val;
            this.domeMaterial.uniforms.uOffsetY.value = val;
            lOffY.textContent = val.toFixed(2);
        });

        const sRot = document.getElementById('slider-rotation');
        const lRot = document.getElementById('lbl-rotation');
        sRot.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.rotation = val;
            this.domeMaterial.uniforms.uRotation.value = (val * Math.PI) / 180;
            lRot.textContent = `${val}°`;
        });

        const sExp = document.getElementById('slider-exposure');
        const lExp = document.getElementById('lbl-exposure');
        sExp.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            this.config.exposure = val;
            this.domeMaterial.uniforms.uExposure.value = val;
            lExp.textContent = `${val.toFixed(2)}x`;
        });

        document.getElementById('chk-flip-x').addEventListener('change', (e) => {
            this.config.flipX = e.target.checked;
            this.domeMaterial.uniforms.uFlipX.value = e.target.checked;
        });

        document.getElementById('chk-flip-y').addEventListener('change', (e) => {
            this.config.flipY = e.target.checked;
            this.domeMaterial.uniforms.uFlipY.value = e.target.checked;
        });

        document.getElementById('btn-reset-calibration').addEventListener('click', () => {
            sFov.value = 180; sFov.dispatchEvent(new Event('input'));
            sScale.value = 1.0; sScale.dispatchEvent(new Event('input'));
            sOffX.value = 0.0; sOffX.dispatchEvent(new Event('input'));
            sOffY.value = 0.0; sOffY.dispatchEvent(new Event('input'));
            sRot.value = 0; sRot.dispatchEvent(new Event('input'));
            sExp.value = 1.0; sExp.dispatchEvent(new Event('input'));
            document.getElementById('chk-flip-x').checked = false;
            document.getElementById('chk-flip-x').dispatchEvent(new Event('change'));
            document.getElementById('chk-flip-y').checked = false;
            document.getElementById('chk-flip-y').dispatchEvent(new Event('change'));
            this.showToast('Calibración restablecida');
        });
    }

    /* --------------------------------------------------------------------------
       ACCIONES DE REPRODUCCIÓN Y CONTROL
       -------------------------------------------------------------------------- */
    playVideo() {
        const playPromise = this.video.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.setPlayState(true);
            }).catch(err => {
                console.warn('Autoplay prevenido:', err);
                this.setPlayState(false);
            });
        }
    }

    pauseVideo() {
        this.video.pause();
        this.setPlayState(false);
    }

    togglePlay() {
        if (this.video.paused) {
            this.playVideo();
        } else {
            this.pauseVideo();
        }
    }

    setPlayState(playing) {
        this.isPlaying = playing;
        document.getElementById('icon-play').style.display = playing ? 'none' : 'block';
        document.getElementById('icon-pause').style.display = playing ? 'block' : 'none';
    }

    toggleMute() {
        this.video.muted = !this.video.muted;
        this.updateVolumeIcons();
    }

    updateVolumeIcons() {
        const isMuted = this.video.muted || this.video.volume === 0;
        document.getElementById('icon-volume').style.display = isMuted ? 'none' : 'block';
        document.getElementById('icon-mute').style.display = isMuted ? 'block' : 'none';
        if (!isMuted && this.video.volume === 0) {
            this.video.volume = 0.5;
            document.getElementById('volume-slider').value = 0.5;
        }
    }

    startScrubbing(e) {
        this.isScrubbing = true;
        this.scrub(e);
    }

    scrub(e) {
        const rect = document.getElementById('timeline-container').getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (isFinite(this.video.duration) && this.video.duration > 0) {
            this.video.currentTime = pos * this.video.duration;
            this.updateTimeline();
        }
    }

    updateTimeline() {
        if (!this.video.duration) return;
        const progress = (this.video.currentTime / this.video.duration) * 100;
        document.getElementById('timeline-progress').style.width = `${progress}%`;
        document.getElementById('timeline-handle').style.left = `${progress}%`;
        document.getElementById('time-current').textContent = this.formatTime(this.video.currentTime);

        // Buffer progress
        if (this.video.buffered.length > 0) {
            const buffered = (this.video.buffered.end(this.video.buffered.length - 1) / this.video.duration) * 100;
            document.getElementById('timeline-buffer').style.width = `${buffered}%`;
        }
    }

    updateTotalDuration() {
        if (this.video.duration) {
            document.getElementById('time-total').textContent = this.formatTime(this.video.duration);
        }
    }

    formatTime(sec) {
        const mins = Math.floor(sec / 60);
        const secs = Math.floor(sec % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    loadVideoFile(file) {
        const url = URL.createObjectURL(file);
        this.video.src = url;
        this.video.load();
        this.playVideo();
        document.getElementById('file-name-badge').textContent = file.name;
        this.showToast(`Cargado: ${file.name}`);
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
        this.uiLayer.classList.remove('ui-hidden');
        clearTimeout(this.uiTimeout);
        this.uiTimeout = setTimeout(() => {
            if (!this.settingsDrawer.classList.contains('open') && this.isPlaying) {
                this.uiLayer.classList.add('ui-hidden');
            }
        }, 4000);
    }

    showToast(message, duration = 3000) {
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

        // 1. Manejo de Teclado (WASD / Flechas)
        const keySpeed = 1.2;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) this.targetYaw += keySpeed;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) this.targetYaw -= keySpeed;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) this.targetPitch = Math.min(89.9, this.targetPitch + keySpeed);
        if (this.keys['KeyS'] || this.keys['ArrowDown']) this.targetPitch = Math.max(-89.9, this.targetPitch - keySpeed);

        // 2. Rotación automática
        if (this.autoRotate && !this.isDragging) {
            this.targetYaw += this.autoRotateSpeed;
        }

        // 3. Suavizado inercial (Lerp Damping)
        this.yaw += (this.targetYaw - this.yaw) * this.damping;
        this.pitch += (this.targetPitch - this.pitch) * this.damping;
        this.fov += (this.targetFov - this.fov) * this.damping;

        // Actualizar FOV de la cámara
        if (Math.abs(this.camera.fov - this.fov) > 0.01) {
            this.camera.fov = this.fov;
            this.camera.updateProjectionMatrix();
        }

        // 4. Calcular vector de dirección de la cámara (Coordenadas esféricas)
        const phi = THREE.MathUtils.degToRad(90 - this.pitch);
        const theta = THREE.MathUtils.degToRad(this.yaw);

        const targetX = 500 * Math.sin(phi) * Math.sin(theta);
        const targetY = 500 * Math.cos(phi);
        const targetZ = 500 * Math.sin(phi) * Math.cos(theta);

        this.camera.lookAt(targetX, targetY, targetZ);

        // 5. Actualizar aguja de la brújula
        const needle = document.getElementById('compass-needle');
        if (needle) {
            needle.style.transform = `rotate(${-this.yaw}deg)`;
        }

        // 6. Renderizar escena
        this.renderer.render(this.scene, this.camera);
    }
}

// Inicializar la aplicación al cargar el DOM
window.addEventListener('DOMContentLoaded', () => {
    window.app = new DomeViewer();
});
