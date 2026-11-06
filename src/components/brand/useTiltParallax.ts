import { RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface TiltOptions {
  /** Turn the pointer tilt off (layers still drift on scroll if `scroll`). */
  enabled?: boolean;
  /** Maximum rotation in degrees at the edge of the tilt area. */
  maxTilt?: number;
  /** Distance in px between depth levels (data-depth="1" → 1 × this). */
  depthPx?: number;
  /** Also drift layers apart while the section scrolls out of view. */
  scroll?: boolean;
}

/**
 * 3D parallax for a layered element.
 *
 * Markup contract inside `scope`:
 *   [data-tilt-stage]  rotates in 3D toward the pointer
 *   [data-depth="n"]   layers lifted n levels off the stage; deeper layers
 *                      shift further, which reads as depth
 *   [data-tilt-area]   (optional ancestor) element whose pointer movement
 *                      drives the tilt; defaults to `scope`
 *
 * Runs only with a fine pointer and no reduced-motion preference; GSAP's
 * matchMedia reverts everything when those conditions change.
 */
export function useTiltParallax(scope: RefObject<HTMLElement | null>, opts: TiltOptions = {}) {
  const { enabled = true, maxTilt = 7, depthPx = 22, scroll = false } = opts;

  useGSAP(() => {
    const root = scope.current;
    const stage = root?.querySelector<HTMLElement>("[data-tilt-stage]");
    if (!root || !stage) return;
    const layers = gsap.utils.toArray<HTMLElement>("[data-depth]", root);
    const depthOf = (el: HTMLElement) => Number(el.dataset.depth) || 0;
    const area = root.closest<HTMLElement>("[data-tilt-area]") ?? root;
    const mm = gsap.matchMedia();

    if (enabled) mm.add("(prefers-reduced-motion: no-preference) and (pointer: fine)", () => {
      // Perspective lives on the stage's parent so lifted layers project with depth.
      gsap.set(root, { perspective: 1100 });
      gsap.set(stage, { transformOrigin: "50% 50%" });
      layers.forEach(el => gsap.set(el, { z: depthOf(el) * depthPx }));

      const ease = { duration: 0.9, ease: "power3.out" };
      const rotX = gsap.quickTo(stage, "rotationX", ease);
      const rotY = gsap.quickTo(stage, "rotationY", ease);
      const shifts = layers.map(el => ({
        d: depthOf(el),
        x: gsap.quickTo(el, "x", ease),
        y: gsap.quickTo(el, "y", ease),
      }));

      const onMove = (e: PointerEvent) => {
        const r = area.getBoundingClientRect();
        const px = gsap.utils.clamp(-1, 1, ((e.clientX - r.left) / r.width) * 2 - 1);
        const py = gsap.utils.clamp(-1, 1, ((e.clientY - r.top) / r.height) * 2 - 1);
        rotY(px * maxTilt);
        rotX(-py * maxTilt);
        shifts.forEach(s => { s.x(px * s.d * 7); s.y(py * s.d * 7); });
      };
      const onLeave = () => {
        rotX(0); rotY(0);
        shifts.forEach(s => { s.x(0); s.y(0); });
      };

      area.addEventListener("pointermove", onMove);
      area.addEventListener("pointerleave", onLeave);
      return () => {
        area.removeEventListener("pointermove", onMove);
        area.removeEventListener("pointerleave", onLeave);
      };
    });

    if (scroll) {
      mm.add("(prefers-reduced-motion: no-preference) and (min-width: 1024px)", () => {
        layers.forEach(el => {
          gsap.to(el, {
            yPercent: -depthOf(el) * 9,
            ease: "none",
            scrollTrigger: { trigger: area, start: "top top", end: "bottom top", scrub: 0.6 },
          });
        });
      });
    }

    return () => mm.revert();
  }, { scope, dependencies: [enabled, maxTilt, depthPx, scroll] });
}
