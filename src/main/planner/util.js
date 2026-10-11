'use strict';

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = { copy, same };
