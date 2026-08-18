# 🌐 Visor Web Interactivo 360° Fulldome / Fisheye

Visor web inmersivo de alto rendimiento desarrollado con **Three.js** y **Vanilla JavaScript / CSS** para visualizar y navegar desde el interior de una semiesfera (domo superior) videos exportados con deformación circular de ojo de pez (*Fisheye / Dome Master*), configurado con el video `Paisajes andinos, Elián.mp4`.

---

## 🚀 Publicar en GitHub Pages

Para publicar tu visor web y que cualquiera pueda visitarlo en internet:
1. Ejecuta haciendo doble clic en el archivo **`subir_a_github.cmd`**.
2. Sigue las instrucciones en pantalla para ingresar la URL de tu repositorio en GitHub.
3. Activa GitHub Pages en la sección **Settings > Pages** de tu repositorio.

---

## 💻 Cómo Probar el Proyecto Localmente

Debido a las políticas de seguridad de los navegadores modernos (*CORS / Media Source*) con archivos de video en `file://`, se recomienda ejecutar un servidor web local liviano.

### Opción 1: Con Python (Recomendado)
Abre una terminal en esta carpeta y ejecuta:
```bash
python -m http.server 8080
```
Luego abre tu navegador en: [http://localhost:8080](http://localhost:8080)

### Opción 2: Con Node.js / NPX
```bash
npx serve .
```

### Opción 3: Carga Directa / Drag & Drop
Si abres `index.html` directamente en el navegador y el video no inicia por restricciones del navegador:
1. Haz clic en el botón **"Cargar Video"** en la barra superior.
2. O simplemente **arrastra y suelta** el archivo `Paisajes andinos, Elián.mp4` sobre la ventana del navegador.

---

## 🎮 Controles de Navegación

| Acción | Control |
| :--- | :--- |
| **Mirar alrededor / Cenit** | Clic izquierdo y arrastrar el ratón |
| **Zoom Angular (FOV)** | Rueda del ratón (*Scroll wheel*) |
| **Mover vista con teclado** | Teclas `W` `A` `S` `D` o `Flechas de dirección` |
| **Reproducir / Pausar** | Barra espaciadora (`Espacio`) o botón Play central |
| **Silenciar / Activar audio** | Tecla `M` o control de volumen |
| **Pantalla Completa** | Tecla `F` o botón en barra superior |
| **Volver al Cenit (Arriba)** | Tecla `R` o clic en el widget de la brújula |
| **Ocultar / Mostrar HUD** | Tecla `H` |

---

## ⚙️ Características y Panel de Calibración

- **Shader GLSL Fisheye Dedicado**: Proyección circular equidistante libre de distorsiones sobre la semiesfera superior.
- **Conmutador Semiesfera / Esfera**: Alterna entre ver solo la cúpula superior con horizonte planetario o la esfera 360° completa.
- **Panel de Calibración en Tiempo Real**:
  - **Ángulo de Cobertura (FOV)**: De 120° a 240° (soporta 180° fulldome y formatos de mayor cobertura).
  - **Escala / Crop**: Ajuste de diámetro del círculo de proyección.
  - **Desplazamiento Óptico (X/Y)**: Para centrar tomas que tengan desfase.
  - **Rotación Azimutal**: Gira la orientación del video dentro del domo.
  - **Espejado (Flip X / Flip Y)**: Para corregir videos exportados invertidos.
  - **Control de Exposición / Brillo**.
- **Presets de Cámara**: Botones de acceso rápido para mirar al Cenit, Frente, Atrás, Izquierda y Derecha.
- **Captura de Pantalla en HD**: Guarda una instantánea limpia del render 3D actual.
