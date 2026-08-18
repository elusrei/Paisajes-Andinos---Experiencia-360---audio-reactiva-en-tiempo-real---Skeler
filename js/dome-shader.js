/**
 * DomeShader - Shader de Alta Fidelidad para Proyección Fulldome / Fisheye y Esfera 360°
 * Con desvanecimiento suave en el horizonte sin estiramiento de textura hacia el nadir.
 */

const DomeShader = {
    uniforms: {
        tVideo: { value: null },
        uAspect: { value: 1.0 },
        uDomeFov: { value: Math.PI },     // 180° = PI
        uScale: { value: 1.0 },
        uOffsetX: { value: 0.0 },
        uOffsetY: { value: 0.0 },
        uRotation: { value: 0.0 },
        uFlipX: { value: false },
        uFlipY: { value: false },
        uProjectionMode: { value: 0 },    // 0: Fisheye Fulldome, 1: Equirectangular 360
        uExposure: { value: 1.0 },
        uHemisphereOnly: { value: 0.0 }
    },

    vertexShader: `
        varying vec3 vWorldPosition;

        void main() {
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
        uniform float uExposure;
        uniform float uHemisphereOnly;

        varying vec3 vWorldPosition;

        const float PI = 3.14159265358979323846;
        const float TWO_PI = 6.28318530717958647692;

        void main() {
            vec3 dir = normalize(vWorldPosition);
            vec2 uv = vec2(0.5);

            if (uProjectionMode == 0) {
                // ==========================================================
                // MODO 0: FULLDOME FISHEYE (Ojo de Pez Circular de Cúpula)
                // ==========================================================
                float rXZ = length(dir.xz);
                float theta = atan(rXZ, dir.y); // 0 en cenit (+Y), PI/2 en horizonte, PI en nadir
                float phi = atan(dir.z, dir.x) + uRotation;

                float maxAngle = max(0.1, uDomeFov * 0.5);
                float rho = theta / maxAngle;

                // Fuera del horizonte del domo: desvanecer limpiamente a negro sin estirar textura
                if (rho > 1.02) {
                    gl_FragColor = vec4(0.015, 0.018, 0.025, 1.0);
                    return;
                }

                float uCoord = 0.5 + uOffsetX + (0.5 * rho * cos(phi) * uScale);
                float vCoord = 0.5 + uOffsetY + (0.5 * rho * sin(phi) * uScale);

                if (uFlipX) uCoord = 1.0 - uCoord;
                if (uFlipY) vCoord = 1.0 - vCoord;

                uv = clamp(vec2(uCoord, vCoord), 0.0, 1.0);

                vec4 texColor = texture2D(tVideo, uv);
                vec3 finalRgb = texColor.rgb * uExposure;

                // Suavizado elegante en el borde exacto del domo
                if (rho > 0.96) {
                    float fade = 1.0 - smoothstep(0.96, 1.02, rho);
                    finalRgb = mix(vec3(0.015, 0.018, 0.025), finalRgb, fade);
                }

                gl_FragColor = vec4(finalRgb, 1.0);

            } else {
                // ==========================================================
                // MODO 1: EQUIRECTANGULAR 360 (Lat-Long Esférico Completo)
                // ==========================================================
                float phi = atan(dir.z, dir.x) + uRotation;
                float theta = acos(clamp(dir.y, -1.0, 1.0));

                float uCoord = (phi + PI) / TWO_PI;
                float vCoord = 1.0 - (theta / PI);

                if (uFlipX) uCoord = 1.0 - uCoord;
                if (uFlipY) vCoord = 1.0 - vCoord;

                uv = vec2(fract(uCoord + uOffsetX), clamp(vCoord + uOffsetY, 0.0, 1.0));

                vec4 texColor = texture2D(tVideo, uv);
                gl_FragColor = vec4(texColor.rgb * uExposure, 1.0);
            }
        }
    `
};

window.DomeShader = DomeShader;
