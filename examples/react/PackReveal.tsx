"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PackReveal } from "../../src/pack-reveal.js";
import "./pack-reveal.css";

export interface PackRevealSectionProps {
  assetsBase?: string;
  className?: string;
  children?: ReactNode;
}

/** Copy this component into your app and update the module import above. */
export function PackRevealSection({
  assetsBase = "/assets/",
  className = "",
  children,
}: PackRevealSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    const container = containerRef.current;
    if (!section || !container) return;

    setReady(false);
    setFailed(false);

    let instance: PackReveal;
    try {
      instance = new PackReveal({ container, assetsBase });
    } catch {
      setFailed(true);
      return;
    }

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let disposed = false;
    let loaded = false;

    const update = () => {
      frame = 0;
      if (disposed || !loaded) return;

      if (motion.matches) {
        instance.setProgress(1);
        return;
      }

      const bounds = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const travel = Math.max(1, bounds.height - viewportHeight);
      instance.setProgress(Math.min(1, Math.max(0, -bounds.top / travel)));
    };

    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    motion.addEventListener("change", schedule);

    void instance.ready
      .then(() => {
        if (disposed) return;
        loaded = true;
        update();
        setReady(true);
      })
      .catch(() => {
        if (disposed) return;
        instance.destroy();
        setFailed(true);
      });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      motion.removeEventListener("change", schedule);
      instance.destroy();
    };
  }, [assetsBase]);

  const fallbackUrl = `${assetsBase.replace(/\/?$/, "/")}pepe-all-white.png`;

  return (
    <section
      ref={sectionRef}
      className={`pack-reveal-section ${className}`.trim()}
      aria-label="Pack 1 % — ouverture au défilement"
      data-ready={ready}
      data-failed={failed}
    >
      <div className="pack-reveal-section__stage">
        <div
          ref={containerRef}
          className="pack-reveal-section__canvas"
          aria-hidden="true"
        />
        {failed && (
          <img
            className="pack-reveal-section__fallback"
            src={fallbackUrl}
            alt="Pack holographique 1 % ouvert, avec Pepe blanc qui émerge."
            width={1254}
            height={1254}
          />
        )}
        {!failed && (
          <p className="pack-reveal-section__sr-only" aria-live="polite">
            {ready
              ? "Le pack holographique se déchire au défilement et révèle Pepe."
              : "Chargement du pack interactif."}
          </p>
        )}
        {children && <div className="pack-reveal-section__content">{children}</div>}
      </div>
    </section>
  );
}
