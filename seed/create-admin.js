'use strict';
/**
 * Sign up admin user and add to Admin group in User Pool
 */

require('colors');

const dotenv = require('dotenv');
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
 * sign up user in Cognito user pool
 * @param {object} user user data to sign up
 * @return {Promise} returns a promise for sign up process
 */
function signup(user) {
  let userAttributes = [];

  for (const key in user) {
    if (user.hasOwnProperty(key) && key != 'username' && key != 'password') {
      userAttributes.push({
        Name: key,
        Value: user[key].toString()
      });
    }
  }

  let params = {
    ClientId: process.env[`CLIENT_ID_ADMIN_${process.env.STAGE}`],
    Password: user.password,
    Username: user.username,
    UserAttributes: userAttributes
  };

  // sign up user in Cognito User Pool, Lambda trigger will confirm them and add to corresponding group automatically
  return cognitoISP.signUp(params).promise();
}

// Register admin user in Cognito User Pool and add to Admin group
const email = 'support@allmysons.com';
const user = {
  username: email,
  password: 'admin123',
  email
};

signup(user)
  .then(data => {
    let params = {
      GroupName: 'Admin',
      UserPoolId: process.env[`USER_POOL_ID_${process.env.STAGE}`],
      Username: data.UserSub
    };
    return cognitoISP.adminAddUserToGroup(params).promise();
  })
  .then(() => {
    console.log('SuccessFully, registered admin user in User Pool!');
  })
  .catch(console.error);
