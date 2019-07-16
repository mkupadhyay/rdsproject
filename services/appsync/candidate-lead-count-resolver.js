'use strict';

/**
 * resolver for Candidate.leadCount field
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

const geodist = require('geodist');

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

  let source = event.source;
  /** @type {Array} */
  let industryIds = source.industryIds;
  let candidateId = source.id;
  let workTypeIds = source.workTypeIds;
  let salary = source.salary;
  let latitude = source.latitude;
  let longitude = source.longitude;
  let radius = source.radius;

  // Init ES client
  var es = new elasticsearch.Client({ host: process.env.ES_ENDPOINT, connectionClass: httpAwsEs });

  // 1. get recruiters associated with industryIds specified
  var recruiters = [];
  if (!industryIds || industryIds.length == 0) {
    // candidate didn't specify industryIds
    es.close();
    return null;
  } else if (industryIds[0] == 'any') {
    // candidate is looking for jobs from any industryIds
    recruiters = null;
  } else {
    // candidate specified interested industryIds, so search recruiters associated with specified industry ids
    let size = 100;
    let params = {
      index: 'recruiter',
      type: 'recruiter',
      body: {
        size,
        query: {
          bool: {
            should: []
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

    for (const industryId of industryIds) {
      params.body.query.bool.should.push({ match_phrase: { industryId } });
    }

    var sort;
    do {
      try {
        if (sort) {
          params.body['search_after'] = [sort];
        }
        var response = await es.search(params);
        let hits = response.hits.hits.map(hit => hit._source);
        recruiters.push(...hits);
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

    recruiters = recruiters.map(item => item.id);
  }

  console.log('Successfully, got recruiters associated with industryIds specified');
  console.log(`recruiters: ${JSON.stringify(recruiters)}`);

  // 2. get careerCategoryId list of this candidate
  let careers;
  let params = {
    TableName: 'CareerTable-' + process.env.STAGE,
    IndexName: 'Careers',
    KeyConditionExpression: 'candidateId = :candidateId',
    ExpressionAttributeValues: {
      ':candidateId': candidateId
    }
  };

  try {
    careers = (await documentClient.query(params).promise()).Items;
  } catch (error) {
    console.error(error);
    es.close();
    throw error;
  }

  if (!careers || careers.length == 0) {
    es.close();
    return null;
  }

  careers = careers.map(item => ({ id: item.categoryId, experience: item.experience }));
  console.log('Sucessfully, got careerCategoryId list of this candidate');
  console.log(`careers: ${JSON.stringify(careers)}`);

  // 3. search jobs by filtering recruiter id & career category id list
  var jobs = [];

  let size = 100;
  params = {
    index: 'job',
    type: 'job',
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
              bool: {
                should: []
              }
            },
            {
              match_phrase: {
                status: 'Active'
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

  if (recruiters) {
    for (const recruiterId of recruiters) {
      params.body.query.bool.must[0].bool.should.push({ match_phrase: { recruiterId } });
    }
  }

  for (const { id } of careers) {
    params.body.query.bool.must[1].bool.should.push({ match_phrase: { careerCategoryId: id } });
  }

  sort = null;
  do {
    try {
      if (sort) {
        params.body['search_after'] = [sort];
      }
      response = await es.search(params);
      let hits = response.hits.hits.map(hit => hit._source);
      jobs.push(...hits);
      sort = null;
      if (hits.length == size) {
        sort = new Date(hits[hits.length - 1].updatedAt).getTime();
      }
    } catch (error) {
      es.close();
      console.error(`${JSON.stringify(error)}`);
      throw error;
    }
  } while (sort);

  console.log('Successfully, searched jobs by filtering industries and careers');
  console.log(`Count of searched jobs: ${jobs.length}`);

  // 4. Eliminating applied jobs
  params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    KeyConditionExpression: 'candidateId = :candidateId',
    ExpressionAttributeValues: {
      ':candidateId': candidateId
    }
  };

  try {
    var appliedJobs = (await documentClient.query(params).promise()).Items || [];
    appliedJobs = appliedJobs.map(job => job.jobId);
  } catch (error) {
    es.close();
    console.error(error);
    throw error;
  }

  // 5. Eliminating disliked jobs
  params = {
    TableName: 'DismatchTable-' + process.env.STAGE,
    KeyConditionExpression: 'candidateId = :candidateId',
    ExpressionAttributeValues: {
      ':candidateId': candidateId
    }
  };

  try {
    var dislikedJobs = (await documentClient.query(params).promise()).Items || [];
    dislikedJobs = dislikedJobs.map(dismatch => dismatch.jobId);
  } catch (error) {
    console.error(error);
    es.close();
    throw error;
  }

  let eliminatedJobs = [...appliedJobs, ...dislikedJobs];
  jobs = jobs.filter(job => eliminatedJobs.indexOf(job.id) < 0);
  console.log(`Successfully, eliminated applied & disilked jobs, available leads: ${jobs.length}`);

  // 6. Get weight
  params = {
    TableName: 'WeightTable-' + process.env.STAGE
  };

  var weight;
  try {
    let response = (await documentClient.scan(params).promise()).Items;
    if (response.length > 0) {
      weight = response[0];
    }
  } catch (error) {
    console.error(error);
  }

  if (!weight) {
    // set default weight record if it's never set yet or can't get it yet
    weight = { employmentTypeWeight: 1, salaryWeight: 1, experienceWeight: 1, locationWeight: 1 };
  }

  console.log(`Weight: ${JSON.stringify(weight)}`);

  // 7. Calculate matching score for each job
  jobs = jobs.map(job => {
    // Sim(type of work)
    let simW, simS, simE, simL;
    if (!workTypeIds || workTypeIds.length == 0 || !job.employmentTypeId) simW = 0;
    else if (workTypeIds.indexOf(job.employmentTypeId) > -1) simW = 1;
    else simW = 0.5;

    console.log(`Sim(w): ${simW}`);

    // Sim(salary)
    if (!job.compensation || !salary) {
      simS = 0;
    } else {
      let tokens = job.compensation.split('-');
      salary = parseInt(salary);

      let expected;
      if (tokens.length > 1) {
        // range format of compensation
        expected = parseInt(tokens[1]);
      } else {
        // fixed format of compensation
        expected = parseInt(job.compensation);
      }

      if (salary <= expected) {
        simS = 1;
      } else {
        simS = expected / salary;
      }
    }

    console.log(`Sim(s): ${simS}`);

    // Sim(experience)
    let index = careers.map(career => career.id).indexOf(job.careerCategoryId);
    let experience = careers[index].experience;

    if (!experience || !job.careerExperience) {
      simE = 0;
    } else {
      let tokens = job.careerExperience.split('-');
      let jobMin = parseInt(tokens[0]);
      tokens = experience.split('-');
      let canMax = parseInt(tokens[1]);
      if (canMax >= jobMin) {
        simE = 1;
      } else {
        simE = jobMin / (jobMin + Math.abs(jobMin - canMax));
      }
    }

    console.log(`Sim(e): ${simE}`);

    // Sim(location)
    if (!job.latitude || !latitude || !radius || !job.longitude || !longitude) {
      simL = 0;
    } else {
      let distance = geodist({ lat: latitude, lon: longitude }, { lat: job.latitude, lon: job.longitude });
      if (distance <= radius) {
        simL = 1;
      } else {
        simL = radius / distance;
      }
    }

    console.log(`Sim(l): ${simL}`);

    let Gw = weight['employmentTypeWeight'];
    let Gs = weight['salaryWeight'];
    let Ge = weight['experienceWeight'];
    let Gl = weight['locationWeight'];
    let _score;

    if (!Gw && !Gs && !Ge && !Gl) {
      _score = 0;
    }

    _score = (simW * Gw + simS * Gs + simE * Ge + simL * Gl) / (Gw + Gs + Ge + Gl);

    job['_score'] = _score;

    console.log(`Score of job: ${job.id} -> ${_score}`);

    return job;
  });

  // 8. Sort jobs by matching score
  jobs = jobs.sort((a, b) => b._score - a._score);

  // 9. Calculate total lead count
  var total = jobs.length;
  console.log(`Successfully, got total lead count: ${total}`);

  // 10. Get online status of linked recruiters
  let Keys = jobs.map(job => ({ id: job.recruiterId }));
  Keys = Keys.filter((item, index, self) => self.map(item => item.id).indexOf(item.id) === index);
  let TableName = `RecruiterTable-${process.env.STAGE}`;
  params = {
    RequestItems: {}
  };
  params.RequestItems[TableName] = {};
  params.RequestItems[TableName]['ConsistentRead'] = true;
  let chunks = chunk(Keys, 100);

  recruiters = [];
  for (const chunk of chunks) {
    params.RequestItems[TableName]['Keys'] = chunk;
    recruiters.push(...(await documentClient.batchGet(params).promise()).Responses[TableName]);
  }

  // add status and onlineTime to each job
  jobs = jobs.map(job => {
    let index = recruiters.map(recruiter => recruiter.id).indexOf(job.recruiterId);
    job['recruiterStatus'] = recruiters[index].status;
    job['onlineTime'] = recruiters[index].onlineTime;
    return job;
  });

  // 11. Filter online recruiters
  jobs = jobs.filter(job => job.recruiterStatus == 'Online');

  // 12. Calculate online lead count
  var online = jobs.length;
  console.log(`Successfully, got online lead count: ${online}`);

  es.close();

  return {
    total,
    online
  };
};
