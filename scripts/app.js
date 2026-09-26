'use strict';

/**
 * Calculator utilities — intentionally simple, well-documented, and testable.
 * Used as the target for the demo multi-agent pipeline: developer agent adds
 * features, unit-test agent adds tests, review agent reviews, CI gates merge.
 */

/** Add two numbers. */
function add(a, b) {
  return a + b;
}

/** Subtract b from a. */
function subtract(a, b) {
  return a - b;
}

/** Multiply two numbers. */
function multiply(a, b) {
  return a * b;
}

/** Divide a by b. Throws on division by zero. */
function divide(a, b) {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}

/** Return the square of a number. */
function square(a) {
  return a * a;
}

/** Return the arithmetic mean of an array of numbers. Empty array throws. */
function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('average() requires a non-empty array');
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/** Percentage of `part` out of `total`, rounded to 2 decimals. */
function percentage(part, total) {
  if (total === 0) {
    throw new Error('percentage() cannot divide by zero total');
  }
  return Math.round((part / total) * 10000) / 100;
}

module.exports = { add, subtract, multiply, divide, square, average, percentage };
