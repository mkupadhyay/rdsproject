'use strict';

/**
 * resolver for Recruiter.applications field
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
  // 1. extract arguments from caller's query
  const recruiterId = event.source.id;
  const jobId = event.arguments.jobId;
  const statuses = event.arguments.statuses;
  const first = event.arguments.first || 20;
  var after = event.arguments.after;

  // 2. filter applications related with this recruiter by statuses
  let params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    IndexName: 'Candidates',
    KeyConditionExpression: '#recruiterId = :recruiterId',
    ExpressionAttributeNames: {
      '#recruiterId': 'recruiterId',
      '#d': 'deleted'
    },
    ExpressionAttributeValues: {
      ':recruiterId': recruiterId,
      ':d': true
    },
    FilterExpression: '#d <> :d'
  };

  if (jobId) {
    params.KeyConditionExpression += ' AND jobId = :jobId';
    Object.assign(params.ExpressionAttributeValues, { ':jobId': jobId });
  }

  // build a list of comma separated statuses for filtering applications
  let statusesObject = {};
  if (statuses) {
    let index = 0;
    for (const status of statuses) {
      index++;
      statusesObject[`:status${index}`] = status;
    }
  }

  // add the filter for status
  if (statuses && statuses.length > 0) {
    params.FilterExpression += ` and #s IN (${Object.keys(statusesObject).toString()})`;
    Object.assign(params.ExpressionAttributeNames, { '#s': 'status' });
    Object.assign(params.ExpressionAttributeValues, statusesObject);
  }

  var applications = [];
  var nextToken;
  try {
    if (after) {
      // decrypt if after has been specified to get ExclusiveStartKey object
      after = decryptToken(after, PASSWORD);
      params.ExclusiveStartKey = after;
    }

    let data = await documentClient.query(params).promise();

    applications = data.Items.slice(0, first);
    if (applications.length < data.Items.length) {
      let last = applications[applications.length - 1];
      nextToken = {
        candidateId: last.candidateId,
        jobId: last.jobId,
        recruiterId: last.recruiterId
      };
    }

    // encrypt LastEvaluatedKey to nextToken
    nextToken = encryptObject(nextToken, PASSWORD);

    return {
      items: applications,
      nextToken
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};
