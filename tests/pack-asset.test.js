import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPackAsset } from '../src/pack-asset.js';

function createFixture(t) {
  const closedTexture = new THREE.Texture();
  const referenceTexture = new THREE.Texture();
  const asset = createPackAsset({ closedTexture, referenceTexture });
  t.after(() => {
    asset.dispose();
    closedTexture.dispose();
    referenceTexture.dispose();
  });
  return { asset, closedTexture, referenceTexture };
}

function meshesOf(asset) {
  const meshes = [];
  asset.group.traverse(node => { if (node.isMesh) meshes.push(node); });
  assert.ok(meshes.length > 0, 'the asset must contain renderable meshes');
  return meshes;
}

function assertFinite(values, label) {
  assert.ok(Array.from(values).every(Number.isFinite), `${label} contains non-finite values`);
}

function snapshot(asset) {
  asset.group.updateMatrixWorld(true);
  return meshesOf(asset).map(mesh => ({
    name: mesh.name,
    position: mesh.position.toArray(),
    quaternion: mesh.quaternion.toArray(),
    scale: mesh.scale.toArray(),
    world: mesh.matrixWorld.toArray(),
    visible: mesh.visible,
    opacity: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material.opacity),
    morphInfluences: mesh.morphTargetInfluences?.slice() ?? [],
    vertices: Array.from(mesh.geometry.getAttribute('position').array),
  }));
}

function renderedVertices(asset) {
  asset.group.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  return meshesOf(asset).map(mesh => {
    const vertices = [];
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      vertices.push(point.x, point.y, point.z);
    }
    return vertices;
  });
}

function depthRange(root) {
  const point = new THREE.Vector3();
  let min = Infinity;
  let max = -Infinity;
  root.traverse(node => {
    if (!node.isMesh) return;
    for (let i = 0; i < node.geometry.getAttribute('position').count; i++) {
      node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld);
      assert.ok(Number.isFinite(point.z), `${node.name}: non-finite world depth`);
      min = Math.min(min, point.z);
      max = Math.max(max, point.z);
    }
  });
  assert.ok(Number.isFinite(min) && Number.isFinite(max), `${root.name}: no evaluated surface`);
  return { min, max };
}

function containsTexturePoint(geometry, x, y) {
  const uv = geometry.getAttribute('uv');
  const indices = geometry.index;
  const count = indices ? indices.count : uv.count;
  for (let triangle = 0; triangle < count; triangle += 3) {
    const a = indices ? indices.getX(triangle) : triangle;
    const b = indices ? indices.getX(triangle + 1) : triangle + 1;
    const c = indices ? indices.getX(triangle + 2) : triangle + 2;
    const ax = uv.getX(a), ay = uv.getY(a);
    const bx = uv.getX(b) - ax, by = uv.getY(b) - ay;
    const cx = uv.getX(c) - ax, cy = uv.getY(c) - ay;
    const determinant = bx * cy - by * cx;
    if (Math.abs(determinant) < 1e-14) continue;
    const px = x - ax, py = y - ay;
    const weightB = (px * cy - py * cx) / determinant;
    const weightC = (bx * py - by * px) / determinant;
    if (weightB >= -1e-6 && weightC >= -1e-6 && weightB + weightC <= 1 + 1e-6) return true;
  }
  return false;
}

function isDescendantOf(node, parent) {
  for (let current = node; current; current = current.parent) if (current === parent) return true;
  return false;
}

test('the pack has valid geometry throughout the reveal, including evaluated morph targets', t => {
  const { asset } = createFixture(t);
  assert.ok(asset.group.isGroup);
  const meshes = meshesOf(asset);
  let hasMorphTargets = false;
  for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    asset.setProgress(progress);
    asset.group.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      assert.ok(position.count >= 3, `${mesh.name}: no drawable triangle`);
      assert.equal(position.itemSize, 3);
      assertFinite(position.array, `${mesh.name}: positions at ${progress}`);
      assertFinite(mesh.matrixWorld.elements, `${mesh.name}: transform at ${progress}`);
      if (geometry.index) {
        for (const index of geometry.index.array) {
          assert.ok(index >= 0 && index < position.count, `${mesh.name}: index out of bounds`);
        }
      }
      for (const morph of geometry.morphAttributes.position ?? []) {
        hasMorphTargets = true;
        assert.equal(morph.count, position.count, `${mesh.name}: mismatched morph vertex count`);
        assertFinite(morph.array, `${mesh.name}: morph positions`);
      }
      assertFinite(mesh.morphTargetInfluences ?? [], `${mesh.name}: morph influences at ${progress}`);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        assert.ok(Number.isFinite(material.opacity) && material.opacity >= 0 && material.opacity <= 1);
      }
    }
    for (const vertices of renderedVertices(asset)) assertFinite(vertices, `rendered vertices at ${progress}`);
  }
  assert.ok(hasMorphTargets, 'the exported pack must carry deformable geometry');
  asset.setProgress(0);
  const closedVertices = renderedVertices(asset);
  asset.setProgress(1);
  assert.notDeepEqual(renderedVertices(asset), closedVertices, 'reveal must move or deform actual geometry');
});

test('rear-skull pixels belong only to the animated head and each hand keeps its own artwork', t => {
  const { asset, referenceTexture } = createFixture(t);
  const names = ['PepeFace', 'PepeLeftHand', 'PepeRightHand', 'PepeRightForearm'];
  for (const name of names) {
    const mesh = asset.group.getObjectByName(name);
    assert.ok(mesh?.isMesh, `missing textured surface ${name}`);
    assert.equal(mesh.material.map, referenceTexture, `${name} must use the original artwork`);
  }
  const meshes = meshesOf(asset).filter(mesh => mesh.material.map === referenceTexture);
  const samples = [
    { pixel: [371, 550], owner: 'PepeFace' },
    { pixel: [385, 534], owner: 'PepeFace' },
    { pixel: [405, 507], owner: 'PepeFace' },
    { pixel: [419, 488], owner: 'PepeFace' },
    { pixel: [270, 603], owner: 'PepeLeftHand' },
    { pixel: [355, 694], owner: 'PepeLeftHand' },
    { pixel: [373, 662], owner: 'PepeLeftHand' },
    { pixel: [1026, 763], owner: 'PepeRightHand' },
    { pixel: [906, 790], owner: 'PepeRightForearm' },
  ];
  const actual = samples.map(({ pixel: [x, y] }) => ({
    pixel: [x, y],
    owners: meshes.filter(mesh => containsTexturePoint(mesh.geometry, x / 1254, 1 - y / 1254)).map(mesh => mesh.name),
  }));
  const expected = samples.map(({ pixel, owner }) => ({ pixel, owners: [owner] }));
  assert.deepEqual(actual, expected, 'each sampled character pixel must occur on exactly its moving body part');
});

test('photographed foil folds are excluded from every moving character surface', t => {
  const { asset } = createFixture(t);
  const surfaces = [];
  asset.character.traverse(node => { if (node.isMesh) surfaces.push(node); });
  assert.ok(surfaces.length >= 3, 'the character must contain its moving head and hands');
  const foilPixels = [
    [480, 807], [532, 837], [604, 908],
    [815, 852], [842, 840], [861, 830],
    [948, 803], [959, 809], [973, 820],
  ];
  for (const [x, y] of foilPixels) {
    const owners = surfaces.filter(mesh => containsTexturePoint(mesh.geometry, x / 1254, 1 - y / 1254)).map(mesh => mesh.name);
    assert.deepEqual(owners, [], `source foil pixel ${x}, ${y} remains embedded in a moving character surface`);
  }
});

test('no photographed surface duplicates artwork from the moving character', t => {
  const { asset, referenceTexture } = createFixture(t);
  const otherSurfaces = meshesOf(asset).filter(mesh => mesh.material.map === referenceTexture && !isDescendantOf(mesh, asset.character));
  const movingSurfaces = [];
  asset.character.traverse(node => { if (node.isMesh) movingSurfaces.push(node); });
  assert.ok(movingSurfaces.length >= 3, 'the character must contain its moving head and hands');
  for (const mesh of movingSurfaces) {
    const uv = mesh.geometry.getAttribute('uv');
    const indices = mesh.geometry.index;
    const triangleCount = (indices ? indices.count : uv.count) / 3;
    const sampleCount = Math.min(100, triangleCount);
    for (let sample = 0; sample < sampleCount; sample++) {
      const triangle = Math.floor((sample + 0.5) * triangleCount / sampleCount) * 3;
      let u = 0, v = 0;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = indices ? indices.getX(triangle + corner) : triangle + corner;
        u += uv.getX(vertex) / 3;
        v += uv.getY(vertex) / 3;
      }
      for (const other of otherSurfaces) {
        assert.equal(
          containsTexturePoint(other.geometry, u, v),
          false,
          `${other.name} duplicates ${mesh.name} triangle artwork at source pixel ${(u * 1254).toFixed(2)}, ${((1 - v) * 1254).toFixed(2)}`,
        );
      }
    }
  }
});

test('the wrapper is made from exactly two connected foil sheets with no second photographed wrapper', t => {
  const { asset, closedTexture, referenceTexture } = createFixture(t);
  assert.ok(!asset.group.getObjectByName('OriginalTornWrapper'), 'a second photographed wrapper must not remain behind the moving foil');
  const foil = meshesOf(asset).filter(mesh => mesh.material.map === closedTexture);
  assert.deepEqual(foil.map(mesh => mesh.name).sort(), ['Foil_bottom', 'Foil_top']);
  for (const mesh of meshesOf(asset).filter(mesh => mesh.material.map === referenceTexture)) {
    assert.ok(isDescendantOf(mesh, asset.character) || /^TornFragment_\d+$/.test(mesh.name), `${mesh.name} adds an independent photographed surface behind the foil`);
  }
  for (const mesh of foil) {
    const geometry = mesh.geometry;
    assert.ok(geometry.index, `${mesh.name}: the sheet must share its triangle vertices`);
    const parent = Uint32Array.from({ length: geometry.getAttribute('position').count }, (_, index) => index);
    const find = index => {
      while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
      return index;
    };
    const used = new Set();
    const edges = new Map();
    for (let i = 0; i < geometry.index.count; i += 3) {
      const vertices = [0, 1, 2].map(offset => geometry.index.getX(i + offset));
      assert.equal(new Set(vertices).size, 3, `${mesh.name}: triangle repeats a vertex`);
      for (let corner = 0; corner < 3; corner++) {
        const a = vertices[corner], b = vertices[(corner + 1) % 3];
        parent[find(b)] = find(a);
        used.add(a);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edge = edges.get(key) ?? { a, b, count: 0 };
        edge.count++;
        edges.set(key, edge);
      }
    }
    assert.equal(new Set([...used].map(find)).size, 1, `${mesh.name}: foil consists of disconnected patches`);
    assert.ok([...edges.values()].some(edge => edge.count === 2), `${mesh.name}: triangles do not share any interior edge`);
    const boundary = new Map();
    for (const { a, b, count } of edges.values()) {
      assert.ok(count === 1 || count === 2, `${mesh.name}: more than two triangles share one edge`);
      if (count !== 1) continue;
      for (const [from, to] of [[a, b], [b, a]]) {
        if (!boundary.has(from)) boundary.set(from, []);
        boundary.get(from).push(to);
      }
    }
    assert.ok(boundary.size > 0, `${mesh.name}: missing sheet perimeter`);
    for (const neighbors of boundary.values()) assert.equal(neighbors.length, 2, `${mesh.name}: broken or branching perimeter`);
    const visited = new Set();
    const queue = [boundary.keys().next().value];
    while (queue.length) {
      const vertex = queue.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      queue.push(...boundary.get(vertex));
    }
    assert.equal(visited.size, boundary.size, `${mesh.name}: unexpected hole or disconnected perimeter`);
  }
});

test('shared foil vertices stay joined throughout the live and exported animation', t => {
  const { asset, closedTexture } = createFixture(t);
  const foil = meshesOf(asset).filter(mesh => mesh.material.map === closedTexture);
  const sourceVertices = new Map();
  for (const mesh of foil) {
    const uv = mesh.geometry.getAttribute('uv');
    const indices = mesh.geometry.index;
    const side = mesh.name.startsWith('Foil_top') ? 'top' : 'bottom';
    const count = indices ? indices.count : uv.count;
    for (let i = 0; i < count; i++) {
      const index = indices ? indices.getX(i) : i;
      const key = `${side}:${uv.getX(index).toFixed(7)}:${uv.getY(index).toFixed(7)}`;
      if (!sourceVertices.has(key)) sourceVertices.set(key, []);
      sourceVertices.get(key).push({ mesh, index });
    }
  }
  const shared = [...sourceVertices.values()].filter(vertices => vertices.length > 1);
  assert.ok(shared.length > 0, 'the foil must have joined interior triangle edges');
  function assertJoined(progress, source) {
    asset.group.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    const positions = new Map(foil.map(mesh => {
      const values = new Float64Array(mesh.geometry.getAttribute('position').count * 3);
      for (let i = 0; i < values.length / 3; i++) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        point.toArray(values, i * 3);
      }
      return [mesh, values];
    }));
    let maxGap = 0;
    for (const vertices of shared) {
      const first = vertices[0];
      const base = positions.get(first.mesh);
      for (const vertex of vertices.slice(1)) {
        const values = positions.get(vertex.mesh);
        for (let axis = 0; axis < 3; axis++) maxGap = Math.max(maxGap, Math.abs(values[vertex.index * 3 + axis] - base[first.index * 3 + axis]));
      }
    }
    assert.ok(maxGap < 1e-6, `${source} at ${progress}: neighboring foil triangles separate by ${maxGap} world units`);
  }
  for (let sample = 0; sample <= 40; sample++) {
    const progress = sample / 40;
    asset.setProgress(progress);
    assertJoined(progress, 'live reveal');
  }
  asset.setProgress(0);
  const clip = asset.animationClips[0];
  const mixer = new THREE.AnimationMixer(asset.group);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    for (let sample = 0; sample <= 40; sample++) {
      const progress = sample / 40;
      mixer.setTime(clip.duration * progress);
      assertJoined(progress, 'exported reveal');
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(asset.group);
  }
});

test('the interior stays behind Pepe throughout live and exported reveals without clipping his surface', t => {
  const { asset } = createFixture(t);
  const interior = asset.group.getObjectByName('PackInterior');
  assert.ok(interior?.isMesh, 'the pack must expose its interior mesh');
  assert.ok(asset.character?.isObject3D, 'the pack must expose its character');
  function assertInteriorBehindCharacter(progress, source) {
    asset.group.updateMatrixWorld(true);
    const background = depthRange(interior);
    const character = depthRange(asset.character);
    assert.ok(
      character.min > background.max + 1e-5,
      `${source} at ${progress}: interior z=${background.max} intersects or hides Pepe, whose rear surface is z=${character.min}`,
    );
  }
  for (let sample = 0; sample <= 40; sample++) {
    const progress = sample / 40;
    asset.setProgress(progress);
    assertInteriorBehindCharacter(progress, 'live reveal');
  }
  asset.setProgress(0);
  const clip = asset.animationClips[0];
  const mixer = new THREE.AnimationMixer(asset.group);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    for (let sample = 0; sample <= 40; sample++) {
      const progress = sample / 40;
      mixer.setTime(clip.duration * progress);
      assertInteriorBehindCharacter(progress, 'exported reveal');
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(asset.group);
  }
});

test('Pepe stays fully behind the sealed foil before the tear begins', t => {
  const { asset } = createFixture(t);
  const frontFoil = meshesOf(asset).filter(mesh => mesh.name.startsWith('Foil_'));
  assert.ok(frontFoil.length > 0, 'the pack must contain its front foil');
  for (let sample = 0; sample <= 10; sample++) {
    const progress = sample / 100;
    asset.setProgress(progress);
    asset.group.updateMatrixWorld(true);
    const character = depthRange(asset.character);
    const foilRear = Math.min(...frontFoil.map(mesh => depthRange(mesh).min));
    assert.ok(
      character.max < foilRear - 1e-5,
      `sealed pack at ${progress}: Pepe z=${character.max} protrudes through intact foil, whose rear surface is z=${foilRear}`,
    );
  }
});

test('the intact logo and lower label keep the same geometry and texture throughout the reveal', t => {
  const { asset, closedTexture } = createFixture(t);
  asset.setProgress(0);
  asset.group.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const zones = { upper: 0, lower: 0 };
  const samples = meshesOf(asset).filter(mesh => mesh.name.startsWith('Foil_')).map(mesh => {
    const uv = mesh.geometry.getAttribute('uv');
    const vertices = [];
    for (let i = 0; i < uv.count; i++) {
      const imageV = 1 - uv.getY(i);
      if (imageV > 0.29 && imageV < 0.78) continue;
      zones[imageV <= 0.29 ? 'upper' : 'lower']++;
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      vertices.push({ index: i, position: point.toArray(), uv: [uv.getX(i), uv.getY(i)] });
    }
    return { mesh, material: mesh.material, vertices };
  }).filter(sample => sample.vertices.length > 0);
  assert.ok(zones.upper > 0 && zones.lower > 0, 'sample both intact regions surrounding the tear');
  for (let step = 0; step <= 20; step++) {
    const progress = step / 20;
    asset.setProgress(progress);
    asset.group.updateMatrixWorld(true);
    for (const { mesh, material, vertices } of samples) {
      assert.equal(mesh.visible, true, `${mesh.name}: intact artwork hidden at ${progress}`);
      assert.equal(mesh.material, material, `${mesh.name}: material switched at ${progress}`);
      assert.equal(mesh.material.map, closedTexture, `${mesh.name}: artwork texture switched at ${progress}`);
      assert.equal(mesh.material.opacity, 1, `${mesh.name}: intact artwork faded at ${progress}`);
      const uv = mesh.geometry.getAttribute('uv');
      for (const vertex of vertices) {
        mesh.getVertexPosition(vertex.index, point).applyMatrix4(mesh.matrixWorld);
        assert.deepEqual(point.toArray(), vertex.position, `${mesh.name}: intact vertex ${vertex.index} moved at ${progress}`);
        assert.deepEqual([uv.getX(vertex.index), uv.getY(vertex.index)], vertex.uv, `${mesh.name}: artwork UV changed at ${progress}`);
      }
    }
  }
});

test('scrolling backwards restores the closed pack exactly without accumulating geometry drift', t => {
  const { asset } = createFixture(t);
  asset.setProgress(0);
  const closed = snapshot(asset);
  const closedVertices = renderedVertices(asset);
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const progress of [0.2, 0.4, 0.6, 0.8, 1, 0.8, 0.6, 0.4, 0.2, 0]) asset.setProgress(progress);
    assert.deepEqual(snapshot(asset), closed, `closed pack drifted after scroll cycle ${cycle + 1}`);
    assert.deepEqual(renderedVertices(asset), closedVertices);
  }
  asset.setProgress(0.6);
  const middle = snapshot(asset);
  asset.setProgress(1);
  asset.setProgress(0);
  asset.setProgress(0.6);
  assert.deepEqual(snapshot(asset), middle, 'a progress value must be independent of scroll history');
});

test('progress clamps out-of-range input and resets non-finite input to a safe closed state', t => {
  const { asset } = createFixture(t);
  asset.setProgress(0);
  const closed = snapshot(asset);
  asset.setProgress(1);
  const opened = snapshot(asset);
  for (const value of [-1, -100, NaN, Infinity, -Infinity, undefined, 'invalid']) {
    asset.setProgress(0.6);
    asset.setProgress(value);
    assert.deepEqual(snapshot(asset), closed, `unsafe progress ${String(value)} must produce the closed state`);
  }
  for (const value of [1.1, 100]) {
    asset.setProgress(value);
    assert.deepEqual(snapshot(asset), opened, `progress ${value} must stop at the fully open state`);
  }
  asset.setProgress(0.4);
  const numericProgress = snapshot(asset);
  asset.setProgress('0.4');
  assert.deepEqual(snapshot(asset), numericProgress, 'numeric strings follow the documented numeric coercion');
});

test('export animation tracks bind to real asset nodes and contain finite, ordered keyframes', t => {
  const { asset } = createFixture(t);
  assert.ok(Array.isArray(asset.animationClips) && asset.animationClips.length > 0);
  for (const clip of asset.animationClips) {
    assert.ok(clip.isAnimationClip || clip instanceof THREE.AnimationClip);
    assert.ok(Number.isFinite(clip.duration) && clip.duration > 0);
    assert.ok(clip.tracks.length > 0);
    assert.ok(clip.validate(), `${clip.name}: invalid animation clip`);
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const node = THREE.PropertyBinding.findNode(asset.group, parsed.nodeName);
      assert.ok(node, `${track.name}: animation node does not exist`);
      assert.ok(parsed.propertyName in node, `${track.name}: animated property does not exist`);
      assertFinite(track.times, `${track.name}: keyframe times`);
      assertFinite(track.values, `${track.name}: keyframe values`);
      assert.ok(track.times.length > 1, `${track.name}: missing animation keyframes`);
      for (let i = 1; i < track.times.length; i++) {
        assert.ok(track.times[i] >= track.times[i - 1], `${track.name}: unordered keyframes`);
      }
    }
  }
});

test('the exported animation replays the same geometric reveal as direct progress control', t => {
  const { asset } = createFixture(t);
  const clip = asset.animationClips[0];
  const expected = [0, 0.25, 0.5, 0.75, 1].map(progress => {
    asset.setProgress(progress);
    return renderedVertices(asset);
  });
  asset.setProgress(0);
  const mixer = new THREE.AnimationMixer(asset.group);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  try {
    for (const [sampleIndex, progress] of [0, 0.25, 0.5, 0.75, 1].entries()) {
      mixer.setTime(clip.duration * progress);
      const actual = renderedVertices(asset);
      for (let meshIndex = 0; meshIndex < actual.length; meshIndex++) {
        const target = expected[sampleIndex][meshIndex];
        assert.equal(actual[meshIndex].length, target.length);
        let maxError = 0;
        for (let i = 0; i < target.length; i++) maxError = Math.max(maxError, Math.abs(actual[meshIndex][i] - target[i]));
        assert.ok(maxError < 1e-6, `clip diverges from live progress at ${progress} on mesh ${meshIndex}: ${maxError}`);
      }
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(asset.group);
  }
});

test('disposing the asset releases its geometry and materials while preserving caller-owned textures', () => {
  const closedTexture = new THREE.Texture();
  const referenceTexture = new THREE.Texture();
  const asset = createPackAsset({ closedTexture, referenceTexture });
  const resources = new Set();
  for (const mesh of meshesOf(asset)) {
    resources.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(material);
  }
  const disposed = new Set();
  for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
  let callerTextureDisposals = 0;
  const onTextureDispose = () => callerTextureDisposals++;
  closedTexture.addEventListener('dispose', onTextureDispose);
  referenceTexture.addEventListener('dispose', onTextureDispose);
  try {
    asset.dispose();
    assert.equal(disposed.size, resources.size, 'all owned geometries and materials must be released');
    assert.equal(callerTextureDisposals, 0, 'caller textures must remain usable after asset disposal');
  } finally {
    closedTexture.removeEventListener('dispose', onTextureDispose);
    referenceTexture.removeEventListener('dispose', onTextureDispose);
    closedTexture.dispose();
    referenceTexture.dispose();
  }
});
