import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createDecal, consolidateStroke, serializeDrawing, restoreDrawing } from "../paint.js";

test("solid colors retain chronological coverage after consolidation and restore", () => {
  const part = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  part.userData.id = "body";
  const strokes = ["#ffff00", "#ff0000"].map(color => {
    const mesh = createDecal(part, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1), color, 1, null, { soft: false, opacity: 1 });
    const stroke = { color, soft: false, opacity: 1, meshes: [mesh], stamps: [{ part: "body", p: [0, 0, 1], n: [0, 0, 1], s: 1, soft: false, opacity: 1 }] };
    consolidateStroke(stroke, null);
    return stroke;
  });
  assert.ok(strokes[1].meshes[0].renderOrder > strokes[0].meshes[0].renderOrder);
  assert.equal(strokes[1].meshes[0].material.opacity, 1);
  assert.equal(strokes[1].meshes[0].material.transparent, true);
  assert.equal(strokes[1].meshes[0].material.map, null);
  const saved = serializeDrawing("model", "car", strokes);
  const restored = restoreDrawing(saved, "model", [part], null);
  assert.equal(restored[0].order, strokes[0].order);
  assert.equal(restored[1].order, strokes[1].order);
  assert.ok(restored[1].meshes[0].renderOrder > restored[0].meshes[0].renderOrder);
  const shader = { vertexShader: "#include <uv_vertex>", fragmentShader: "#include <alphatest_fragment>" };
  restored[1].meshes[0].material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /distance\(vPaintUv/);
});
