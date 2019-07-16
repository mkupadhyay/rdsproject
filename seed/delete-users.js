'use strict';

/**
 * Wipe all users in user pool: 'hiregoat'
 */
const dotenv = require('dotenv');
require('colors');

dotenv.config({
  path: '../.env'
});
dotenv.config({
  path: '.env'
});

const CognitoIdentityServiceProvider = require('aws-sdk/clients/cognitoidentityserviceprovider');

const cognitoISP = new CognitoIdentityServiceProvider({
  region: 'us-east-1',
  apiVersion: '2016-04-18'
});

/**
 * Delete specified user from user pool
 * @param {string} username username to delete from user pool
 */
function deleteUserFromUserPool(username) {
  // delete from user pool
  const params = {
    UserPoolId: process.env['USER_POOL_ID_' + process.env.STAGE],
    Username: username
  };

  cognitoISP
    .adminDeleteUser(params)
    .promise()
    .then(() => {
      console.log('Deleted user from User Pool'.green);
    })
    .catch(error => {
      console.log(error.message.red);
    });
}

var params = {
  UserPoolId: process.env['USER_POOL_ID_' + process.env.STAGE],
  AttributesToGet: ['sub']
};
cognitoISP
  .listUsers(params)
  .promise()
  .then(data => {
    for (const user of data.Users) {
      deleteUserFromUserPool(user.Username);
    }
    console.log('Completed deleting users from User Pool'.green);
  })
  .catch(console.error);
