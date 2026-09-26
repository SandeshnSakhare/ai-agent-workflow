'use strict';

/**
 * Browser wiring for the demo calculator page.
 * Pure calculation logic lives in scripts/app.js (CommonJS, covered by
 * node:test unit tests); this file only handles DOM events.
 */

const form = document.getElementById('calc-form');
const resultEl = document.getElementById('result');

/** Map the selected operator symbol to a calculator function. */
function resolveOperation(op) {
  switch (op) {
    case '+': return (a, b) => a + b;
    case '-': return (a, b) => a - b;
    case '*': return (a, b) => a * b;
    case '/': return (a, b) => {
      if (b === 0) throw new Error('Division by zero');
      return a / b;
    };
    default: throw new Error('Unknown operation: ' + op);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const a = parseFloat(document.getElementById('a').value);
  const b = parseFloat(document.getElementById('b').value);
  const op = document.getElementById('op').value;

  try {
    const result = resolveOperation(op)(a, b);
    resultEl.textContent = String(result);
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  }
});
