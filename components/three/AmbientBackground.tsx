'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const PARTICLE_COUNT = 260;
const MAX_PIXEL_RATIO = 2;

// Reads an "H S% L%" custom property (as defined in app/globals.css, e.g.
// `--primary: 348 44% 80%`) and converts it into a THREE.Color, so the scene
// always matches the current theme tokens instead of a hardcoded palette.
function readHslVar(styles: CSSStyleDeclaration, name: string, fallback: string): THREE.Color {
  const raw = styles.getPropertyValue(name).trim();
  if (!raw) return new THREE.Color(fallback);
  const [h, s, l] = raw.split(/\s+/);
  if (!h || !s || !l) return new THREE.Color(fallback);
  const color = new THREE.Color();
  color.setStyle(`hsl(${h}, ${s}, ${l})`);
  return color;
}

/**
 * A subtle, palette-matched drifting particle field mounted once behind every
 * page (see app/layout.tsx). Deliberately cheap — this runs alongside the
 * WebRTC/WebAudio-heavy conversation UI, so there's no post-processing and a
 * small, fixed particle budget.
 */
export function AmbientBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const styles = getComputedStyle(document.documentElement);
    const backgroundColor = readHslVar(styles, '--background', '#FFF5F5');
    const primaryColor = readHslVar(styles, '--primary', '#E2B4BD');
    const secondaryColor = readHslVar(styles, '--secondary', '#F7D6D0');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    camera.position.z = 12;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL support — leave the background as the plain CSS token color.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(backgroundColor, 0);
    container.appendChild(renderer.domElement);

    // Particle field: positions drift slowly; colors alternate between the two
    // brand hues so the field reads as "rose/peach dust" rather than noise.
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const speeds = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;

      const mixed = primaryColor.clone().lerp(secondaryColor, Math.random());
      colors[i * 3] = mixed.r;
      colors[i * 3 + 1] = mixed.g;
      colors[i * 3 + 2] = mixed.b;

      speeds[i] = 0.05 + Math.random() * 0.12;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let animationFrame = 0;
    let isRunning = !prefersReducedMotion;
    const clock = new THREE.Clock();

    const renderFrame = () => {
      const elapsed = clock.getElapsedTime();
      const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const baseY = positions[i * 3 + 1];
        positionAttr.setY(i, baseY + Math.sin(elapsed * speeds[i] + i) * 0.6);
      }
      positionAttr.needsUpdate = true;
      points.rotation.y = elapsed * 0.015;
      renderer.render(scene, camera);
    };

    const tick = () => {
      if (!isRunning) return;
      renderFrame();
      animationFrame = requestAnimationFrame(tick);
    };

    // Render exactly one static frame when motion is reduced, instead of
    // looping — keeps the palette-matched background without animating it.
    renderFrame();
    if (isRunning) {
      animationFrame = requestAnimationFrame(tick);
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        isRunning = false;
        cancelAnimationFrame(animationFrame);
      } else if (!prefersReducedMotion) {
        isRunning = true;
        animationFrame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      isRunning = false;
      cancelAnimationFrame(animationFrame);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animationFrame);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
