/**
 * DomeShader - Shader especializado para proyección Fulldome / Ojo de Pez (Fisheye) en Three.js
 * Soporta proyección de video Dome Master circular sobre semiesfera interior o esfera completa.
 */

const DomeShader = {
    uniforms: {
        tVideo: { value: null },
        uAspect: { value: 1.0 },          // Relación de aspecto del video (ancho / alto)
        uDomeFov: { value: Math.PI },     // Ángulo total del domo (180° = PI rad, 220° = 1.22 * PI)
        uScale: { value: 1.0 },           // Escala / Zoom del círculo fisheye
        uOffsetX: { value: 0.0 },         // Desplazamiento horizontal del centro óptico
        uOffsetY: { value: 0.0 },         // Desplazamiento vertical del centro óptico
        uRotation: { value: 0.0 },        // Rotación azimutal (radianes)
        uFlipX: { value: false },         // Invertir horizontalmente
        uFlipY: { value: false },         // Invertir verticalmente
        uProjectionMode: { value: 0 },    // 0: Fisheye Fulldome, 1: Equirectangular 360
        uFadeHorizon: { value: 0.08 },    // Suavizado en el borde del horizonte
        uExposure: { value: 1.0 },        // Exposición / Brillo
        uHemisphereOnly: { value: 0.0 }   // 1.0: Semiesfera superior, 0.0: Esfera completa
    },

    vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;

        void main() {
            vNormal = normal;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,

    fragmentShader: `
        uniform sampler2D tVideo;
        uniform float uAspect;
        uniform float uDomeFov;
        uniform float uScale;
        uniform float uOffsetX;
        uniform float uOffsetY;
        uniform float uRotation;
        uniform bool uFlipX;
        uniform bool uFlipY;
        uniform int uProjectionMode;
        uniform float uFadeHorizon;
        uniform float uExposure;
        uniform float uHemisphereOnly;

        varying vec3 vWorldPosition;
        varying vec3 vNormal;

        const float PI = 3.14159265358979323846;
        const float TWO_PI = 6.28318530717958647692;

        void main() {
            // Dirección normalizada desde el centro (0,0,0) hacia la superficie interior
            vec3 dir = normalize(vWorldPosition);

            // Si está configurado solo semiesfera y estamos bajo el horizonte, piso sutil
            if (uHemisphereOnly > 0.5 && dir.y < -0.05) {
                float grid = step(0.95, fract(dir.x * 8.0)) + step(0.95, fract(dir.z * 8.0));
                gl_FragColor = vec4(vec3(0.04) + vec3(0.01, 0.04, 0.06) * grid, 1.0);
                return;
            }

            vec2 uv = vec2(0.5);

            if (uProjectionMode == 0) {
                // MODO 0: FISHEYE FULLDOME (DOME MASTER)
                // Zenith = +Y (arriba). Ángulo polar theta desde el cenit:
                float rXZ = length(dir.xz);
                float theta = atan(rXZ, max(dir.y, -1.0)); // 0 en cenit, PI/2 en horizonte

                // Azimut phi en el plano XZ (+ rotación azimutal)
                float phi = atan(dir.z, dir.x) + uRotation;

                // Radio normalizado en el domo (1.0 = borde del domo según uDomeFov)
                float maxAngle = max(0.001, uDomeFov * 0.5);
                float rho = theta / maxAngle;

                // Convertir coordenadas polares (rho, phi) a coordenadas UV cartesianas
                float uComp = (uAspect > 1.0) ? (1.0 / uAspect) : 1.0;
                float vComp = (uAspect < 1.0) ? uAspect : 1.0;

                float uCoord = 0.5 + uOffsetX + (0.5 * rho * cos(phi) * uScale * uComp);
                float vCoord = 0.5 + uOffsetY + (0.5 * rho * sin(phi) * uScale * vComp);

                if (uFlipX) uCoord = 1.0 - uCoord;
                if (uFlipY) vCoord = 1.0 - vCoord;

                uv = vec2(uCoord, vCoord);

                // Si está fuera de los límites de la textura de video
                if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                    gl_FragColor = vec4(0.02, 0.03, 0.05, 1.0);
                    return;
                }

                vec4 sampledColor = texture2D(tVideo, uv);
                vec3 finalRgb = sampledColor.rgb * uExposure;

                // Suavizado elegante si se pasa del ángulo de domo
                if (rho > 1.0) {
                    float fade = 1.0 - smoothstep(1.0, 1.0 + uFadeHorizon, rho);
                    finalRgb *= fade;
                }

                // SIEMPRE FORZAR ALPHA = 1.0 para evitar transparencia invisible
                gl_FragColor = vec4(finalRgb, 1.0);

            } else {
                // MODO 1: EQUIRECTANGULAR 360 TRADICIONAL (Lat-Long Esférico)
                float phi = atan(dir.z, dir.x) + uRotation;
                float theta = acos(clamp(dir.y, -1.0, 1.0));

                float uCoord = (phi + PI) / TWO_PI;
                float vCoord = 1.0 - (theta / PI);

                if (uFlipX) uCoord = 1.0 - uCoord;
                if (uFlipY) vCoord = 1.0 - vCoord;

                uv = vec2(fract(uCoord + uOffsetX), clamp(vCoord + uOffsetY, 0.0, 1.0));
                vec4 sampledColor = texture2D(tVideo, uv);

                // SIEMPRE FORZAR ALPHA = 1.0
                gl_FragColor = vec4(sampledColor.rgb * uExposure, 1.0);
            }
        }
    `
};

window.DomeShader = DomeShader;
