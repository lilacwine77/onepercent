/* eslint-disable */
// Synced from experience/lab/src/rip/vendor/pack-asset.js by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
import * as THREE from "three";
import {
  FACE,
  LEFT_HAND,
  RIGHT_HAND,
  RIGHT_FOREARM,
} from "./pack-character.js";

// All front UVs retain the photographic lighting of the supplied 1254 px image.
// This is a view-dependent relief reconstruction, with actual foil morphs.
const SIZE = 1254;
const SCALE = 4 / SIZE;
const clamp = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const ease = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
const world = ([x, y]) =>
  new THREE.Vector2((x - SIZE / 2) * SCALE, (SIZE / 2 - y) * SCALE);

const SHARDS = [
  [
    [80, 443],
    [111, 436],
    [122, 488],
    [143, 521],
    [174, 546],
    [215, 559],
    [211, 580],
    [180, 576],
    [144, 560],
    [119, 542],
    [93, 511],
    [86, 480],
  ],
  [
    [24, 722],
    [61, 706],
    [99, 697],
    [138, 686],
    [171, 693],
    [153, 713],
    [132, 727],
    [124, 755],
    [85, 742],
    [58, 733],
  ],
  [
    [1150, 647],
    [1172, 670],
    [1189, 698],
    [1202, 728],
    [1225, 791],
    [1197, 779],
    [1173, 760],
    [1175, 729],
    [1171, 706],
    [1160, 676],
  ],
  [
    [1092, 862],
    [1119, 858],
    [1148, 836],
    [1168, 844],
    [1198, 864],
    [1231, 895],
    [1192, 914],
    [1151, 906],
    [1118, 894],
  ],
];

const INTERIOR = [
  [253, 25],
  [1065, 112],
  [1045, 354],
  [1055, 494],
  [1050, 710],
  [1110, 1139],
  [125, 1059],
  [182, 767],
  [217, 564],
  [210, 423],
  [253, 264],
];

function pathFrom(points, Path = THREE.Path) {
  const p = new Path();
  points.forEach((xy, i) => {
    const v = world(xy);
    if (i) p.lineTo(v.x, v.y);
    else p.moveTo(v.x, v.y);
  });
  p.closePath();
  return p;
}

function reliefGeometry(points, holes = [], height = () => 0, detail = 0.14) {
  const shape = pathFrom(points, THREE.Shape);
  holes.forEach((p) => shape.holes.push(pathFrom(p)));
  const flat = new THREE.ShapeGeometry(shape);
  const pos = flat.attributes.position;
  const index = flat.index;
  const vertices = [];
  function subdivide(a, b, c, level) {
    const ab = a.distanceToSquared(b),
      bc = b.distanceToSquared(c),
      ca = c.distanceToSquared(a);
    if (level > 7 || Math.max(ab, bc, ca) <= detail * detail) {
      vertices.push(a, b, c);
      return;
    }
    const m = (v, w) => v.clone().add(w).multiplyScalar(0.5);
    const d = m(a, b),
      e = m(b, c),
      f = m(c, a);
    subdivide(a, d, f, level + 1);
    subdivide(d, b, e, level + 1);
    subdivide(f, e, c, level + 1);
    subdivide(d, e, f, level + 1);
  }
  for (let i = 0; i < index.count; i += 3)
    subdivide(
      ...[0, 1, 2].map(
        (j) =>
          new THREE.Vector2(
            pos.getX(index.getX(i + j)),
            pos.getY(index.getX(i + j)),
          ),
      ),
      0,
    );
  const p = [],
    uv = [];
  for (const v of vertices) {
    const px = v.x / SCALE + SIZE / 2,
      py = SIZE / 2 - v.y / SCALE;
    p.push(v.x, v.y, height(px, py));
    uv.push(px / SIZE, 1 - py / SIZE);
  }
  flat.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

const gauss = (x, y, cx, cy, rx, ry) =>
  Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
function faceDepth(x, y) {
  return (
    0.095 +
    0.29 * gauss(x, y, 636, 660, 273, 246) +
    0.078 * gauss(x, y, 636, 523, 122, 60) +
    0.058 * gauss(x, y, 827, 605, 79, 62) +
    0.07 * gauss(x, y, 690, 741, 233, 53)
  );
}

const TEAR_KNOTS = (() => {
  const random = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const knots = [[0, 0]];
  for (let u = 0, i = 1; u < 1; i++) {
    u = Math.min(1, u + 0.011 + 0.024 * random(i));
    knots.push([
      u,
      (random(i + 97) * 2 - 1) * (0.0025 + 0.003 * random(i + 193)),
    ]);
  }
  return knots;
})();

function tearNoise(u) {
  let i = 1;
  while (i < TEAR_KNOTS.length - 1 && TEAR_KNOTS[i][0] < u) i++;
  const a = TEAR_KNOTS[i - 1],
    b = TEAR_KNOTS[i];
  return THREE.MathUtils.lerp(a[1], b[1], clamp((u - a[0]) / (b[0] - a[0])));
}
function tearY(u) {
  return 0.491 + 0.021 * Math.sin(u * 8.1) + tearNoise(u);
}

// Unequal widths and off-centre tips make stretched foil tongues, not a row
// of identical teeth. These remain part of the connected sheet topology.
const TEAR_TABS = [
  [0.142, 0.158, 0.177, 0.014],
  [0.201, 0.211, 0.238, 0.021],
  [0.262, 0.289, 0.301, 0.009],
  [0.321, 0.329, 0.36, 0.023],
  [0.383, 0.41, 0.427, 0.017],
  [0.455, 0.467, 0.5, 0.012],
  [0.521, 0.531, 0.57, 0.024],
  [0.603, 0.635, 0.65, 0.016],
  [0.676, 0.684, 0.708, 0.023],
  [0.735, 0.753, 0.779, 0.011],
  [0.804, 0.815, 0.856, 0.025],
  [0.871, 0.887, 0.903, 0.014],
];

function tornFacet(u) {
  for (let i = 0; i < TEAR_TABS.length; i++) {
    const [left, tip, right, height] = TEAR_TABS[i];
    if (u < left || u > right) continue;
    const weight =
      u < tip ? (u - left) / (tip - left) : (right - u) / (right - tip);
    return { height: height * weight, lean: (i % 2 ? 1 : -1) * weight };
  }
  return { height: 0, lean: 0 };
}

function hingeY(u, upper) {
  // The intact branding meets the flexible foil along irregular creases.
  return upper
    ? 0.303 +
        0.05 * Math.pow(Math.abs((u - 0.52) / 0.52), 1.8) +
        0.005 * Math.sin(u * 23)
    : Math.max(
        0.735,
        Math.min(
          0.772,
          0.747 + 0.013 * Math.sin(u * 15) + 0.008 * Math.sin(u * 39 + 0.4),
        ),
      );
}

// Source-space edge paths retain the characteristic sloping upper opening and
// the deep V below the character, without a second photographed foil surface.
const TOP_LIP = [
  [0, 620],
  [175, 550],
  [250, 482],
  [350, 430],
  [470, 394],
  [620, 378],
  [745, 394],
  [850, 425],
  [980, 454],
  [1100, 551],
  [1254, 620],
];
const BOTTOM_LIP = [
  [0, 620],
  [175, 664],
  [220, 675],
  [285, 681],
  [340, 696],
  [355, 699],
  [392, 713],
  [423, 726],
  [455, 747],
  [484, 765],
  [512, 781],
  [537, 790],
  [548, 811],
  [566, 832],
  [590, 845],
  [614, 862],
  [636, 883],
  [672, 903],
  [699, 924],
  [720, 907],
  [760, 871],
  [800, 844],
  [844, 820],
  [880, 806],
  [920, 794],
  [943, 775],
  [972, 793],
  [1007, 825],
  [1039, 858],
  [1053, 860],
  [1075, 843],
  [1120, 830],
  [1254, 705],
];
const FOIL_POSES = 32;

function edgeY(u, upper) {
  const path = upper ? TOP_LIP : BOTTOM_LIP;
  const x = u * SIZE;
  let i = 1;
  while (i < path.length - 1 && path[i][0] < x) i++;
  const a = path[i - 1],
    b = path[i];
  const y =
    THREE.MathUtils.lerp(a[1], b[1], clamp((x - a[0]) / (b[0] - a[0]))) / SIZE;
  const variation = upper
    ? 0.72 + 0.28 * Math.sin(u * 17) ** 2
    : 0.72 + 0.28 * Math.cos(u * 23) ** 2;
  // Extend tongues into the opening; shallow notches retain the overlap that
  // covers the photographed character's cut edges below the moving foil.
  const serration = Math.max(
    -0.002,
    tornFacet(u).height * variation + tearNoise(u) * 0.9,
  );
  return y + (upper ? 1 : -1) * serration;
}

function foilPosition(u, v, t, upper, p) {
  const x = (u - 0.5) * 4,
    y = (0.5 - v) * 4;
  const z = 0.65 + 0.015 * Math.sin(u * 11) * Math.sin(v * 9);
  if (t === 0) return [x, y, z];
  // A continuous field gives neighbouring vertices exactly the same timing.
  // The mesh remains welded across the whole sheet throughout the rip.
  const opening = ease((p - (0.13 + u * 0.15)) / 0.63);
  const curl = Math.sin(Math.PI * opening);
  const pressure = Math.sin(Math.PI * ease(p / 0.28)) * (1 - opening);
  const anchorY = (0.5 - hingeY(u, upper)) * 4;
  const endY = (0.5 - edgeY(u, upper)) * 4;
  const bow = Math.sin(Math.PI * t);
  const crease =
    (0.02 * Math.sin(u * 47 + t * 9) + 0.012 * Math.sin(u * 81 - t * 12)) * bow;
  const finalY = THREE.MathUtils.lerp(anchorY, endY, t) + crease;
  const swelling =
    gauss(u, v, 0.53, 0.5, 0.34, 0.31) * ease(t / 0.25) * pressure;
  const facet = tornFacet(u);
  const edgeBand = t ** 4 * opening;
  return [
    x * (1 + 0.025 * swelling) +
      0.016 * Math.sin(u * 31) * bow * opening +
      0.022 * facet.lean * edgeBand,
    THREE.MathUtils.lerp(y, finalY, opening) +
      (upper ? 1 : -1) * 0.12 * curl * bow +
      0.025 * swelling,
    z +
      0.14 * swelling +
      (0.15 * opening + 0.43 * curl) * bow +
      0.035 * Math.sin(u * 41 + t * 13) * bow * opening +
      0.11 * (facet.height / 0.025) * edgeBand,
  ];
}

function coverGeometry(upper) {
  const pos = [],
    uv = [],
    index = [],
    parameters = [];
  // Include every tear corner so narrow notches stay sharp at any viewport.
  const columnUs = [
    ...new Set([
      ...Array.from({ length: 129 }, (_, i) => i / 128),
      ...TEAR_TABS.flatMap(([left, tip, right]) => [left, tip, right]),
      ...TEAR_KNOTS.map(([u]) => u),
    ]),
  ].sort((a, b) => a - b);
  const columns = columnUs.length - 1,
    rows = 32,
    hingeRow = 16;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) {
      const u = columnUs[i],
        seam = tearY(u),
        anchor = hingeY(u, upper);
      const firstHalf = j <= hingeRow;
      const v = upper
        ? firstHalf
          ? (anchor * j) / hingeRow
          : THREE.MathUtils.lerp(
              anchor,
              seam,
              (j - hingeRow) / (rows - hingeRow),
            )
        : firstHalf
          ? THREE.MathUtils.lerp(seam, anchor, j / hingeRow)
          : THREE.MathUtils.lerp(anchor, 1, (j - hingeRow) / (rows - hingeRow));
      const extension = upper
        ? Math.max(0, v - anchor)
        : Math.max(0, anchor - v);
      const t =
        extension === 0 ? 0 : clamp(extension / Math.abs(seam - anchor));
      parameters.push([u, v, t]);
      pos.push(...foilPosition(u, v, t, upper, 0));
      uv.push(u, 1 - v);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const a = j * (columns + 1) + i,
        b = a + 1,
        c = a + columns + 1,
        d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  // Each morph is a sampled pose of this same connected sheet. Two adjacent
  // poses are interpolated live and in glTF; there are no independent strips.
  g.morphAttributes.position = [];
  g.morphTargetsRelative = true;
  for (let frame = 1; frame <= FOIL_POSES; frame++) {
    const positions = [];
    for (const [u, v, t] of parameters)
      positions.push(...foilPosition(u, v, t, upper, frame / FOIL_POSES));
    const target = new THREE.Float32BufferAttribute(positions, 3);
    // Zero deltas keep intact vertices bit-for-bit stationary on the GPU too.
    // Blending absolute positions introduced small rounding changes in the logo.
    for (let i = 0; i < target.array.length; i++)
      target.array[i] -= g.attributes.position.array[i];
    target.name = `Continuous foil ${frame}`;
    g.morphAttributes.position.push(target);
  }
  g.computeVertexNormals();
  return g;
}

function sheetWeights(p) {
  const frame = p * FOIL_POSES,
    lower = Math.floor(frame),
    fraction = frame - lower;
  const weights = new Array(FOIL_POSES).fill(0);
  if (lower > 0) weights[lower - 1] = 1 - fraction;
  if (lower < FOIL_POSES) weights[lower] = fraction;
  return weights;
}

/**
 * Creates a four-unit, front-facing pack. The caller owns both input textures.
 * Geometry and materials are unique to this instance; no WebGL renderer needed.
 */
export function createPackAsset({ closedTexture, referenceTexture } = {}) {
  if (!closedTexture?.isTexture || !referenceTexture?.isTexture)
    throw new TypeError(
      "createPackAsset requires closedTexture and referenceTexture.",
    );
  const group = new THREE.Group();
  group.name = "OnePercentPack";
  group.userData = {
    assetType: "camera-projected 3D relief",
    referenceResolution: [SIZE, SIZE],
    idealCamera: "orthographic, positive Z",
    progress: 0,
  };
  const geometries = new Set(),
    materials = new Set(),
    meshes = [];
  function material(options) {
    const m = new THREE.MeshBasicMaterial({ toneMapped: false, ...options });
    materials.add(m);
    return m;
  }
  function mesh(name, g, m, parent = group) {
    geometries.add(g);
    const object = new THREE.Mesh(g, m);
    object.name = name;
    parent.add(object);
    meshes.push(object);
    return object;
  }
  const source = material({ map: referenceTexture, side: THREE.DoubleSide });
  // glTF preserves DoubleSide; a separate BackSide overlay would not export
  // consistently and would double the draw calls for identical foil surfaces.
  const shell = material({
    map: closedTexture,
    alphaTest: 0.035,
    side: THREE.DoubleSide,
  });
  const rim = material({ color: 0x090609, side: THREE.DoubleSide });
  // Keep the interior behind every character vertex at every pose. Its former
  // shallow depth intersected the relief and produced a circular black wipe.
  const back = mesh(
    "PackInterior",
    reliefGeometry(INTERIOR, [], () => -0.85, 0.22),
    rim,
  );
  const character = new THREE.Group();
  character.name = "PepeRelief";
  group.add(character);
  function joint(name, point, z, geometry, meshName) {
    const pivot = world(point);
    const node = new THREE.Group();
    node.name = name;
    node.userData.rest = [pivot.x, pivot.y, z];
    node.position.set(pivot.x, pivot.y, z);
    character.add(node);
    geometry.translate(-pivot.x, -pivot.y, -z);
    mesh(meshName, geometry, source, node);
    return node;
  }
  const head = joint(
    "PepeHeadJoint",
    [650, 870],
    0.13,
    reliefGeometry(FACE, [], faceDepth, 0.1),
    "PepeFace",
  );
  const leftHand = joint(
    "PepeLeftHandJoint",
    [293, 633],
    0.18,
    reliefGeometry(
      LEFT_HAND,
      [],
      (x, y) => 0.12 + 0.15 * gauss(x, y, 291, 625, 104, 80),
      0.09,
    ),
    "PepeLeftHand",
  );
  const rightHand = joint(
    "PepeRightHandJoint",
    [1026, 787],
    0.18,
    reliefGeometry(
      RIGHT_HAND,
      [],
      (x, y) => 0.13 + 0.16 * gauss(x, y, 1030, 786, 97, 92),
      0.09,
    ),
    "PepeRightHand",
  );
  const forearmGeometry = reliefGeometry(
    RIGHT_FOREARM,
    [],
    (x, y) => 0.1 + 0.055 * gauss(x, y, 923, 780, 112, 83),
    0.09,
  );
  const [armX, armY, armZ] = rightHand.userData.rest;
  forearmGeometry.translate(-armX, -armY, -armZ);
  mesh("PepeRightForearm", forearmGeometry, source, rightHand);

  const strips = [true, false].map((upper) => {
    const front = mesh(
      `Foil_${upper ? "top" : "bottom"}`,
      coverGeometry(upper),
      shell,
    );
    return { front, upper };
  });
  const shards = SHARDS.map((points, i) => {
    const object = mesh(
      `TornFragment_${i}`,
      reliefGeometry(
        points,
        [],
        (x, y) => 0.08 + 0.018 * Math.sin(x * 0.1 + y * 0.05),
        0.1,
      ),
      source,
    );
    const original = object.geometry.attributes.position;
    const opened = original.clone();
    const center = new THREE.Vector3();
    for (let j = 0; j < original.count; j++)
      center.add(new THREE.Vector3().fromBufferAttribute(original, j));
    center.divideScalar(original.count);
    for (let j = 0; j < original.count; j++)
      original.setXYZ(j, center.x, center.y, -0.18);
    object.geometry.morphAttributes.position = [opened];
    object.updateMorphTargets();
    return object;
  });

  function setProgress(input) {
    const p = clamp(Number(input));
    group.userData.progress = p;
    const expansion = ease((p - 0.08) / 0.26);
    back.scale.set(0.82 + 0.18 * expansion, 0.92 + 0.08 * expansion, 1);
    // A neck pivot makes the head lift, lean and settle visibly in the reference
    // orthographic view. Every joint returns exactly to the source pose at 1.
    const emergence = ease((p - 0.25) / 0.65);
    const anticipation = 1 - emergence;
    const settle = Math.sin(Math.PI * emergence);
    const [hx, hy, hz] = head.userData.rest;
    head.position.set(
      hx - 0.07 * anticipation,
      hy - 0.19 * anticipation + 0.055 * settle,
      hz + 0.09 * settle,
    );
    head.rotation.set(
      0.055 * anticipation,
      -0.085 * anticipation,
      -0.115 * anticipation + 0.028 * settle,
    );
    head.scale.setScalar(0.92 + 0.08 * emergence + 0.02 * settle);
    for (const [hand, side, delay] of [
      [leftHand, -1, 0.14],
      [rightHand, 1, 0.21],
    ]) {
      const grasp = ease((p - delay) / 0.59);
      const reach = 1 - grasp;
      const pull = Math.sin(Math.PI * grasp);
      const [x, y, z] = hand.userData.rest;
      hand.position.set(
        x - side * 0.14 * reach + side * 0.055 * pull,
        y - 0.105 * reach + 0.045 * pull,
        z + 0.065 * pull,
      );
      hand.rotation.set(
        0,
        -side * 0.055 * reach,
        -side * (0.095 * reach + 0.05 * pull),
      );
      hand.scale.setScalar(0.88 + 0.12 * grasp + 0.012 * pull);
    }
    for (const s of strips) {
      const weights = sheetWeights(p);
      weights.forEach((weight, i) => {
        s.front.morphTargetInfluences[i] = weight;
      });
    }
    shards.forEach((s, i) => {
      s.morphTargetInfluences[0] = ease((p - (0.37 + i * 0.05)) / 0.36);
    });
  }

  // Sample the same progress function used by the live scroll. The GLB carries
  // genuine animated positions and morph weights, without a browser dependency.
  const times = [],
    tracks = [],
    duration = 4,
    samples = 161;
  const animated = [
    back,
    head,
    leftHand,
    rightHand,
    ...strips.map((s) => s.front),
    ...shards,
  ];
  const channels = animated.flatMap((node) =>
    node.morphTargetInfluences
      ? [
          {
            node,
            property: "morphTargetInfluences",
            type: THREE.NumberKeyframeTrack,
            values: [],
          },
        ]
      : ["position", "quaternion", "scale"].map((property) => ({
          node,
          property,
          type:
            property === "quaternion"
              ? THREE.QuaternionKeyframeTrack
              : THREE.VectorKeyframeTrack,
          values: [],
        })),
  );
  for (let i = 0; i < samples; i++) {
    const p = i / (samples - 1);
    times.push(p * duration);
    setProgress(p);
    for (const channel of channels) {
      const value = channel.node[channel.property];
      channel.values.push(...(value.toArray ? value.toArray() : value));
    }
  }
  for (const channel of channels)
    tracks.push(
      new channel.type(
        `${channel.node.name}.${channel.property}`,
        times,
        channel.values,
      ),
    );
  const animationClips = [
    new THREE.AnimationClip("Rip Reveal Own", duration, tracks),
  ];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    group.removeFromParent();
  }
  setProgress(0);
  return {
    group,
    setProgress,
    dispose,
    animationClips,
    meshes,
    dimensions: { width: 4, height: 4, depth: 2.8 },
    character,
    strips,
    joints: { head, leftHand, rightHand },
  };
}
