'use strict';

global.WebSocket = require('ws');

global.window = global.window || {
  setTimeout,
  clearTimeout,
  WebSocket: global.WebSocket,
  ArrayBuffer: global.ArrayBuffer,
  addEventListener() {},
  navigator: { onLine: true },
  localStorage: {
    store: {},
    getItem(key) {
      return this.store[key];
    },
    setItem(key, value) {
      this.store[key] = value;
    },
    removeItem(key) {
      delete this.store[key];
    }
  }
};

global.fetch = require('node-fetch');

require('es6-promise').polyfill();
require('isomorphic-fetch');

// Require exports file with endpoint and auth info
const awsExports = require('./aws-exports').default;

// Init Amplify/Auth module
const Auth = require('@aws-amplify/auth').default;

Auth.configure(awsExports.amplify.Auth);

module.exports.default = (async () => {
  // Set up AppSync client with Cognito User Pool Auth mode
  let config = awsExports.appsync;

  // Sign in via Cognito User Pool
  await Auth.signIn(awsExports.auth.username, awsExports.auth.password);
  console.log('Successfully, signed in via Cognito User Pool');

  config.auth['jwtToken'] = async () => (await Auth.currentSession()).getIdToken().getJwtToken();

  // Require AppSync module
  const AWSAppSyncClient = require('aws-appsync').default;
  let client = new AWSAppSyncClient(config);
  client = await client.hydrated();

  // Export AppSync client
  console.log('Successfully, created AppSync Client!');
  return client;
})();
