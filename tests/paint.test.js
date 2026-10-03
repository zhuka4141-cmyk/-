import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import {
  createDecal,
  validateDrawing,
  serializeDrawing,
  restoreDrawing,
  removeStroke,
} from "../paint.js";

test("a mark made on a separated part stays attached after assembly", () => {
  const part = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  part.userData.id = "part-0";
  part.position.set(10, 0, 0);
  part.updateMatrixWorld(true);
  const point = part.worldToLocal(new THREE.Vector3(10, 0, 1));
  const decal = createDecal(
    part,
    point,
    new THREE.Vector3(0, 0, 1),
    "#ffcc00",
    0.5,
    null,
  );
  assert.ok(decal.geometry.attributes.position.count > 0);
  assert.equal(decal.parent, part);
  assert.ok(
    new THREE.Box3().setFromObject(decal).getCenter(new THREE.Vector3()).x > 9,
  );
  part.position.set(0, 0, 0);
  part.updateMatrixWorld(true);
  assert.ok(
    Math.abs(
      new THREE.Box3().setFromObject(decal).getCenter(new THREE.Vector3()).x,
    ) < 0.001,
  );
});

test("drawing import rejects cross-model, invalid part and non-finite coordinates before applying changes", () => {
  const parts = [{ userData: { id: "part-0" } }];
  const good = {
    version: 2,
    modelKey: "car-sha",
    strokes: [
      {
        color: "#ffcc00",
        stamps: [{ part: "part-0", p: [0, 0, 1], n: [0, 0, 1], s: 0.5 }],
      },
    ],
  };
  assert.doesNotThrow(() => validateDrawing(good, "car-sha", parts));
  assert.throws(() => validateDrawing(good, "other-car", parts), /车型/);
  const wrongPart = structuredClone(good);
  wrongPart.strokes[0].stamps[0].part = "part-missing";
  assert.throws(() => validateDrawing(wrongPart, "car-sha", parts), /零件/);
  const invalid = structuredClone(good);
  invalid.strokes[0].stamps[0].p[0] = Infinity;
  assert.throws(() => validateDrawing(invalid, "car-sha", parts), /坐标/);
  const legacy = { version: 1, strokes: [] };
  assert.throws(() => validateDrawing(legacy, "car-sha", parts), /版本/);
});

test("exported drawing restores on its original part, and undo removes only that stroke", () => {
  const part = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  part.userData.id = "part-0";
  const saved = serializeDrawing("model-a", "a.step", [
    {
      color: "#ffcc00",
      stamps: [{ part: "part-0", p: [0, 0, 1], n: [0, 0, 1], s: 0.5 }],
    },
  ]);
  const strokes = restoreDrawing(
    JSON.parse(JSON.stringify(saved)),
    "model-a",
    [part],
    null,
  );
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].meshes.length, 1);
  assert.equal(part.children.length, 1);
  assert.throws(() => restoreDrawing(saved, "model-b", [part], null), /车型/);
  assert.equal(part.children.length, 1);
  removeStroke(strokes[0]);
  assert.equal(part.children.length, 0);
});
