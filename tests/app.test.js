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

test('multiply multiplies two numbers', () => {
  assert.equal(multiply(2, 3), 6);
  assert.equal(multiply(-2, 3), -6);
  assert.equal(multiply(-2, -3), 6);
  assert.equal(multiply(5, 0), 0);
});

test('divide divides a by b and throws on division by zero', () => {
  assert.equal(divide(6, 3), 2);
  assert.equal(divide(5, 2), 2.5);
  assert.equal(divide(-6, 3), -2);
  assert.throws(
    () => divide(5, 0),
    {
      name: 'Error',
      message: 'Division by zero'
    }
  );
});

test('square handles positive, zero, and negative numbers', () => {
  assert.equal(square(4), 16);
  assert.equal(square(0), 0);
  assert.equal(square(-0), 0);
  assert.equal(square(-5), 25);
  assert.equal(square(-2.5), 6.25);
});

test('average calculates mean of numbers in array and handles errors', () => {
  assert.equal(average([2, 4, 6]), 4);
  assert.equal(average([10]), 10);
  assert.equal(average([-5, 5]), 0);
  assert.equal(average([1, 2]), 1.5);
  assert.throws(
    () => average([]),
    {
      name: 'Error',
      message: 'average() requires a non-empty array'
    }
  );
  assert.throws(
    () => average(null),
    {
      name: 'Error',
      message: 'average() requires a non-empty array'
    }
  );
  assert.throws(
    () => average('1,2,3'),
    {
      name: 'Error',
      message: 'average() requires a non-empty array'
    }
  );
});

test('percentage calculates percentage and throws on zero total', () => {
  assert.equal(percentage(25, 100), 25);
  assert.equal(percentage(1, 3), 33.33);
  assert.equal(percentage(2, 3), 66.67);
  assert.equal(percentage(0, 50), 0);
  assert.throws(
    () => percentage(10, 0),
    {
      name: 'Error',
      message: 'percentage() cannot divide by zero total'
    }
  );
});
