'use strict';

/**
 * Register invitation with candidate's email and invited jobId for
 *
 * This will create a record in InvitationTable
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const uuid = require('uuid/v4');

module.exports.register = async event => {
  if (!event.body) {
    console.error('Specify email and jobId params');
    return event;
  }

  const body = JSON.parse(event.body);
  const email = body.email;
  const jobId = body.jobId;

  if (typeof email !== 'string' || typeof jobId !== 'string') {
    console.error('Specify email and jobid parameters');
    return event;
  }

  const params = {
    TableName: 'InvitationTable-' + process.env.STAGE,
    Item: {
      id: uuid(),
      email,
      jobId,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };

  return documentClient
    .put(params)
    .promise()
    .then(() => {
      return {
        statusCode: 200,
        body: 'Successfully, registered an invitation!'
      };
    })
    .catch(error => {
      console.error(error);
      throw error;
    });
};
