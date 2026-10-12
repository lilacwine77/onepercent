/* eslint-disable */
// Synced from experience/lab/src/rip/reveal.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/** The PackReveal relief rebuilt on the main thread from the worker's buffers (no long task). */
import * as THREE from "three";
import type { WireAttr, WireNode } from "./reveal-worker";

export interface RevealAsset {
  group: THREE.Group;
  setProgress(p: number): void;
  dispose(): void;
}

const attr = (w: WireAttr) =>
  new THREE.BufferAttribute(
    w.array as unknown as Float32Array,
    w.itemSize,
    w.normalized,
  );

export function buildRevealOffThread(
  closed: THREE.Texture,
  reference: THREE.Texture,
): Promise<RevealAsset> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./reveal-worker.ts", import.meta.url), {
      type: "module",
      name: "rip-pack-reveal",
    });
    worker.onerror = (e) => {
      worker.terminate();
      reject(e);
    };
    worker.onmessage = async (
      e: MessageEvent<{ nodes: WireNode[]; clip: unknown }>,
    ) => {
      worker.terminate();
      // Rebuilt one mesh per frame: no long task on the main thread.
      const frame = () =>
        new Promise<void>((r) => requestAnimationFrame(() => r()));
      // Same materials as vendor/pack-asset.js.
      const mats = {
        reference: new THREE.MeshBasicMaterial({
          map: reference,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
        closed: new THREE.MeshBasicMaterial({
          map: closed,
          alphaTest: 0.035,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
        // Plum, not black: the opened pouch reads as the inside of the brand, not a void.
        rim: new THREE.MeshBasicMaterial({
          color: 0x3a1f4a,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      };
      const objects: THREE.Object3D[] = [];
      const geos: THREE.BufferGeometry[] = [];
      for (const n of e.data.nodes) {
        let o: THREE.Object3D;
        if (n.mesh) {
          await frame();
          const g = new THREE.BufferGeometry();
          for (const [k, a] of Object.entries(n.mesh.attributes))
            g.setAttribute(k, attr(a));
          if (n.mesh.index) g.setIndex(attr(n.mesh.index));
          if (n.mesh.morph.length) {
            g.morphAttributes.position = n.mesh.morph.map(attr);
            g.morphTargetsRelative = n.mesh.morphRelative;
          }
          g.computeBoundingSphere();
          geos.push(g);
          const mesh = new THREE.Mesh(g, mats[n.mesh.material]);
          mesh.updateMorphTargets();
          o = mesh;
        } else o = n.parent < 0 ? new THREE.Group() : new THREE.Object3D();
        o.name = n.name;
        o.position.fromArray(n.position);
        o.quaternion.fromArray(n.quaternion);
        o.scale.fromArray(n.scale);
        objects.push(o);
        if (n.parent >= 0) objects[n.parent].add(o);
      }
      const group = objects[0] as THREE.Group;
      await frame();
      const clip = THREE.AnimationClip.parse(
        e.data.clip as THREE.AnimationClipJSON,
      );
      const mixer = new THREE.AnimationMixer(group);
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      const setProgress = (p: number) => {
        action.time = Math.min(1, Math.max(0, p)) * clip.duration;
        mixer.update(0);
      };
      setProgress(0);
      resolve({
        group,
        setProgress,
        dispose: () => {
          mixer.stopAllAction();
          geos.forEach((g) => g.dispose());
          Object.values(mats).forEach((m) => m.dispose());
          group.removeFromParent();
        },
      });
    };
    worker.postMessage(0);
  });
}
