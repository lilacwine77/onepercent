/* eslint-disable */
// Synced from experience/lab/src/rip/vendor/pack-asset.d.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import type * as THREE from "three";
/** Vendored from repo/src/pack-asset.js (unchanged): the PackReveal foil-tear relief with the white Pepe. */
export function createPackAsset(options: {
  closedTexture: THREE.Texture;
  referenceTexture: THREE.Texture;
}): {
  group: THREE.Group;
  setProgress(progress: number): void;
  dispose(): void;
  animationClips: THREE.AnimationClip[];
  meshes: THREE.Mesh[];
  dimensions: { width: number; height: number; depth: number };
};
