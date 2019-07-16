'use strict';

/**
 * resolver for Recruiter.videos field
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
  const first = event.arguments.first || 20;
  var after = event.arguments.after;

  // 2. Search all job videos of the recruiter
  let params = {
    TableName: 'VideoTable-' + process.env.STAGE,
    IndexName: 'VideosByType',
    KeyConditionExpression: '#recruiterId = :recruiterId and #type = :type',
    ExpressionAttributeNames: {
      '#recruiterId': 'recruiterId',
      '#type': 'type',
      '#deleted': 'deleted'
    },
    ExpressionAttributeValues: {
      ':recruiterId': recruiterId,
      ':type': 'Job',
      ':deleted': true
    },
    FilterExpression: '#deleted <> :deleted'
  };

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

    // 3. make result unique by video field
    result = result.filter((item, index, self) => self.map(item => item.video).indexOf(item.video) === index);

    // 4. build page data and nextToken
    let offset = -1;

    if (after) {
      // decrypt if after has been specified to get ExclusiveStartKey object
      after = decryptToken(after, PASSWORD);

      // find offset of page data based on after param
      offset = result.map(item => item.type + item.recruiterId).indexOf(after.type + after.recruiterId);
    }

    nextToken = null;

    items = result.slice(offset + 1, offset + 1 + first);
    if (offset + first + 1 < result.length) {
      let last = items[items.length - 1];
      nextToken = {
        id: last.type,
        recruiterId: last.recruiterId
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
