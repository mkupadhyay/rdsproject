'use strict';

/**
 * resolver for Mutation.ask field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

const PushHelper = require('utilities/push-helper');

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
  console.log(JSON.stringify(event));

  let args = event.arguments;
  var identity = event.identity;

  // 1. setup waiting queue for specified jobs
  if (!args.jobs || args.jobs.length == 0) throw new Error('Specify jobs to take an interview');

  try {
    var es = new elasticsearch.Client({ host: process.env.ES_ENDPOINT, connectionClass: httpAwsEs });

    var params = {
      index: 'application',
      type: 'application',
      body: {
        size: 100,
        query: {
          bool: {
            must: [
              {
                bool: {
                  should: []
                }
              },
              {
                bool: {
                  should: [
                    {
                      match_phrase: {
                        status: 'Waiting'
                      }
                    },
                    {
                      match_phrase: {
                        status: 'Missed'
                      }
                    },
                    {
                      match_phrase: {
                        status: 'Interrupted'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    };

    for (const jobId of args.jobs) {
      params.body.query.bool.must[0].bool.should.push({ match_phrase: { jobId } });
    }

    let response = await es.search(params);
    console.log(`waiting applications:\n${JSON.stringify(response)}`);

    var waiters = response.hits.hits.map(item => item._source);

    // 2. filter online waiters
    let Keys = waiters.map(waiter => ({ id: waiter.candidateId }));
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

    // add status and onlineTime to each waiter
    waiters = waiters.map(waiter => {
      let index = candidates.map(candidate => candidate.id).indexOf(waiter.candidateId);
      waiter['candidateStatus'] = candidates[index].status;
      waiter['onlineTime'] = candidates[index].onlineTime;
      return waiter;
    });

    // filter online waiters only
    waiters = waiters.filter(waiter => waiter.candidateStatus == 'Online');

    if (!waiters || waiters.length == 0) {
      console.log('No Waiters');
      console.trace();
      es.close();
      return null;
    }

    // 3. eliminate candidates entered in interview queue already
    params = {
      index: 'application',
      type: 'application',
      body: {
        size: 100,
        query: {
          bool: {
            must: [
              {
                bool: {
                  should: []
                }
              },
              {
                bool: {
                  should: [
                    {
                      match_phrase: {
                        status: 'ReadyForInterview'
                      }
                    },
                    {
                      match_phrase: {
                        status: 'Interview'
                      }
                    },
                    {
                      match_phrase: {
                        status: 'Interviewing'
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    };

    var interviewingCandidates;
    for (const waiter of waiters) {
      params.body.query.bool.must[0].bool.should.push({ match_phrase: { candidateId: waiter.candidateId } });
    }
    response = await es.search(params);
    console.log(`already interviewing applications:\n${JSON.stringify(response)}`);

    interviewingCandidates = response.hits.hits.map(item => item._source);

    // eliminate interviewing waiters from waiting queue
    waiters = waiters.filter(waiter => interviewingCandidates.map(item => item.candidateId).indexOf(waiter.candidateId) < 0);

    if (!waiters || waiters.length == 0) {
      console.log('No available waiters');
      es.close();
      return null;
    }

    // 4. sort waiters by interrupted at first, then, Waiting status, preferred token, lastly onlineTime
    waiters.sort((a, b) => {
      // sorty by Interrupted status
      if (a['status'] === 'Interrupted' && b['status'] !== 'Interrupted') {
        return -1;
      } else if (a['status'] !== 'Interrupted' && b['status'] === 'Interrupted') {
        return 1;
      } else {
        // sort by Waiting | Missed status
        if (a['status'] === 'Waiting' && b['status'] !== 'Waiting') {
          return -1;
        } else if (a['status'] !== 'Waiting' && b['status'] === 'Waiting') {
          return 1;
        } else {
          // sorty by preferred token
          if (a['preferred'] === true && b['preferred'] === false) {
            return -1;
          } else if (a['preferred'] === false && b['preferred'] === true) {
            return 1;
          } else {
            // sorty by onlineTime of candidates
            let aTime = new Date(a['onlineTime']).getTime();
            let bTime = new Date(b['onlineTime']).getTime();
            if (aTime < bTime) {
              return 1;
            } else if (aTime > bTime) {
              return -1;
            } else {
              return 0;
            }
          }
        }
      }
    });

    console.log('Sorted waiting queue:', JSON.stringify(waiters));

    // 5. choose a first candidate from waiting queue
    var candidateToAsk = waiters[0];

    // 6. Set rest applications's status of chosen candidate to `Missed`
    if (waiters.length > 1) {
      params = {
        TableName: 'ApplicationTable-' + process.env.STAGE,
        UpdateExpression: 'set #s = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#updatedAt': 'updatedAt'
        },
        ExpressionAttributeValues: {
          ':status': 'Missed',
          ':updatedAt': new Date(Date.now()).toISOString()
        }
      };

      let promises = [];
      for (let index = 1; index < waiters.length; index++) {
        const waiter = waiters[index];

        if (waiter.candidateId != candidateToAsk.candidateId) continue;

        params.Key = {
          candidateId: waiter.candidateId,
          jobId: waiter.jobId
        };

        promises.push(
          documentClient
            .update(params)
            .promise()
            .then(console.log)
            .catch(console.error)
        );
      }

      await Promise.all(promises);
    }

    // 7. set the MatchStatus of chosen candidate to IsReady
    params = {
      TableName: 'ApplicationTable-' + process.env.STAGE,
      Key: {
        candidateId: candidateToAsk.candidateId,
        jobId: candidateToAsk.jobId
      },
      UpdateExpression: 'set #s = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#s': 'status',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':status': 'IsReady',
        ':updatedAt': new Date(Date.now()).toISOString()
      }
    };

    await documentClient.update(params).promise();

    candidateToAsk.status = 'IsReady';

    delete candidateToAsk.candidateStatus;
    delete candidateToAsk.onlineTime;

    console.log('Asked successfully:');
    console.log(`Asked candidate:\n${JSON.stringify(candidateToAsk)}`);

    // 8. Publish push notification to counterpart
    let result = await PushHelper.publish(identity, false, 'Interview', 'Are you ready for an interview!', candidateToAsk, 'Ask');
    console.log(`Push notification sending result: ${result}`);
  } catch (error) {
    console.error(`${error}`);
    es.close();
    throw error;
  }

  es.close();
  return candidateToAsk;
};
