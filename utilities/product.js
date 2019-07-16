'use strict';

/**
 * Perform product operation with left and right arraies
 *
 * For example, given left:
 * ['a', 'b'], right: ['1', '2'] => cartisan product result will be ['a1', 'a2', 'b1', 'b2']
 *
 * @param {array} left left array
 * @param {array} right right array
 */
module.exports.product = (left, right) => {
  var result = [];
  if (!left || !(left instanceof Array)) return result;
  if (!right || !(right instanceof Array)) return result;

  for (const leftItem of left) {
    for (const rightItem of right) {
      result.push(`${leftItem}_${rightItem}`);
    }
  }

  console.log(result);

  return result;
};
