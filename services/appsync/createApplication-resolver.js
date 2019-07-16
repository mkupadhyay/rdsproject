'use strict';

/**
 * resolver for Mutation.createVideo field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let args = event.arguments;

  // 1. create a new application object with an input
  let params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    Item: {
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString(),
      status: 'Pending',
      readStatus: false
    },
    ConditionExpression: 'attribute_not_exists(#candidateId) AND attribute_not_exists(#jobId)',
    ExpressionAttributeNames: {
      '#candidateId': 'candidateId',
      '#jobId': 'jobId'
    }
  };
  Object.assign(params.Item, args.input);

  try {
    await documentClient.put(params).promise();
  } catch (error) {
    console.error(error);
    throw error;
  }

  let result = params.Item;

  console.log('Successfully, created a new application');

  return result;
};
