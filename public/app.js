'use strict';

/**
 * Browser wiring for the demo calculator page.
 * Pure calculation logic lives in scripts/app.js (CommonJS, covered by
 * node:test unit tests); this file only handles DOM events.
 */

const form = document.getElementById('calc-form');
const opSelect = document.getElementById('op');
const inputA = document.getElementById('a');
const inputB = document.getElementById('b');
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
    case '^2': return (a) => a * a;
    default: throw new Error('Unknown operation: ' + op);
  }
}

function updateUiForOperation() {
  const isUnary = opSelect.value === '^2';
  if (isUnary) {
    inputB.disabled = true;
    inputB.required = false;
    inputA.placeholder = 'Number';
  } else {
    inputB.disabled = false;
    inputB.required = true;
    inputA.placeholder = 'First number';
  }
}

opSelect.addEventListener('change', updateUiForOperation);
updateUiForOperation();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const a = parseFloat(inputA.value);
  const b = parseFloat(inputB.value);
  const op = opSelect.value;

  try {
    const fn = resolveOperation(op);
    const result = op === '^2' ? fn(a) : fn(a, b);
    resultEl.textContent = String(result);
  } catch (err) {
    resultEl.textContent = 'Error: ' + err.message;
  }
});
