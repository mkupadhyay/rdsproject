'use strict';

/**
 * resolver for Recruiter.onlineCandidates field
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

module.exports.handler = async event => {
  // 1. extract arguments from caller's query
  let recruiterId = event.source.id;
  let statuses = event.arguments.statuses;
  let jobId = event.arguments.jobId;

  // 2. get all candidates related with this recruiter
  let params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    IndexName: 'Candidates',
    KeyConditionExpression: 'recruiterId = :recruiterId',
    ExpressionAttributeNames: {
      '#d': 'deleted'
    },
    ExpressionAttributeValues: {
      ':recruiterId': recruiterId,
      ':d': true
    },
    FilterExpression: '#d <> :d'
  };

  if (jobId) {
    params.KeyConditionExpression += ' and jobId = :jobId';
    params.ExpressionAttributeValues[':jobId'] = jobId;
  }

  if (statuses && statuses.length > 0) {
    // build a list of comma separated statuses
    let statusesObject = {};
    let index = 0;
    for (const status of statuses) {
      index++;
      statusesObject[`:status${index}`] = status;
    }
    params['FilterExpression'] = ` and #s IN (${Object.keys(statusesObject).toString()})`;
    params.ExpressionAttributeNames = { '#s': 'status' };
    Object.assign(params.ExpressionAttributeValues, statusesObject);
  }

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

    applications = applications.map(application => ({ id: application.candidateId }));

    // 3. remove duplicated candidates from waiting queue
    let candidateIds = applications.map(item => item.id);
    applications = applications.filter((application, index) => candidateIds.indexOf(application.id) == index);

    if (!applications || applications.length == 0) {
      return [];
    }

    // 4. filter online candidates
    let Keys = applications;
    Keys = Keys.filter((item, index, self) => self.map(item => item.id).indexOf(item.id) === index);
    let TableName = `CandidateTable-${process.env.STAGE}`;
    params = {
      RequestItems: {}
    };
    params.RequestItems[TableName] = {};
    params.RequestItems[TableName]['Keys'] = Keys;
    params.RequestItems[TableName]['ConsistentRead'] = true;
    var candidates = (await documentClient.batchGet(params).promise()).Responses[TableName];

    // add status to each application
    applications = applications.map(application => {
      let index = candidates.map(candidate => candidate.id).indexOf(application.id);
      application['status'] = candidates[index].status;
      return application;
    });

    // filter online waiters only
    applications = applications.filter(application => application.status == 'Online');
    applications = applications.map(application => ({ id: application.id }));

    return applications;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
