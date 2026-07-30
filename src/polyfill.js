/** PDF.js (via unpdf) expects Math.sumPrecise; Node 24.4 does not ship it yet. */
if (typeof Math.sumPrecise !== 'function') {
  Math.sumPrecise = function sumPrecise(values) {
    let sum = 0;
    for (const value of values) sum += Number(value);
    return sum;
  };
}
