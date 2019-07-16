'use strict';

/**
 * Get total number of applications according to the MatchStatus and Job
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
  console.log(JSON.stringify(event));

  const recruiterId = event.source.id;
  const jobId = event.arguments.jobId;
  const jobStatuses = event.arguments.jobStatuses;

  /** @type {Array} */
  const statuses = event.arguments.statuses;

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
    params.FilterExpression += ` and #s IN (${Object.keys(statusesObject).toString()})`;
    params.ExpressionAttributeNames = { '#s': 'status' };
    Object.assign(params.ExpressionAttributeValues, statusesObject);
  }

  var applications = [];
  try {
    let nextToken;
    do {
      params.ExclusiveStartKey = nextToken;
      let data = await documentClient.query(params).promise();
      let items = data.Items;

      // check job status if it's presented in parameter
      if (jobStatuses && jobStatuses.length > 0) {
        // do batch operation on chunks of items
        let promises = [];
        let index,
          size,
          chunkSize = 100;
        let TableName = `JobTable-${process.env.STAGE}`;

        for (index = 0, size = items.length; index < size; index += chunkSize) {
          let chunk = items.slice(index, index + chunkSize);

          // remove items with duplicated jobId
          let chunkSet = chunk.filter((item, index, array) => array.map(element => element.jobId).indexOf(item.jobId) === index);

          let keys = chunkSet.map(item => ({
            id: item.jobId
          }));

          keys = keys.filter((item, index, self) => self.map(item => item.id).indexOf(item.id) === index);

          let params = {
            RequestItems: {}
          };
          params.RequestItems[TableName] = {
            Keys: keys,
            AttributesToGet: ['id', 'status']
          };
          promises.push(
            documentClient
              .batchGet(params)
              .promise()
              .then(data => {
                // filter applications matched with specific jobStatus condition only from chunk
                let jobs = data.Responses[TableName].filter(response => jobStatuses.indexOf(response.status) > -1);
                let jobIds = jobs.map(response => response.id);
                chunk = chunk.filter(item => jobIds.indexOf(item.jobId) > -1);
                applications.push(...chunk);
              })
              .catch(console.error)
          );

          await sleep(300);
        }

        await Promise.all(promises);
      } else {
        applications.push(...items);
      }

      nextToken = data.LastEvaluatedKey;
    } while (nextToken);
  } catch (error) {
    console.error(error);
    throw error;
  }

  return applications.length;
};
