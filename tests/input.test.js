import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPointerInput } from '../interaction.js';

test('automatic mode paints with Apple Pencil and orbits with a finger', () => {
  assert.equal(classifyPointerInput({ pointerType: 'pen', button: 0 }, 'auto'), 'paint');
  assert.equal(classifyPointerInput({ pointerType: 'touch', button: 0 }, 'auto'), 'orbit');
});

test('manual modes remain available for mouse and stylus workflows', () => {
  assert.equal(classifyPointerInput({ pointerType: 'mouse', button: 0 }, 'paint'), 'paint');
  assert.equal(classifyPointerInput({ pointerType: 'mouse', button: 0 }, 'orbit'), 'orbit');
  assert.equal(classifyPointerInput({ pointerType: 'touch', button: 0 }, 'paint'), 'paint');
  assert.equal(classifyPointerInput({ pointerType: 'pen', button: 0 }, 'orbit'), 'orbit');
});

test('secondary mouse buttons never start painting', () => {
  assert.equal(classifyPointerInput({ pointerType: 'mouse', button: 2 }, 'paint'), null);
  assert.equal(classifyPointerInput({ pointerType: 'pen', button: 2 }, 'auto'), null);
});
