'use strict';

/**
 * resolver for Mutation.updateJob field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const uuid = require('uuid/v4');

module.exports.handler = async event => {
  let input = event.arguments.input;
  const identity = event.identity;

  var recruiterId = identity.username;

  var videoId;

  // 1. Update videoId if input includes video relational fields
  if (input.video || input.thumbnail) {
    // create a new video object and link it to the job through videoId
    videoId = uuid();
    let params = {
      TableName: 'VideoTable-' + process.env.STAGE,
      Item: {
        id: videoId,
        recruiterId,
        jobId: input.id,
        video: input.video,
        thumbnail: input.thumbnail,
        title: input.videoTitle,
        type: 'Job',
        createdAt: new Date(Date.now()).toISOString(),
        updatedAt: new Date(Date.now()).toISOString()
      }
    };

    try {
      await documentClient.put(params).promise();
      input['videoId'] = videoId;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  // 2. Update job object with an input
  const updatedAt = new Date(Date.now()).toISOString();
  let params = {
    TableName: 'JobTable-' + process.env.STAGE,
    Key: {
      id: input.id
    },
    UpdateExpression: 'set updatedAt = :updatedAt',
    ConditionExpression: 'attribute_exists(#id)',
    ExpressionAttributeNames: {
      '#id': 'id'
    },
    ExpressionAttributeValues: {
      ':updatedAt': updatedAt
    },
    ReturnValues: 'ALL_OLD'
  };

  if (identity) {
    params.ConditionExpression += ' and recruiterId = :username';
    params.ExpressionAttributeValues[':username'] = recruiterId;
  }

  if (input.deleted || input.status == 'Expired' || input.status == 'Deleted' || input.status == 'Filled' || input.status == 'Canceled') {
    // set TTL to 30 days
    input['ttl'] = Math.round(Date.now() / 1000) + 3600 * 24 * 30;
  }

  for (const key in input) {
    if (input.hasOwnProperty(key) && key != 'id') {
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

    // roll back transaction
    if (videoId) {
      params = {
        TableName: 'VideoTable-' + process.env.STAGE,
        Key: {
          id: videoId
        }
      };
      await documentClient.delete(params).promise();
    }

    throw error;
  }

  console.log('Completed update!');

  return result;
};
