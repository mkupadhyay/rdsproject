'use strict';

/**
 * resolver for Candidate.videos field
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
  const candidateId = event.source.id;
  const type = event.arguments.type;
  const first = event.arguments.first || 20;
  var after = event.arguments.after;
  const id = event.arguments.id;

  // 2. filter videos of this candidate
  let params = {
    TableName: 'VideoTable-' + process.env.STAGE,
    IndexName: 'Videos',
    KeyConditionExpression: '#candidateId = :candidateId',

    ExpressionAttributeNames: {
      '#candidateId': 'candidateId'
    },
    ExpressionAttributeValues: {
      ':candidateId': candidateId,
      ':deleted': true
    },
    FilterExpression: 'deleted <> :deleted'
  };

  if (type) {
    params.KeyConditionExpression += ' and #type = :type';
    params.ExpressionAttributeNames['#type'] = 'type';
    params.ExpressionAttributeValues[':type'] = type;
  } else {
    params.KeyConditionExpression += ' and begins_with(#type, :type)';
    params.ExpressionAttributeNames['#type'] = 'type';
    params.ExpressionAttributeValues[':type'] = 'Profile';
  }

  if (id) {
    params.FilterExpression += ' and #id = :id';
    params.ExpressionAttributeNames['#id'] = 'id';
    params.ExpressionAttributeValues[':id'] = id;
  }

  var items = [],
    result = [];
  var nextToken;
  try {
    // fetch all items through all pages
    let data;
    do {
      params.ExclusiveStartKey = nextToken;
      data = await documentClient.query(params).promise();
      result.push(...data.Items);
      nextToken = data.LastEvaluatedKey;
    } while (nextToken);

    // 3. build page data and nextToken
    let offset = -1;

    if (after) {
      // decrypt if after has been specified to get ExclusiveStartKey object
      after = decryptToken(after, PASSWORD);

      // find offset of page data based on after param
      offset = result.map(item => item.candidateId + item.type).indexOf(after.candidateId + after.type);
    }

    nextToken = null;

    items = result.slice(offset + 1, offset + 1 + first);
    if (offset + first + 1 < result.length) {
      let last = items[items.length - 1];
      nextToken = {
        candidateId: last.candidateId,
        type: last.type
      };
    }

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
