'use strict';

/**
 * resolver for Mutation.createJob field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const uuid = require('uuid/v4');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let input = event.arguments.input;
  var identity = event.identity;

  if (!input) {
    console.log('No valid input argument!');
    throw new Error('No input argument');
  }

  var recruiterId = identity.username;

  var jobId = uuid();
  var videoId;

  // 1. Create video object if input includes video relational fields
  var params;
  if (input.video || input.thumbnail) {
    videoId = uuid();
    params = {
      TableName: 'VideoTable-' + process.env.STAGE,
      Item: {
        id: videoId,
        recruiterId,
        jobId,
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
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  // 2. Create a new job object with an input
  if (!input.status) {
    // set default status as `Draft`
    input.status = 'Draft';
  }
  params = {
    TableName: 'JobTable-' + process.env.STAGE,
    Item: {
      id: jobId,
      recruiterId,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };
  if (videoId) {
    Object.assign(params.Item, input, { videoId });
  } else {
    Object.assign(params.Item, input);
  }
  delete params.Item.videoTitle;
  delete params.Item.video;
  delete params.Item.thumbnail;

  try {
    await documentClient.put(params).promise();
  } catch (error) {
    console.error(error);

    // roll back transaction in failure
    params = {
      TableName: 'VideoTable-' + process.env.STAGE,
      Key: {
        id: videoId
      }
    };
    await documentClient.delete(params).promise();

    throw error;
  }

  return params.Item;
};
