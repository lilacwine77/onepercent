const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

export const PACK_CAROUSEL_FLOOR = -2.50;

/** Shared camera fit for the volume and its native-artwork loading view.
 * The 4.1-unit envelope covers all editions and their hover tilt.
 */
export function getPackCarouselLayout(width, height) {
  const compact = width < 520;
  const packPixels = Math.min(compact ? 210 : 240, height * .54, width * (compact ? .67 : .32));
  const footprint = 4.1;
  const spacing = footprint + .34;
  const halfWidthFit = spacing / 2 + footprint / 2 + .12;
  const halfHeight = Math.max(3.8, height * 4.2 / (2 * packPixels), halfWidthFit / (width / height));
  const pixelsPerUnit = height / (halfHeight * 2);
  return { halfHeight, halfWidth: halfHeight * width / height, spacing, pixelsPerUnit,
    // Include the transparent margin of the original four-unit image plane.
    imagePixels: 4 / 3.849814 * 4.2 * pixelsPerUnit };
}

/** A tilted semicircle: the middle pack sits forward and lower, its neighbours
 * follow the circle upward and back. Mapping one loop onto the front half keeps
 * horizontal order monotone; the seam remains beyond either viewport edge.
 */
export function getPackCarouselPose(angle, index, spacing) {
  const step = Math.PI / 4;
  const theta = ((angle + index * step + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const phi = theta / 2;
  const radius = spacing / Math.sin(step / 2);
  const rise = radius * (1 - Math.cos(phi));
  const depth = Math.cos(theta), side = Math.sin(phi);
  return { theta, depth, side, x: radius * side, y: -.18 + rise * Math.SQRT1_2,
    z: .7 - rise * Math.SQRT1_2, scale: .72 + .28 * depth,
    yaw: clamp(phi, -.85, .85), roll: side * -.05 };
}
