'use strict';

/**
 * Utility module
 */

const crypto = require('crypto');

/**
 * decrypt token by specified password and return plain object
 * @param {string} token encrypted token string
 * @param {string} password password used to encrypt this token
 * @return {Object}
 */
function decryptToken(token, password) {
  if (!token) {
    return null;
  }

  const decipher = crypto.createDecipher('aes192', password);
  let result = decipher.update(token, 'hex', 'utf8');
  result += decipher.final('utf8');
  result = JSON.parse(result);
  return result;
}

/**
 * encrypt given object by specified password and return
 * @param {Object} object object to encrypt
 * @param {string} password password used to encrypt this token
 */
function encryptObject(object, password) {
  if (!object) {
    return null;
  }

  const cipher = crypto.createCipher('aes192', password);
  let plain = JSON.stringify(object);
  let result = cipher.update(plain, 'utf8', 'hex');
  result += cipher.final('hex');
  return result;
}

module.exports.decryptToken = decryptToken;
module.exports.encryptObject = encryptObject;
