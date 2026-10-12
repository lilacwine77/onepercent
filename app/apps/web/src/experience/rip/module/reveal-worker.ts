/* eslint-disable */
// Synced from experience/lab/src/rip/reveal-worker.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Builds the repo's PackReveal relief (vendor/pack-asset.js, unchanged) off the main thread and
 * ships it as plain typed arrays: node graph, geometry (with morph targets) and the sampled
 * "Rip Reveal Own" clip that the repo's GLB export also uses.
 */
import * as THREE from "three";
import { createPackAsset } from "./vendor/pack-asset.js";

export interface WireAttr {
  array: ArrayLike<number> & { buffer: ArrayBufferLike };
  itemSize: number;
  normalized: boolean;
}
export interface WireNode {
  name: string;
  parent: number;
  position: number[];
  quaternion: number[];
  scale: number[];
  mesh?: {
    attributes: Record<string, WireAttr>;
    index?: WireAttr;
    morph: WireAttr[];
    morphRelative: boolean;
    material: "reference" | "closed" | "rim";
  };
}

const scope = self as unknown as {
  onmessage: (e: MessageEvent) => void;
  postMessage(m: unknown, t?: Transferable[]): void;
};

scope.onmessage = () => {
  const reference = new THREE.Texture();
  reference.name = "reference";
  const closed = new THREE.Texture();
  closed.name = "closed";
  const asset = createPackAsset({
    closedTexture: closed,
    referenceTexture: reference,
  });
  const nodes: WireNode[] = [];
  const transfer = new Set<ArrayBufferLike>();
  const wire = (a: THREE.BufferAttribute): WireAttr => {
    const array = (a.array as Float32Array).slice();
    transfer.add(array.buffer);
    return { array, itemSize: a.itemSize, normalized: a.normalized };
  };
  const walk = (o: THREE.Object3D, parent: number) => {
    const n: WireNode = {
      name: o.name,
      parent,
      position: o.position.toArray(),
      quaternion: o.quaternion.toArray(),
      scale: o.scale.toArray(),
    };
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry;
      const attributes: Record<string, WireAttr> = {};
      for (const k of Object.keys(g.attributes))
        attributes[k] = wire(g.attributes[k] as THREE.BufferAttribute);
      const mat = m.material as THREE.MeshBasicMaterial;
      n.mesh = {
        attributes,
        index: g.index ? wire(g.index) : undefined,
        morph: (g.morphAttributes.position ?? []).map((a) =>
          wire(a as THREE.BufferAttribute),
        ),
        morphRelative: g.morphTargetsRelative,
        material:
          mat.map === reference
            ? "reference"
            : mat.map === closed
              ? "closed"
              : "rim",
      };
    }
    const index = nodes.push(n) - 1;
    o.children.forEach((c) => walk(c, index));
  };
  walk(asset.group, -1);
  const clip = THREE.AnimationClip.toJSON(asset.animationClips[0]);
  asset.dispose();
  scope.postMessage({ nodes, clip }, [...transfer] as Transferable[]);
};
