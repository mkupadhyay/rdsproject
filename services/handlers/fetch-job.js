'use strict';

/**
 * Fetch job API endpoint to be used in order to get job details on profile page
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

module.exports.handler = async event => {
  const jobId = event.queryStringParameters.id;

  // fetch job details associated with specified jobId
  let params = {
    TableName: 'JobTable-' + process.env.STAGE,
    KeyConditionExpression: 'id = :id',
    ExpressionAttributeValues: {
      ':id': jobId
    }
  };

  return documentClient
    .query(params)
    .promise()
    .then(data => {
      if (!data.Items || data.Items.length == 0) {
        return {
          statusCode: 403,
          body: 'There is no specified job'
        };
      }

      let job = data.Items[0];
      return {
        statusCode: 200,
        body: JSON.stringify(job)
      };
    })
    .catch(error => {
      console.error(error);
      throw error;
    });
};
