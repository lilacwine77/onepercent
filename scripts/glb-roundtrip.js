import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Browser-only test helper; not imported by the shipped component. */
export async function verifyGLBRoundtrip(pack, buffer) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const mixer = new AnimationMixer(gltf.scene);
  const action = mixer.clipAction(gltf.animations[0]);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  let largestError = 0;
  let comparisons = 0;
  const a = new Vector3(), b = new Vector3();
  for (const progress of [0, .25, .5, .75, 1]) {
    pack.asset.setProgress(progress);
    pack.asset.group.updateMatrixWorld(true);
    action.reset().play();
    mixer.setTime(progress * gltf.animations[0].duration);
    gltf.scene.updateMatrixWorld(true);
    pack.asset.group.traverse(mesh => {
      if (!mesh.isMesh) return;
      const loaded = gltf.scene.getObjectByName(mesh.name);
      if (!loaded?.isMesh) throw new Error(`GLB is missing ${mesh.name}`);
      if (!loaded.material.isMeshBasicMaterial) throw new Error(`Baked lighting was changed on ${mesh.name}`);
      if (mesh.geometry.attributes.position.count !== loaded.geometry.attributes.position.count) throw new Error(`GLB topology changed on ${mesh.name}`);
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 5) {
        mesh.getVertexPosition(i, a).applyMatrix4(mesh.matrixWorld);
        loaded.getVertexPosition(i, b).applyMatrix4(loaded.matrixWorld);
        largestError = Math.max(largestError, a.distanceTo(b));
        comparisons++;
      }
    });
  }
  pack.asset.setProgress(pack.progress);
  pack.invalidate();
  gltf.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    mesh.material.map?.dispose();
    mesh.material.dispose();
  });
  mixer.uncacheRoot(gltf.scene);
  if (largestError > 0.00001) throw new Error(`GLB differs from the live animation by ${largestError}`);
  return { comparisons, largestError, animation: gltf.animations[0].name, duration: gltf.animations[0].duration };
}
