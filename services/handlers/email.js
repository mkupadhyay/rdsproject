'use strict';

/**
 * Email related handler functions
 *
 * 1. Send verification email
 * 2. Verify confirmation email
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const CognitoIdentityServiceProvider = require('aws-sdk/clients/cognitoidentityserviceprovider');
const cognitoISP = new CognitoIdentityServiceProvider({
  region: process.env.AWSREGION,
  apiVersion: '2016-04-18'
});

module.exports.verify = (event, context, callback) => {
  console.log(JSON.stringify(event));

  // 1. Extract event data
  const token = event.queryStringParameters.token;
  const id = event.queryStringParameters.id;
  const isRecruiter = event.queryStringParameters.is_recruiter;

  // 2. Get user info from DB
  let TableName = (isRecruiter == 'true' ? 'RecruiterTable-' : 'CandidateTable-') + process.env.STAGE;
  let params = {
    TableName,
    Key: {
      id
    }
  };
  documentClient
    .get(params)
    .promise()
    .then(data => {
      const confirmCode = data.Item.confirmCode;
      if (token == confirmCode) {
        // 2-1. Matched, mark user email as verified in User Pool
        let params = {
          UserPoolId: process.env[`USER_POOL_ID`],
          Username: id,
          UserAttributes: [
            {
              Name: 'email_verified',
              Value: 'true'
            }
          ]
        };
        return cognitoISP.adminUpdateUserAttributes(params).promise();
      }

      // 2-2. Not matched, error
      callback(null, {
        statusCode: 403,
        body: "Sorry, we couldn't verify your email!"
      });
    })
    .then(() => {
      // 3. Success response
      callback(null, {
        statusCode: 200,
        body: 'Thanks, your email has been verified successfully!'
      });
    })
    .catch(error => {
      // 4. Failure response
      console.error(JSON.stringify(error));
      callback(null, {
        statusCode: 501,
        body: JSON.stringify(error.message)
      });
    });
};
