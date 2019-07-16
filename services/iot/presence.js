'use strict';

/**
 * presence rule action to be triggered from IoT
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

/**
 * try to update status of the client disconnected
 * @param {boolean} isCandidate indicates if this client is candidate or recruiter
 * @param {str} id client id to set status
 * @return Promise
 */
async function tryToUpdateStatus(isCandidate, id) {
  // check if this client exists and its status was Online
  let TableName = isCandidate ? 'CandidateTable-' + process.env.STAGE : 'RecruiterTable-' + process.env.STAGE;
  let params = {
    TableName,
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: {
      ':id': id
    }
  };

  try {
    var client = await AppSyncClient.getClient();

    let items = (await documentClient.query(params).promise()).Items;
    if (items.length == 0) return;

    let user = items[0];
    if (user['status'] != 'Online') return;

    // run UpdateRecruiter mutation
    const mutation = isCandidate
      ? gql`
          mutation UpdateCandidateStatus($id: ID!) {
            updateCandidateStatus(id: $id, status: Offline) {
              id
              status
            }
          }
        `
      : gql`
          mutation UpdateRecruiterStatus($id: ID!) {
            updateRecruiterStatus(id: $id, status: Offline) {
              id
              status
            }
          }
        `;

    console.log('Called mutation to set user status as Offline!');

    return client.mutate({ mutation, variables: { id }, fetchPolicy: 'no-cache' });
  } catch (error) {
    console.error(error);
    return error;
  }
}

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let clientId = event.clientId;
  clientId = clientId.split(':')[0];
  let promises = [];

  try {
    promises.push(tryToUpdateStatus(true, clientId).catch(console.error));
    promises.push(tryToUpdateStatus(false, clientId).catch(console.error));
    await Promise.all(promises);
    console.log('Successfully updated status of the client in DB');
    return;
  } catch (error) {
    console.log(error);
  }
};
