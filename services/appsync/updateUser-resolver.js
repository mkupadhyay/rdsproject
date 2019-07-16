'use strict';

/**
 * resolver for Mutation.updateCandidate & Mutation.updateRecruiter field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const SnsHelper = require('utilities/sns-helper');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  var input = event.arguments.input;
  const identity = event.identity;
  const field = event.field;
  const isCandidate = field == 'candidate';

  // 1. Validate input
  if (input.platform && !input.deviceToken) {
    console.log('Missing deviceToken');
    throw new Error('Missing deviceToken');
  }

  // Decide isAdmin
  let isAdmin = false;
  let groups;

  // allow dev or admin access to this mutaton
  groups = event.identity.claims['cognito:groups'];

  if (groups && groups.indexOf('Admin') > -1) {
    isAdmin = true;
  }

  // 2. Register/Unregister device
  if (input.platform && input.deviceToken) {
    // Register device
    console.log('Register mutation');
    try {
      await SnsHelper.registerDeviceToken(input.platform, input.deviceToken, isCandidate, identity.username);
      return input;
    } catch (error) {
      throw error;
    }
  } else if (input.deviceToken && !input.platform) {
    // Unregister device
    console.log('Unregister mutation');
    try {
      await SnsHelper.unregisterDeviceToken(input.deviceToken, isCandidate, identity.username);
      return input;
    } catch (error) {
      throw error;
    }
  }

  // 3. Update object with an input
  const updatedAt = new Date(Date.now()).toISOString();
  let params = {
    TableName: (isCandidate ? 'CandidateTable-' : 'RecruiterTable-') + process.env.STAGE,
    Key: {
      id: identity.username
    },
    UpdateExpression: 'set updatedAt = :updatedAt',
    ConditionExpression: isAdmin ? 'attribute_exists(#id)' : 'attribute_exists(#id) and #id = :id',
    ExpressionAttributeNames: {
      '#id': 'id'
    },
    ExpressionAttributeValues: {
      ':updatedAt': updatedAt
    },
    ReturnValues: 'ALL_OLD'
  };

  if (!isAdmin) {
    params.ExpressionAttributeValues[':id'] = identity.username;
  }

  delete input.id;

  for (const key in input) {
    if (input.hasOwnProperty(key)) {
      params.UpdateExpression += `, #${key} = :${key}`;
      params.ExpressionAttributeNames[`#${key}`] = key;
      params.ExpressionAttributeValues[`:${key}`] = input[key];
    }
  }

  try {
    var oldObject = (await documentClient.update(params).promise()).Attributes;
    var result = {};
    Object.assign(result, oldObject, input);
    result['updatedAt'] = updatedAt;
  } catch (error) {
    console.error(error);
    throw error;
  }

  console.log('Completed update!');

  return result;
};
