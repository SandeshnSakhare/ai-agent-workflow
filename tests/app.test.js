const test = require('node:test');
const assert = require('node:assert/strict');
const { add, subtract, multiply, divide, average, percentage } = require('../scripts/app.js');

test('add adds two numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
});

test('subtract subtracts b from a', () => {
  assert.equal(subtract(5, 3), 2);
  assert.equal(subtract(0, 4), -4);
});
