'use strict';

const { AUTH_TYPE } = require('aws-appsync/lib/link/auth-link');

const config = {
  amplify: {
    Auth: {
      identityPoolId: process.env.IDENTITY_POOL_ID,
      region: process.env.AWSREGION,
      userPoolId: process.env[`USER_POOL_ID`],
      userPoolWebClientId: process.env[`CLIENT_ID_ADMIN`],
      authenticationFlowType: 'USER_PASSWORD_AUTH'
    }
  },
  auth: {
    username: process.env[`ADMIN_USERNAME`],
    password: process.env.ADMIN_PASSWORD
  },
  appsync: {
    url: process.env.APPSYNC_ENDPOINT,
    region: process.env.AWSREGION,
    auth: {
      type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS
    },
    disableOffline: true
  }
};

module.exports.default = config;
