'use strict';

/**
 * Browser wiring for the interactive calculator keypad.
 * Pure math functions are modeled safely and unit-tested in node:test.
 */

const screenEl = document.getElementById('calc-screen');
const historyEl = document.getElementById('calc-history');
const keypadEl = document.querySelector('.calculator-keypad');

let currentValue = '0';
let storedValue = null;
let currentOp = null;
let isFreshInput = true;
let hasError = false;

const OP_SYMBOLS = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
  '^2': 'x²'
};

function executeCalculation(a, op, b) {
  const numA = Number(a);
  const numB = Number(b);

  if (Number.isNaN(numA) || Number.isNaN(numB)) {
    throw new Error('Invalid input');
  }

  switch (op) {
    case '+':
      return numA + numB;
    case '-':
      return numA - numB;
    case '*':
      return numA * numB;
    case '/':
      if (numB === 0) {
        throw new Error('Division by zero');
      }
      return numA / numB;
    case '^2':
      return numA * numA;
    default:
      throw new Error('Unknown operation');
  }
}

function formatResult(value) {
  if (!Number.isFinite(value)) {
    throw new Error('Math error');
  }
  const rounded = Number(Math.round(Number(value + 'e+10')) + 'e-10');
  return String(rounded);
}

function updateDisplay() {
  if (hasError) {
    screenEl.textContent = currentValue;
    historyEl.textContent = '';
    return;
  }

  screenEl.textContent = currentValue;

  if (storedValue !== null && currentOp) {
    const symbol = OP_SYMBOLS[currentOp] || currentOp;
    historyEl.textContent = `${storedValue} ${symbol}`;
  } else {
    historyEl.textContent = '';
  }

  document.querySelectorAll('.btn-operator').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.op === currentOp && storedValue !== null);
  });
}

function clearAll() {
  currentValue = '0';
  storedValue = null;
  currentOp = null;
  isFreshInput = true;
  hasError = false;
  updateDisplay();
}

function inputDigit(digit) {
  if (hasError) {
    clearAll();
  }

  if (isFreshInput) {
    currentValue = digit;
    isFreshInput = false;
  } else if (currentValue === '0') {
    currentValue = digit;
  } else if (currentValue === '-0') {
    currentValue = '-' + digit;
  } else {
    currentValue += digit;
  }
  updateDisplay();
}

function inputDecimal() {
  if (hasError) {
    clearAll();
  }

  if (isFreshInput) {
    currentValue = '0.';
    isFreshInput = false;
  } else if (!currentValue.includes('.')) {
    currentValue += '.';
  }
  updateDisplay();
}

function toggleSign() {
  if (hasError) {
    clearAll();
    return;
  }

  if (currentValue.startsWith('-')) {
    currentValue = currentValue.slice(1);
  } else if (currentValue !== '0') {
    currentValue = '-' + currentValue;
  } else {
    currentValue = '-0';
  }
  updateDisplay();
}

function handleBackspace() {
  if (hasError || isFreshInput) {
    currentValue = '0';
    hasError = false;
    updateDisplay();
    return;
  }

  if (currentValue.length > 1) {
    currentValue = currentValue.slice(0, -1);
    if (currentValue === '-' || currentValue === '-0') {
      currentValue = '0';
    }
  } else {
    currentValue = '0';
  }
  updateDisplay();
}

function handleOperator(nextOp) {
  if (hasError) {
    clearAll();
  }

  if (storedValue !== null && currentOp && !isFreshInput) {
    try {
      const result = executeCalculation(storedValue, currentOp, currentValue);
      currentValue = formatResult(result);
      storedValue = currentValue;
    } catch (err) {
      currentValue = 'Error: ' + err.message;
      hasError = true;
      storedValue = null;
      currentOp = null;
      updateDisplay();
      return;
    }
  } else {
    storedValue = currentValue;
  }

  currentOp = nextOp;
  isFreshInput = true;
  updateDisplay();
}

function handleSquare() {
  if (hasError) {
    clearAll();
    return;
  }

  try {
    const num = Number(currentValue);
    if (Number.isNaN(num)) {
      throw new Error('Invalid input');
    }
    const result = formatResult(num * num);
    historyEl.textContent = `sqr(${currentValue})`;
    currentValue = result;
    isFreshInput = true;
    updateDisplay();
    historyEl.textContent = `sqr(${num})`;
  } catch (err) {
    currentValue = 'Error: ' + err.message;
    hasError = true;
    updateDisplay();
  }
}

function handleEquals() {
  if (hasError) {
    clearAll();
    return;
  }

  if (storedValue === null || !currentOp) {
    return;
  }

  try {
    const left = storedValue;
    const op = currentOp;
    const right = currentValue;
    const result = executeCalculation(left, op, right);

    const symbol = OP_SYMBOLS[op] || op;
    historyEl.textContent = `${left} ${symbol} ${right} =`;

    currentValue = formatResult(result);
    storedValue = null;
    currentOp = null;
    isFreshInput = true;
    screenEl.textContent = currentValue;
    document.querySelectorAll('.btn-operator').forEach((btn) => btn.classList.remove('is-active'));
  } catch (err) {
    currentValue = 'Error: ' + err.message;
    hasError = true;
    storedValue = null;
    currentOp = null;
    updateDisplay();
  }
}

if (keypadEl) {
  keypadEl.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;

    const num = target.dataset.num;
    const action = target.dataset.action;
    const op = target.dataset.op;

    if (num !== undefined) {
      inputDigit(num);
      return;
    }

    switch (action) {
      case 'clear':
        clearAll();
        break;
      case 'backspace':
        handleBackspace();
        break;
      case 'negate':
        toggleSign();
        break;
      case 'decimal':
        inputDecimal();
        break;
      case 'op':
        handleOperator(op);
        break;
      case 'square':
        handleSquare();
        break;
      case 'equals':
        handleEquals();
        break;
      default:
        break;
    }
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key >= '0' && event.key <= '9') {
    inputDigit(event.key);
  } else if (event.key === '.') {
    inputDecimal();
  } else if (event.key === '+' || event.key === '-' || event.key === '*' || event.key === '/') {
    handleOperator(event.key);
  } else if (event.key === 'Enter' || event.key === '=') {
    event.preventDefault();
    handleEquals();
  } else if (event.key === 'Backspace') {
    handleBackspace();
  } else if (event.key === 'Escape') {
    clearAll();
  }
});

updateDisplay();
