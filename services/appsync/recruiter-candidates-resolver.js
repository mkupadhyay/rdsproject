'use strict';

/**
 * resolver for Recruiter.candidates field
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

/**
 * wait for some miliseconds
 * @param {number} ms miliseconds to wait
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports.handler = async event => {
  // 1. extract arguments from caller's query
  let recruiterId = event.source.id;
  let query = event.arguments.query.toLowerCase();

  if (query.length == 0) return [];

  // 2. filter applications related with this recruiter
  let params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    IndexName: 'Candidates',
    KeyConditionExpression: 'recruiterId = :recruiterId',
    ExpressionAttributeNames: {
      '#s': 'status',
      '#deleted': 'deleted'
    },
    ExpressionAttributeValues: {
      ':recruiterId': recruiterId,
      ':status': 'Pending',
      ':deleted': true
    },
    FilterExpression: '#s <> :status and #deleted <> :deleted'
  };

  var applications = [];
  try {
    let nextToken;
    do {
      params.ExclusiveStartKey = nextToken;
      let data = await documentClient.query(params).promise();
      for (const item of data.Items) {
        if (applications.find(application => application.candidateId == item.candidateId)) continue;
        applications.push(item);
      }
      nextToken = data.LastEvaluatedKey;
    } while (nextToken);

    applications = applications.map(application => application.candidateId);

    // 3. search candidates matched with specified query
    let promises = [];
    var candidates = [];
    for (const candidateId of applications) {
      params = {
        TableName: 'CandidateTable-' + process.env.STAGE,
        Key: {
          id: candidateId
        }
      };

      let promise = documentClient
        .get(params)
        .promise()
        .then(data => {
          let candidate = data.Item;
          if (!candidate.hasOwnProperty('firstName') && !candidate.hasOwnProperty('lastName')) {
            return;
          }

          if ('firstName' in candidate && candidate.firstName.toLowerCase().indexOf(query) > -1) {
            candidates.push(candidate);
            return;
          }

          if ('lastName' in candidate && candidate.lastName.toLowerCase().indexOf(query) > -1) {
            candidates.push(candidate);
            return;
          }
        })
        .catch(console.error);
      promises.push(promise);

      await sleep(200);
    }

    await Promise.all(promises);

    return { items: candidates };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
