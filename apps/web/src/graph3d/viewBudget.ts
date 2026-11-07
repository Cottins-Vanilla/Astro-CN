/**
 * The volume a viewer can actually see and reach — the one thing the renderer and the layouts
 * genuinely must agree on.
 *
 * These lived in renderer.ts, and ConstellationLayout duplicated them in a comment, which is
 * precisely how the dome grew to a radius of ~28,000 while the camera could not pull back past
 * 1,600: the layout's own idea of "how big is too big" drifted from the renderer's, silently,
 * because nothing linked them. Importing renderer.ts from a layout to fix that would trade one
 * problem for another — layouts are pure CPU and must not pull three.js into their module graph,
 * and docs/ARCHITECTURE.md states outright that a layout doesn't know how it will be drawn.
 *
 * So the numbers live here instead: no dependencies, imported by both sides, single source of truth.
 */

/** `OrbitControls.maxDistance` — the hard clamp on how far the camera can pull back. Anything
 * beyond this from the orbit target cannot be brought into view at all, at any zoom level. */
export const CAMERA_MAX_DISTANCE = 1600;

/** Scene fog range, in world units from the camera. Past `FOG_FAR` geometry is fully faded into
 * the background colour — visible in the depth buffer, invisible to the user. */
export const FOG_NEAR = 550;
export const FOG_FAR = 1500;
