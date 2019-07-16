'use strict';

/**
 * resolver for Candidate.proposals field
 */

const utility = require('./utility');
const decryptToken = utility.decryptToken;
const encryptObject = utility.encryptObject;
const PASSWORD = 'kfif83k3f8kdfw983kl3lk3klfj8283lkf';

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  // 1. extract arguments from caller's query
  const candidateId = event.source.id;
  const statuses = event.arguments.statuses;
  const jobId = event.arguments.jobId;
  const first = event.arguments.first || 20;
  var after = event.arguments.after;

  // 2. find applications of this candidte by sorting in jobId asc order
  var es = new elasticsearch.Client({ host: process.env.ES_ENDPOINT, connectionClass: httpAwsEs });
  var params = {
    index: 'application',
    type: 'application',
    body: {
      size: first,
      query: {
        bool: {
          must: [
            {
              match_phrase: {
                candidateId
              }
            },
            {
              match_phrase: {
                readStatus: false
              }
            },
            {
              bool: {
                must_not: {
                  term: {
                    deleted: true
                  }
                }
              }
            }
          ]
        }
      },
      sort: [
        {
          createdAt: {
            order: 'asc'
          }
        }
      ]
    }
  };

  if (statuses) {
    let should = [];
    for (const status of statuses) {
      should.push({ match_phrase: { status } });
    }
    params.body.query.bool.must.push({ bool: { should } });
  }

  if (jobId) {
    params.body.query.bool.must.push({ match_phrase: { jobId } });
  }

  if (after) {
    after = decryptToken(after, PASSWORD);
    params.body['search_after'] = [after];
  }

  try {
    var response = await es.search(params);
    es.close();
  } catch (error) {
    es.close();
    console.error(`${error}`);
    throw error;
  }

  // 3. return result
  let items = response.hits.hits.map(item => item._source);
  let nextToken = null;

  if (items.length == first) {
    let sort = new Date(items[items.length - 1].createdAt).getTime();
    nextToken = encryptObject(sort, PASSWORD);
  }

  return {
    items,
    nextToken
  };
};
