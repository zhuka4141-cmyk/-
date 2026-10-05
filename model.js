import * as THREE from "three";

export const MODEL_FILENAME = "huh.step";
export const MODEL_HASH =
  "2d6ae7e96737f5ebbc635e9d98273d3401c86a189c312e787f6bba7c9eb05a29";
export const STEP_PARAMS = {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};
export const CATEGORIES = [
  { id: "frontWing", label: "前翼", detail: "含两侧连体侧板" },
  { id: "rearWing", label: "后翼", detail: "尾部翼面" },
  { id: "wheels", label: "轮子", detail: "四轮与轮毂" },
  { id: "supports", label: "轮子支撑", detail: "独立支撑与连接件" },
  { id: "halo", label: "Halo", detail: "座舱保护架" },
];

// Verified against huh.step's assembly hierarchy, solid names and bounds.
// Indices are valid only for MODEL_HASH and the pinned OCCT version.
const CAR_PARTS = [
  ["wheels", "左后轮"],
  ["wheels", "右后轮"],
  ["wheels", "左前轮"],
  ["wheels", "右前轮"],
  ["wheels", "右前轮毂"],
  ["body", "头盔"],
  ["rearWing", "后翼翼面"],
  ["rearWing", "后翼连接件"],
  ["halo", "Halo"],
  ["frontWing", "前翼翼面"],
  ["frontWing", "右侧前翼与连体支架"],
  ["supports", "右前轮支撑 A"],
  ["supports", "右前轮支撑 B"],
  ["supports", "右前轮支撑 C"],
  ["frontWing", "左侧前翼与连体支架"],
  ["supports", "左后轮支撑"],
  ["supports", "右后轮支撑"],
  ["supports", "前部横向连接件"],
  ["supports", "后部横向连接件"],
  ["body", "车身"],
];

function categoryFromName(name) {
  if (/halo/i.test(name)) return "halo";
  if (/支撑|支架|support|suspension|axle/i.test(name)) return "supports";
  if (/前翼|front.?wing/i.test(name)) return "frontWing";
  if (/后翼|rear.?wing/i.test(name)) return "rearWing";
  if (/轮|wheel|tyre|tire/i.test(name)) return "wheels";
  return "body";
}

function meshNames(node, names = new Map(), parent = "") {
  if (!node) return names;
  const name = [parent, node.name].filter(Boolean).join("/");
  for (const i of node.meshes || []) names.set(i, name);
  for (const child of node.children || []) meshNames(child, names, name);
  return names;
}

function colorOf(value) {
  if (!Array.isArray(value) || value.length < 3)
    return new THREE.Color(0xb9c8d3);
  const scale = Math.max(...value) > 1 ? 255 : 1;
  return new THREE.Color().setRGB(
    value[0] / scale,
    value[1] / scale,
    value[2] / scale,
    THREE.SRGBColorSpace,
  );
}

export function buildModel(result, { knownModel = false } = {}) {
  if (!result.meshes?.length) throw new Error("模型中没有可渲染的实体。");
  if (knownModel && result.meshes.length !== CAR_PARTS.length)
    throw new Error("默认车型的零件结构与预期不符。");
  const root = new THREE.Group();
  const parts = [];
  const names = meshNames(result.root);
  try {
    result.meshes.forEach((data, i) => {
      const positions = data.attributes?.position?.array;
      if (!positions?.length || !data.index?.array?.length)
        throw new Error(`零件 ${i + 1} 的几何数据不完整。`);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(data.index.array);
      if (data.attributes.normal?.array?.length === positions.length) {
        geometry.setAttribute(
          "normal",
          new THREE.Float32BufferAttribute(data.attributes.normal.array, 3),
        );
      } else geometry.computeVertexNormals();

      const colors = new Float32Array(positions.length);
      const base = colorOf(data.color);
      for (let v = 0; v < positions.length / 3; v++)
        base.toArray(colors, v * 3);
      for (const face of data.brep_faces || []) {
        if (!face.color) continue;
        const color = colorOf(face.color);
        for (let t = face.first; t <= face.last; t++) {
          for (let k = 0; k < 3; k++)
            color.toArray(colors, data.index.array[t * 3 + k] * 3);
        }
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const sourceName = data.name || names.get(i) || `实体 ${i + 1}`;
      const [category, name] = knownModel
        ? CAR_PARTS[i]
        : [categoryFromName(sourceName), sourceName];
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.55,
        metalness: 0.08,
        side: THREE.DoubleSide,
      });
      const part = new THREE.Mesh(geometry, material);
      part.name = name;
      part.userData = {
        id: `part-${i}`,
        category,
        offset: new THREE.Vector3(),
        target: 0,
        amount: 0,
      };
      parts.push(part);
      root.add(part);
    });
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.y, size.z);
    const radius = Math.max(size.length() / 2, 0.001);
    for (const part of parts) {
      const c = part.geometry.boundingBox.getCenter(new THREE.Vector3());
      const side = c.x < center.x ? -1 : 1;
      switch (part.userData.category) {
        case "frontWing":
          part.userData.offset.set(0, length * 0.015, length * 0.25);
          break;
        case "rearWing":
          part.userData.offset.set(0, length * 0.1, -length * 0.24);
          break;
        case "wheels":
          part.userData.offset.set(side * length * 0.24, 0, 0);
          break;
        case "supports":
          part.userData.offset.set(
            Math.abs(c.x - center.x) < size.x * 0.06 ? 0 : side * length * 0.13,
            -length * 0.09,
            0,
          );
          break;
        case "halo":
          part.userData.offset.set(0, length * 0.32, 0);
          break;
      }
    }
    return { root, parts, bounds, center, radius };
  } catch (error) {
    disposeModel({ root, parts });
    throw error;
  }
}

export function setExploded(model, ids, amount) {
  const selected = new Set(ids);
  const distance = Number.isFinite(amount)
    ? THREE.MathUtils.clamp(amount, 0, 1.5)
    : 0;
  for (const part of model.parts)
    part.userData.target = selected.has(part.userData.category) ? distance : 0;
}

export function updateExplosion(model, dt, reducedMotion = false) {
  let moving = false;
  for (const part of model.parts) {
    const data = part.userData;
    data.amount +=
      (data.target - data.amount) *
      (reducedMotion ? 1 : 1 - Math.exp(-12 * Math.max(0, dt)));
    if (Math.abs(data.target - data.amount) < 0.0001) data.amount = data.target;
    part.position.copy(data.offset).multiplyScalar(data.amount);
    moving ||= data.target !== data.amount;
  }
  return moving;
}

export function disposeModel(model) {
  model.root.removeFromParent();
  model.root.traverse((object) => {
    object.geometry?.dispose();
    if (object.material) object.material.dispose();
  });
}
