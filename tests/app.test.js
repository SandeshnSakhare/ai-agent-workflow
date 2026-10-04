const test = require('node:test');
const assert = require('node:assert/strict');
const {
  add,
  subtract,
  multiply,
  divide,
  square,
  average,
  percentage,
  calculate
} = require('../scripts/app.js');

test('add adds two numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1, 1), 0);
  assert.equal(add(-4, -6), -10);
  assert.equal(add(0, 0), 0);
  assert.equal(add(1.5, 2.25), 3.75);
});

test('subtract subtracts b from a', () => {
  assert.equal(subtract(5, 3), 2);
  assert.equal(subtract(0, 4), -4);
  assert.equal(subtract(-5, -5), 0);
  assert.equal(subtract(-3, 7), -10);
  assert.equal(subtract(5.5, 1.25), 4.25);
});

test('multiply multiplies two numbers', () => {
  assert.equal(multiply(2, 3), 6);
  assert.equal(multiply(-2, 3), -6);
  assert.equal(multiply(-2, -3), 6);
  assert.equal(multiply(5, 0), 0);
  assert.equal(multiply(0, -5), 0);
  assert.equal(multiply(2.5, 4), 10);
});

test('divide divides a by b and throws on division by zero', () => {
  assert.equal(divide(6, 3), 2);
  assert.equal(divide(5, 2), 2.5);
  assert.equal(divide(-6, 3), -2);
  assert.equal(divide(0, 5), 0);
  assert.throws(
    () => divide(5, 0),
    {
      name: 'Error',
      message: 'Division by zero'
    }
  );
  assert.throws(
    () => divide(0, 0),
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
  assert.equal(average([-10, -20, -30]), -20);
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
    () => average(undefined),
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
  assert.throws(
    () => average(123),
    {
      name: 'Error',
      message: 'average() requires a non-empty array'
    }
  );
  assert.throws(
    () => average({}),
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
  assert.equal(percentage(-5, 50), -10);
  assert.equal(percentage(50, -100), -50);
  assert.equal(percentage(150, 100), 150);
  assert.throws(
    () => percentage(10, 0),
    {
      name: 'Error',
      message: 'percentage() cannot divide by zero total'
    }
  );
});

test('calculate handles basic arithmetic with positive, negative, and zero values', () => {
  assert.equal(calculate('5', '+', '3'), 8);
  assert.equal(calculate('-5', '+', '3'), -2);
  assert.equal(calculate('-5', '+', '-5'), -10);

  assert.equal(calculate('10', '-', '4'), 6);
  assert.equal(calculate('4', '-', '10'), -6);
  assert.equal(calculate('-4', '-', '-6'), 2);

  assert.equal(calculate('6', '*', '7'), 42);
  assert.equal(calculate('-6', '*', '7'), -42);
  assert.equal(calculate('-6', '*', '-7'), 42);
  assert.equal(calculate('0', '*', '99'), 0);

  assert.equal(calculate('20', '/', '4'), 5);
  assert.equal(calculate('-20', '/', '4'), -5);
  assert.equal(calculate('0', '/', '5'), 0);

  assert.equal(calculate('1.5', '+', '2.5'), 4);
  assert.equal(calculate(3, '*', 4), 12);
});

test('calculate handles square with ^2 and sqr operators', () => {
  assert.equal(calculate('-4', '^2'), 16);
  assert.equal(calculate('0', '^2'), 0);
  assert.equal(calculate('5', '^2'), 25);
  assert.equal(calculate('5', 'sqr'), 25);
  assert.equal(calculate('-3', 'sqr'), 9);
  assert.equal(calculate(2.5, 'sqr'), 6.25);
});

test('calculate safely throws error on division by zero without breaking', () => {
  assert.throws(
    () => calculate('12', '/', '0'),
    {
      name: 'Error',
      message: 'Division by zero'
    }
  );
  assert.throws(
    () => calculate(5, '/', 0),
    {
      name: 'Error',
      message: 'Division by zero'
    }
  );
});

test('calculate rejects invalid operations or non-numeric inputs', () => {
  assert.throws(
    () => calculate('abc', '+', '5'),
    {
      name: 'Error',
      message: 'Invalid number'
    }
  );
  assert.throws(
    () => calculate('5', '+', 'xyz'),
    {
      name: 'Error',
      message: 'Invalid number'
    }
  );
  assert.throws(
    () => calculate('invalid', '^2'),
    {
      name: 'Error',
      message: 'Invalid number'
    }
  );
  assert.throws(
    () => calculate('invalid', 'sqr'),
    {
      name: 'Error',
      message: 'Invalid number'
    }
  );
  assert.throws(
    () => calculate(undefined, '+', 5),
    {
      name: 'Error',
      message: 'Invalid number'
    }
  );
  assert.throws(
    () => calculate(5, '+', undefined),
    {
      name: 'Error',
      message: 'Invalid number'
    }
  );
  assert.throws(
    () => calculate('5', '%', '2'),
    {
      name: 'Error',
      message: 'Unknown operation: %'
    }
  );
  assert.throws(
    () => calculate('5', 'unknown', '2'),
    {
      name: 'Error',
      message: 'Unknown operation: unknown'
    }
  );
});
