'use strict';

/**
 * resolver for Recruiter.jobs field
 */

const utility = require('./utility');
const decryptToken = utility.decryptToken;
const encryptObject = utility.encryptObject;
const PASSWORD = 'kfif83k3f8kdfw983kl3lk3klfj8283lkf';

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  // 1. extract arguments from caller's query
  const recruiterId = event.source.id;
  const jobId = event.arguments.jobId;
  const query = event.arguments.query;
  const statuses = event.arguments.statuses;
  const first = event.arguments.first || 20;
  var after = event.arguments.after;

  // 2. filter items related with this recruiter by statuses
  let params = {
    TableName: 'JobTable-' + process.env.STAGE,
    IndexName: 'Jobs',
    KeyConditionExpression: '#recruiterId = :recruiterId',
    ExpressionAttributeNames: {
      '#recruiterId': 'recruiterId',
      '#deleted': 'deleted',
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':recruiterId': recruiterId,
      ':deleted': true,
      ':deletedStatus1': 'Expired',
      ':deletedStatus2': 'Deleted',
      ':deletedStatus3': 'Filled',
      ':deletedStatus4': 'Canceled'
    }
  };

  if (jobId) {
    params.KeyConditionExpression += ' and id = :jobId';
    params.ExpressionAttributeValues[':jobId'] = jobId;
  }

  var queryFilter, statusesFilter;

  if (query) {
    queryFilter = '( contains(#t, :query) OR contains(#d, :query) )';
    params.ExpressionAttributeNames['#t'] = 'loweredTitle';
    params.ExpressionAttributeNames['#d'] = 'loweredDescription';
    params.ExpressionAttributeValues[':query'] = query;
  }

  let statusesObject = {};
  if (statuses && statuses.length > 0) {
    let index = 0;
    for (const status of statuses) {
      index++;
      statusesObject[`:status${index}`] = status;
    }
    statusesFilter = `#status IN (${Object.keys(statusesObject).toString()})`;
    Object.assign(params.ExpressionAttributeValues, statusesObject);
  }

  // Eliminate soft deleted jobs
  params.FilterExpression = '#deleted <> :deleted and (not (#status in (:deletedStatus1, :deletedStatus2, :deletedStatus3, :deletedStatus4)))';

  if (queryFilter || statusesFilter) {
    if (queryFilter && !statusesFilter) {
      params.FilterExpression += ` and ${queryFilter}`;
    } else if (!queryFilter && statusesFilter) {
      params.FilterExpression += ` and ${statusesFilter}`;
    } else {
      params.FilterExpression += ` and ${queryFilter} AND ${statusesFilter}`;
    }
  }

  var items = [];
  var nextToken;
  try {
    if (after) {
      // decrypt if after has been specified to get ExclusiveStartKey object
      after = decryptToken(after, PASSWORD);
      params.ExclusiveStartKey = after;
    }

    let data = await documentClient.query(params).promise();

    items = data.Items.slice(0, first);
    if (items.length < data.Items.length) {
      let last = items[items.length - 1];
      nextToken = {
        id: last.id,
        recruiterId: last.recruiterId
      };
    }

    // encrypt LastEvaluatedKey to nextToken
    nextToken = encryptObject(nextToken, PASSWORD);

    return {
      items,
      nextToken
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
