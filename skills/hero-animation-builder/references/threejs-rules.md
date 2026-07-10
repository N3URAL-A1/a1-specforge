# Three.js / React Three Fiber Rules

## Rendering

- **On-demand rendering** when the scene is mostly static: R3F `<Canvas frameloop="demand">` + `invalidate()` on interaction. For continuously animated heroes a normal loop is fine, but pause it when the tab is hidden (`document.visibilitychange`) and when the hero is scrolled out of view (`IntersectionObserver`).
- Cap pixel ratio: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`.
- Size the canvas to its container, listen to `resize`, update camera aspect + `updateProjectionMatrix()`.

## Allocation discipline

- Never `new THREE.Vector3()` / new geometry / new material inside the render loop or `useFrame` — GC pauses cause visible jank. Allocate once outside, reuse via `.set()` / `.copy()`.
- Mutate transforms directly per frame, scaled by delta:
  ```js
  mesh.rotation.y += delta * 0.4; // rad/s, frame-rate independent
  ```
- R3F: store timelines/objects in `useRef`, never in React state.

## Assets

- Load models/textures via `useLoader`/`useGLTF` (R3F) — cached and shared automatically.
- Run GLB files through `gltfjsx` to get an efficient immutable JSX graph.
- Many identical objects (particles, stars, instanced shapes) → `InstancedMesh` / drei `<Instances>`: one draw call.

## Materials & light — where "good looking" comes from

- Cheap scenes look cheap because of lighting, not geometry. Minimum recipe: one key light (directional or point), one dim fill/ambient, and an environment or rim accent. Add fog (`scene.fog`) for depth.
- `MeshStandardMaterial`/`MeshPhysicalMaterial` with `metalness`/`roughness` tuned beats any unlit material. Wireframe or `MeshNormalMaterial` reads as "demo", not "product" — avoid unless it's the deliberate aesthetic.
- Subtle > spectacular: slow rotation (< 0.5 rad/s), gentle mouse parallax (lerp toward target, factor 0.02–0.05), small amplitude float (`Math.sin(t) * 0.1`).

## Interaction pattern (mouse parallax)

```js
const target = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => {
  target.x = (e.clientX / innerWidth - 0.5) * 2;
  target.y = (e.clientY / innerHeight - 0.5) * 2;
});
// in the loop: lerp, never snap
group.rotation.y += (target.x * 0.3 - group.rotation.y) * 0.05;
group.rotation.x += (target.y * 0.15 - group.rotation.x) * 0.05;
```

## Accessibility / fallback

- `prefers-reduced-motion: reduce` → stop the animation loop after the first rendered frame (static scene is fine), disable parallax.
- Provide a CSS background (gradient/poster) behind the canvas so first paint never shows a black hole.
