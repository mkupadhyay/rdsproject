'use strict';

/**
 * Lambda trigger for DDB table stream to load data from DDB into ES
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const Converter = DynamoDB.Converter;

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

const { ES_ENDPOINT } = process.env;

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let _index, _type, _id;

  try {
    // 1. build a body param for ES bulk API from stream records
    let body = [];
    for (const record of event.Records) {
      // decide index & type from event source of event
      let eventSource = record.eventSourceARN;
      if (eventSource.indexOf('ApplicationTable') > -1) {
        _index = _type = 'application';
      } else if (eventSource.indexOf('RecruiterTable') > -1) {
        _index = _type = 'recruiter';
      } else if (eventSource.indexOf('CandidateTable') > -1) {
        _index = _type = 'candidate';
      } else if (eventSource.indexOf('JobTable') > -1) {
        _index = _type = 'job';
      }

      // configure _id from record's keys
      let keys = Converter.unmarshall(record.dynamodb.Keys);
      if (_index === 'application') {
        _id = keys['candidateId'] + keys['jobId'];
      } else {
        _id = keys['id'];
      }

      if (record.eventName == 'REMOVE') {
        body.push({ delete: { _index, _type, _id } });
      } else {
        body.push({ index: { _index, _type, _id } });
        body.push(Converter.unmarshall(record.dynamodb.NewImage));
      }
    }

    // 2. load data to ES
    var es = new elasticsearch.Client({ host: ES_ENDPOINT, connectionClass: httpAwsEs });
    let response = await es.bulk({ body, refresh: true });
    console.log(`result of migration: ${JSON.stringify(response)}`);
  } catch (error) {
    console.error(JSON.stringify(error));
    es.close();
    throw error;
  }

  es.close();
  console.log(`Successfully processed ${event.Records.length} records.`);
};
