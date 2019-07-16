'use strict';

/**
 * script to migrate the data from DDB table to ES
 */

const dotenv = require('dotenv');
dotenv.config({
  path: '../.env'
});
dotenv.config({
  path: '.env'
});

const AWS = require('aws-sdk');
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: 'us-east-1',
  apiVersion: '2012-08-10'
});

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

/**
 * migrate the data from DDB table specified to ES type specified
 *
 * @param {string} table DDB table name to be loaded into ES
 * @param {string} index DDB index to load into ES
 * @param {string} type ES type to load data
 */
async function migrate(table, index, type) {
  // 1. scan data from DDB table
  let items = [];
  try {
    let params = {
      TableName: table
    };

    let nextToken;
    do {
      params.ExclusiveStartKey = nextToken;
      let data = await documentClient.scan(params).promise();
      nextToken = data.LastEvaluatedKey;
      items.push(...data.Items);
    } while (nextToken);
  } catch (error) {
    throw error;
  }

  // 2. index the data into ES
  var credentials = new AWS.SharedIniFileCredentials({ profile: 'fliphire' });
  AWS.config.update({
    credentials,
    region: 'us-east-1'
  });

  var es = new elasticsearch.Client({ host: `${process.env['ES_ENDPOINT_' + process.env.STAGE]}`, connectionClass: httpAwsEs });
  let body = [],
    _id;

  for (const item of items) {
    if (type == 'application') {
      _id = item.candidateId + item.jobId;
    } else {
      _id = item.id;
    }

    body.push({ index: { _index: index, _type: type, _id } });
    body.push(item);
  }

  try {
    let response = await es.bulk({ body, refresh: 'true' });
    console.log(`result of migration: ${JSON.stringify(response)}`);
  } catch (error) {
    console.error(`${error}`);
    es.close();
    throw error;
  }

  es.close();
  console.log(`Sucessfully, migrated ${table} table data into ${type} type of ES`);
}

// start migration from DynamoDB to Elasticsearch
try {
  migrate('ApplicationTable-' + process.env.STAGE, 'application', 'application');
  migrate('RecruiterTable-' + process.env.STAGE, 'recruiter', 'recruiter');
  migrate('CandidateTable-' + process.env.STAGE, 'candidate', 'candidate');
  migrate('JobTable-' + process.env.STAGE, 'job', 'job');
} catch (error) {
  console.error(`${error}`);
  return;
}
