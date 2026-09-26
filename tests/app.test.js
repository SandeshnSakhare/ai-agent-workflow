const test = require('node:test');
const assert = require('node:assert/strict');
const { add, subtract, multiply, divide, square, average, percentage } = require('../scripts/app.js');

test('add adds two numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test('subtract subtracts b from a', () => {
  assert.equal(subtract(5, 3), 2);
  assert.equal(subtract(0, 4), -4);
});

test('square handles positive, zero, and negative numbers', () => {
  assert.equal(square(4), 16);
  assert.equal(square(0), 0);
  assert.equal(square(-0), 0);
  assert.equal(square(-5), 25);
  assert.equal(square(-2.5), 6.25);
});
