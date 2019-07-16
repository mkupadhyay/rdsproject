'use strict';

/**
 * Lambda trigger to notify the presence status change of user via all related application and additional configuration for MatchStatus
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

// Define AppSyncClient singleton to load asynchronously
var AppSyncClient = (() => {
  var instance;
  return {
    async getClient() {
      if (!instance) {
        instance = await require('./appsync-client').default;
      }
      return instance;
    }
  };
})();

const gql = require('./node_modules/graphql-tag');

var UserType = {
  Candidate: 'Candidate',
  Recruiter: 'Recruiter'
};

/**
 * Update application object by calling updateaApplication mutation
 *
 * @param {string} candidateId candidateId
 * @param {string} jobId jobId
 * @param {string} matchStatus match status to set in the application upon user status change
 */
async function updateApplication(candidateId, jobId, matchStatus) {
  try {
    var client = await AppSyncClient.getClient();
  } catch (error) {
    console.error(error);
    return error;
  }

  const mutation = gql`
    mutation UpdateApplication($candidateId: ID!, $jobId: ID!, $matchStatus: MatchStatus) {
      updateApplication(input: { candidateId: $candidateId, jobId: $jobId, status: $matchStatus }) {
        candidateId
        jobId
        recruiterId
        status
      }
    }
  `;

  let variables = { candidateId, jobId, matchStatus };

  return client
    .mutate({ mutation, variables, fetchPolicy: 'no-cache' })
    .then(data => {
      console.log(JSON.stringify(data));
      return;
    })
    .catch(error => {
      console.error(error);
      return;
    });
}

module.exports.handler = async event => {
  for (const record of event.Records) {
    if (record.eventName == 'REMOVE' || record.eventName == 'INSERT') continue;

    // 1. check if the status of client has been changed
    var newStatus = record.dynamodb.NewImage['status'] ? record.dynamodb.NewImage.status.S : null;
    var oldStatus = record.dynamodb.OldImage['status'] ? record.dynamodb.OldImage.status.S : null;
    if (newStatus == oldStatus) continue;
    console.log(`Changed status - newStatus: ${newStatus}, oldStatus: ${oldStatus}`);

    console.log(JSON.stringify(event));

    // 2. identify if it's recruiter or candidate
    var userType = record.eventSourceARN.indexOf('CandidateTable') > -1 ? UserType.Candidate : UserType.Recruiter;

    if (userType == UserType.Candidate) {
      let candidateId = record.dynamodb.Keys.id.S;

      // 3. scan applications matched with this candidate
      let params = {
        TableName: 'ApplicationTable-' + process.env.STAGE,
        KeyConditionExpression: 'candidateId = :candidateId',
        ExpressionAttributeValues: {
          ':candidateId': candidateId
        }
      };

      try {
        var applications = (await documentClient.query(params).promise()).Items;
      } catch (error) {
        console.error(error);
        continue;
      }

      // 4. notify across all relational applications by calling updateApplication mutation
      let promises = [];
      for (const { jobId, status } of applications) {
        // run updateApplication mutation and reset status of applications of this candidate to Waiting or Interrupted when he went offline
        let matchStatus;
        if (newStatus == 'Offline') {
          if (status == 'Postponed' || status == 'Missed' || status == 'IsReady') {
            matchStatus = 'Waiting';
          } else if (status == 'Interview' || status == 'Interviewing' || status == 'ReadyForInterview') {
            matchStatus = 'Interrupted';
          } else {
            continue;
          }
          promises.push(updateApplication(candidateId, jobId, matchStatus));
        }
      }
      await Promise.all(promises);

      console.log('Completed notifying!');
    } else {
      let recruiterId = record.dynamodb.Keys.id.S;

      // 3. scan applications matched with this recruiter
      let params = {
        TableName: 'ApplicationTable-' + process.env.STAGE,
        IndexName: 'Candidates',
        KeyConditionExpression: 'recruiterId = :recruiterId',
        ExpressionAttributeValues: {
          ':recruiterId': recruiterId
        }
      };

      try {
        var candidates = (await documentClient.query(params).promise()).Items;
      } catch (error) {
        console.error(error);
        continue;
      }

      // 4. notify across all relational applications by calling updateApplication mutation
      let promises = [];
      for (const { candidateId, jobId, status } of candidates) {
        // run updateApplication mutation and reset Interview status of applications of this recruiter to Interrupted when he went offline
        let matchStatus;
        if (newStatus == 'Offline') {
          if (status == 'Interview' || status == 'Interviewing' || status == 'ReadyForInterview') {
            matchStatus = 'Interrupted';
          } else {
            continue;
          }
          promises.push(updateApplication(candidateId, jobId, matchStatus));
        }
      }
      await Promise.all(promises);
      console.log('Completed notifying!');
    }
  }
};
