import type { CSSProperties } from "react";

const asset = (name: string) => `/experience/home/${name}`;
const vars = (value: Record<string, string | number>) => value as CSSProperties;

/** A home image in AVIF and WebP at the given widths (make-assets.py), lazy. */
export function Picture({
  name,
  sizes,
  alt = "",
  widths,
}: {
  name: string;
  sizes: string;
  alt?: string;
  widths: number[];
}) {
  const set = (ext: string) =>
    widths.map((w) => `${asset(`${name}-${w}.${ext}`)} ${w}w`).join(", ");
  // The image fades in once decoded (main.tsx) over its blurred placeholder
  // (home.css .lqip, styles.css --lqip-*).
  return (
    <picture className="lqip" style={vars({ "--lqip": `var(--lqip-${name})` })}>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <img
        src={asset(`${name}-${widths[0]}.webp`)}
        srcSet={set("webp")}
        sizes={sizes}
        alt={alt}
        width={widths.at(-1)}
        height={widths.at(-1)}
        loading="lazy"
        decoding="async"
        data-fade=""
      />
    </picture>
  );
}
