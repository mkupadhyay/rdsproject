'use strict';

/**
 * Resolver for Recruiter.count field
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

/**
 * chunk array by specified size and return array of chunks
 * @param {array} array array to chunk
 * @param {size} size chunk size
 */
var chunk = (array, size) => {
  const chunks = [];
  let index = 0;
  while (index < array.length) {
    chunks.push(array.slice(index, size + index));
    index += size;
  }

  return chunks;
};

module.exports.handler = async event => {
  // 1. Extract arguments and validate
  let recruiterId = event.source.id;
  let statuses = event.arguments.statuses;
  let jobId = event.arguments.job;

  if (!statuses || statuses.length == 0) return null;

  // 2. Search linked applications according to `job` and `statuses` params against `application` index in ES
  var es = new elasticsearch.Client({ host: process.env.ES_ENDPOINT, connectionClass: httpAwsEs });
  var size = 100;
  var params = {
    index: 'application',
    type: 'application',
    body: {
      size,
      query: {
        bool: {
          must: [
            {
              bool: {
                should: []
              }
            },
            {
              match_phrase: {
                recruiterId
              }
            },
            {
              bool: {
                must_not: [
                  {
                    match_phrase: {
                      deleted: true
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      sort: [
        {
          updatedAt: {
            order: 'asc'
          }
        }
      ]
    }
  };

  if (jobId) {
    params.body.query.bool.must.push({ match_phrase: { jobId } });
  }

  // add statuses param to the query
  params.body.query.bool.must[0].bool.should.push(...statuses.map(status => ({ match_phrase: { status } })));

  var sort,
    applications = [];
  do {
    try {
      if (sort) {
        params.body['search_after'] = [sort];
      }
      var response = await es.search(params);
      let hits = response.hits.hits.map(hit => hit._source);
      applications.push(...hits);
      sort = null;
      if (hits.length == size) {
        sort = new Date(hits[hits.length - 1].updatedAt).getTime();
      }
    } catch (error) {
      console.error(`${JSON.stringify(error)}`);
      es.close();
      throw error;
    }
  } while (sort);

  es.close();

  // Make uniqueness by candidateId
  // applications = applications.filter((item, index, self) => self.map(item => item.candidateId).indexOf(item.candidateId) === index);

  // 3. Calculate total count
  var total = applications.length;

  // 4. Get online status of linked candidates
  let Keys = applications.map(application => ({ id: application.candidateId }));
  Keys = Keys.filter((item, index, self) => self.map(item => item.id).indexOf(item.id) === index);
  let TableName = `CandidateTable-${process.env.STAGE}`;
  params = {
    RequestItems: {}
  };
  params.RequestItems[TableName] = {};
  params.RequestItems[TableName]['ConsistentRead'] = true;
  let chunks = chunk(Keys, 100);

  var candidates = [];
  for (const chunk of chunks) {
    params.RequestItems[TableName]['Keys'] = chunk;
    candidates.push(...(await documentClient.batchGet(params).promise()).Responses[TableName]);
  }

  // add status and onlineTime to each application
  applications = applications.map(application => {
    let index = candidates.map(candidate => candidate.id).indexOf(application.candidateId);
    application['candidateStatus'] = candidates[index].status;
    application['onlineTime'] = candidates[index].onlineTime;
    return application;
  });

  // 5. Filter online candidates
  applications = applications.filter(application => application.candidateStatus == 'Online');

  // 6. Calculate online count
  var online = applications.length;

  // 7. Return response
  return {
    total,
    online
  };
};
