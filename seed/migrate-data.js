'use strict';
/**
 * migrate dynamodb tables with fake data
 */
const faker = require('faker');
require('colors');
const jsonfile = require('jsonfile');
const util = require('util');
const dotenv = require('dotenv');
dotenv.config({
  path: '../.env'
});
dotenv.config({
  path: '.env'
});

const fs = require('fs');
const csv = require('csv-parser');

const jobsResolver = require('../services/appsync/candidate-jobs-resolver');

const DynamoDB = require('aws-sdk/clients/dynamodb');

const documentClient = new DynamoDB.DocumentClient({
  region: 'us-east-1',
  apiVersion: '2012-08-10'
});
const CognitoIdentityServiceProvider = require('aws-sdk/clients/cognitoidentityserviceprovider');

const cognitoISP = new CognitoIdentityServiceProvider({
  region: 'us-east-1',
  apiVersion: '2016-04-18'
});

const readFile = util.promisify(jsonfile.readFile);

/**
 * wait for ms
 * @param {int} ms milliseconds to wait
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

var loadedWorkTypes,
  loadedIndustries,
  loadedCategories,
  loadedSalaryTypes,
  loadedIncentives,
  loadedBnefits,
  loadedRequirements,
  loadedCurrentStatuses,
  loadedEducations,
  loadedTitles,
  loadedResumes,
  loadedCategoryTypes;
var zipCodes = [];
var profileVideosPerCandidate = {};

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items An array containing the items.
 */
function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

/**
 * sign up user in Cognito user pool
 * @param {object} user user data to sign up
 */
function signup(user) {
  let userAttributes = [];

  for (const key in user) {
    if (user.hasOwnProperty(key) && key != 'username' && key != 'password' && key != 'custom:isRecruiter') {
      userAttributes.push({
        Name: key,
        Value: user[key].toString()
      });
    }
  }

  const isRecruiter = parseInt(user['custom:isRecruiter']) === 1;

  let params = {
    ClientId: process.env[`CLIENT_ID_${isRecruiter ? 'REC' : 'CAN'}_${process.env.STAGE}`],
    Password: user.password,
    Username: user.username,
    UserAttributes: userAttributes
  };

  // sign up user in Cognito User Pool, Lambda trigger will confirm them and add to corresponding group automatically
  return cognitoISP.signUp(params).promise();
}

/**
 * create job posted by the recruiter specified with userId
 * @param {string} userId recruiter id to post the job
 * @param {string} videoId videoId of the associated job video
 */
function createJob(userId, videoId) {
  const compensationStart = faker.random.number({
    min: 20000,
    max: 150000
  });

  const compensationEnd = faker.random.number({
    min: compensationStart,
    max: compensationStart * 1.5
  });

  const compensation = `${compensationStart}-${compensationEnd}`;

  const categoryType =
    loadedCategoryTypes[
      faker.random.number({
        min: 0,
        max: loadedCategoryTypes.length - 1
      })
    ];

  const categoryId = categoryType.categoryId;

  const workType =
    loadedWorkTypes[
      faker.random.number({
        min: 0,
        max: loadedWorkTypes.length - 1
      })
    ];

  const salaryType =
    loadedSalaryTypes[
      faker.random.number({
        min: 0,
        max: loadedSalaryTypes.length - 1
      })
    ];

  const numberOfIncentives = faker.random.number({
    min: 1,
    max: loadedIncentives.length
  });
  let incentives;
  if (numberOfIncentives == 0) {
    incentives = [];
  } else if (numberOfIncentives == loadedIncentives.length) {
    incentives = ['any'];
  } else {
    incentives = shuffle(loadedIncentives).slice(0, numberOfIncentives);
    incentives = incentives.map(value => value.id);
  }

  const numberOfBenefits = faker.random.number({
    min: 1,
    max: loadedBnefits.length
  });
  let benefits;
  if (numberOfBenefits == 0) {
    benefits = [];
  } else if (numberOfBenefits == loadedBnefits.length) {
    benefits = ['any'];
  } else {
    benefits = shuffle(loadedBnefits).slice(0, numberOfBenefits);
    benefits = benefits.map(value => value.id);
  }

  const numberOfRequirements = faker.random.number({
    min: 1,
    max: loadedRequirements.length
  });
  let requirements;
  if (numberOfRequirements == 0) {
    requirements = [];
  } else if (numberOfRequirements == loadedRequirements.length) {
    requirements = ['any'];
  } else {
    requirements = shuffle(loadedRequirements).slice(0, numberOfRequirements);
    requirements = requirements.map(value => value.id);
  }

  const experienceStart = faker.random.number(3);
  const experienceEnd = faker.random.number({
    min: experienceStart + 2,
    max: experienceStart + 5
  });

  /** @type {string} */
  const zip =
    zipCodes[
      faker.random.number({
        min: 0,
        max: zipCodes.length - 1
      })
    ];

  const statuses = ['Active', 'Expired', 'Deleted', 'Draft'];
  const status =
    statuses[
      faker.random.number({
        min: 0,
        max: statuses.length - 1
      })
    ];

  const params = {
    TableName: 'JobTable-' + process.env.STAGE,
    Item: {
      id: faker.random.uuid(),
      title: faker.name.jobTitle(),
      description: faker.name.jobDescriptor(),
      duration: faker.lorem.word(),
      numberOfPositions: faker.random.number({
        min: 1,
        max: 5
      }),
      zip: zip,
      // latitude: faker.address.latitude(),
      // longitude: faker.address.longitude(),
      compensation: compensation,
      employmentTypeId: workType.id,
      careerCategoryId: categoryId,
      categoryTypeId: categoryType.id,
      salaryTypeId: salaryType.id,
      incentiveIds: incentives,
      benefitIds: benefits,
      requirementIds: requirements,
      careerExperience: `${experienceStart}-${experienceEnd}`,
      recruiterId: userId,
      status,
      videoId,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };

  return documentClient.put(params).promise();
}

/**
 * create video associated with a specific candidate
 * @param {string} id id of the video to be created
 * @param {string} type video type
 * @param {string} candidateId candidateId of candidate associated with this video
 * @param {string} jobId jobId of job associated with this video
 * @param {string} recrutierId recruiterId of recruiter associated with this recruiter
 */
function createVideo({ id, type, candidateId, jobId, recruiterId }) {
  let params = {
    TableName: 'VideoTable-' + process.env.STAGE,
    Item: {
      id: id ? id : faker.random.uuid(),
      type,
      title: faker.name.jobTitle(),
      thumbnail: faker.system.fileName(),
      video: faker.system.fileName(),
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };

  jobId ? (params.Item['jobId'] = jobId) : null;
  candidateId ? (params.Item['candidateId'] = candidateId) : null;
  recruiterId ? (params.Item['recruiterId'] = recruiterId) : null;
  type == 'More' ? (params.Item['question'] = faker.name.jobTitle()) : null;

  return documentClient.put(params).promise();
}

/**
 * Create Experience associated with a specific candidate
 * @param {string} userId user id assocciated with this experience
 */
function createExperience(userId) {
  const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const params = {
    TableName: 'ExperienceTable-' + process.env.STAGE,
    Item: {
      id: faker.random.uuid(),
      title: faker.name.jobTitle(),
      company: faker.company.companyName(),
      isCurrent: faker.random.boolean(),
      startDate: `${faker.random.arrayElement(months)}-${faker.random.number({ min: 1970, max: 2018 })}`,
      endDate: `${faker.random.arrayElement(months)}-${faker.random.number({ min: 1970, max: 2018 })}`,
      candidateId: userId,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };

  return documentClient.put(params).promise();
}

/**
 * Create career for a specific candidate specified by `userId`
 * @param {string} userId id of candidate associated with
 */
function createCareer(userId, category) {
  // create career in dynamodb CareerTable
  const params = {
    TableName: 'CareerTable-' + process.env.STAGE,
    Item: {
      id: faker.random.uuid(),
      categoryId: category.id,
      experience: `${0}-${faker.random.number(5)}`,
      candidateId: userId,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };

  return documentClient.put(params).promise();
}

/**
 * create question associated with the job specified by job id
 * @param {string} jobId job id associated with this question
 * @param {string} username owner username of this question
 */
function createQuestion(jobId, username) {
  let params = {
    TableName: 'QuestionTable-' + process.env.STAGE,
    Item: {
      id: faker.random.uuid(),
      question: faker.lorem.sentence(),
      answer: faker.random.boolean(),
      jobId,
      username,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };

  return documentClient.put(params).promise();
}

/**
 * Create application the specific candidate applied for a specific job
 *
 * This will emulate all actions between the candidate and job
 */
async function createApplication() {
  // scan all existing candidates
  const params = {
    TableName: 'CandidateTable-' + process.env.STAGE,
    AttributesToGet: ['id']
  };
  /** @type {Array} */
  let candidates;
  /** @type {Array} */
  let jobs;
  documentClient
    .scan(params)
    .promise()
    .then(data => {
      console.log('Scanned all candidates'.green);
      candidates = data.Items;

      // scan all existing jobs and
      const params = {
        TableName: 'JobTable-' + process.env.STAGE,
        AttributesToGet: ['id', 'recruiterId']
      };
      return documentClient.scan(params).promise();
    })
    .then(async data => {
      console.log('Scanned all jobs'.green);
      jobs = data.Items;

      let interviewTable = {};
      let isReadyTable = {};
      let ReadyForInterviewTable = {};
      const statuses = [
        'Pending',
        'More',
        'Declined',
        'Accepted',
        'Withdrawn',
        'Waiting',
        'InterviewFinished',
        'Postponed',
        'Missed',
        'Interrupted',
        'RecruiterExchanged',
        'CandidateExchanged',
        'Exchanged',
        'NotExchanged',
        'IsReady',
        'ReadyForInterview',
        'Interview',
        'Interviewing'
      ];

      for (const { id } of candidates) {
        const candidateId = id;

        for (const { id, recruiterId } of jobs) {
          if (faker.random.boolean()) continue;

          const jobId = id;

          // create the application
          // check compatibility and make valid tuple of status and ready
          let status =
            statuses[
              faker.random.number({
                min: 0,
                max: statuses.length - 1
              })
            ];
          let ready = faker.random.boolean();

          if (status == 'Interview') {
            if (interviewTable.hasOwnProperty(jobId)) {
              // recruiter's interview queue has been filled already, so can't interview with this candidate
              // assign another status (not Interview)
              status =
                statuses[
                  faker.random.number({
                    min: 0,
                    max: statuses.length - 2
                  })
                ];
            } else {
              // recruiter is available for an interview with this candidate
              interviewTable[jobId] = 1;
            }
          }

          if (status == 'ReadyForInterview') {
            if (ReadyForInterviewTable.hasOwnProperty(jobId)) {
              // recruiter's interview queue has been filled already, so can't interview with this candidate
              // assign another status (not Interview)
              status =
                statuses[
                  faker.random.number({
                    min: 0,
                    max: statuses.length - 3
                  })
                ];
            } else {
              // recruiter is available for an interview with this candidate
              ReadyForInterviewTable[jobId] = 1;
            }
          }

          if (status == 'IsReady') {
            if (isReadyTable.hasOwnProperty(jobId)) {
              // recruiter's interview queue has been filled already, so can't interview with this candidate
              // assign another status (not Interview)
              status =
                statuses[
                  faker.random.number({
                    min: 0,
                    max: statuses.length - 4
                  })
                ];
            } else {
              // recruiter is available for an interview with this candidate
              isReadyTable[jobId] = 1;
            }
          }

          if (status != 'Waiting') {
            ready = false;
          }

          let videoId = faker.random.uuid();

          // set profile video
          var profileVideoId;
          if (profileVideosPerCandidate[candidateId] && profileVideosPerCandidate[candidateId].length > 0) {
            let index = faker.random.number({ min: 0, max: profileVideosPerCandidate[candidateId].length - 1 });
            profileVideoId = profileVideosPerCandidate[candidateId][index];
          }

          let params = {
            TableName: 'ApplicationTable-' + process.env.STAGE,
            Item: {
              candidateId,
              jobId,
              recruiterId,
              status,
              ready,
              videoId,
              readStatus: false,
              createdAt: new Date(Date.now()).toISOString(),
              updatedAt: new Date(Date.now()).toISOString()
            }
          };

          profileVideoId ? (params.Item['profileVideoId'] = profileVideoId) : null;

          documentClient
            .put(params)
            .promise()
            .then(() => {
              console.log('Created application'.green);
              // create application video
              return createVideo({ id: videoId, type: 'Application', candidateId, jobId, recruiterId });
            })
            .then(async () => {
              console.log('Created application video!'.green);
              // create more questions for this application if application status is more
              for (let i = 0; i < faker.random.number({ min: 1, max: 3 }); i++) {
                createVideo({ type: 'More', candidateId, jobId, recruiterId })
                  .then(console.log)
                  .catch(console.error);

                await sleep(300);
              }
            })
            .catch(error => {
              console.error(error);
            });

          await sleep(300);
        }
      }
    })
    .catch(error => {
      console.error(error);
    });
}

/**
 * Create disliked jobs in DismatchTable
 *
 * This emulates the candidate's dislike action on the jobs
 */
async function createDismatch() {
  /** @type {Array} */
  var candidates;

  /** @type {Array} */
  var jobs, jobIds;

  // scan all existing candidates
  const params = {
    TableName: 'CandidateTable-' + process.env.STAGE
  };
  documentClient
    .scan(params)
    .promise()
    .then(async data => {
      console.log('Scanned all candidates'.green);
      candidates = data.Items;

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];

        // find matched jobs for this candidate
        let event = {
          field: 'jobs',
          arguments: {},
          source: candidate
        };
        try {
          jobs = (await jobsResolver.handler(event)).items;
        } catch (error) {
          console.error(error);
          continue;
        }

        if (!jobs) continue;
        jobIds = jobs.map(item => item.id);

        jobIds.sort(() => 0.5 - Math.random());
        jobIds = jobIds.slice(
          0,
          faker.random.number({
            min: 0,
            max: jobIds ? jobIds.length : 0
          })
        );

        for (let j = 0; j < jobIds.length; j++) {
          const jobId = jobIds[j];
          let status = faker.random.boolean() ? 'Disliked' : 'Disqualified';
          let params = {
            TableName: 'DismatchTable-' + process.env.STAGE,
            Item: {
              candidateId: candidate.id,
              jobId,
              status
            }
          };

          documentClient
            .put(params)
            .promise()
            .then(() => {
              console.log('Created dismatch!'.green);
            })
            .catch(error => {
              console.error(error);
            });

          await sleep(300);
        }
      }
    })
    .catch(error => {
      console.error(error);
    });
}

/**
 * migrate data to enum tables in DynamoDB
 */
function migrateEnumTable() {
  // migrate WorkTypeTable
  let path = process.env.NODE_ENV == 'debug' ? 'seed/work-types.json' : 'work-types.json';
  return readFile(path, 'utf8')
    .then(data => {
      loadedWorkTypes = data;
      let promises = [];
      for (const workType of data) {
        let params = {
          TableName: 'WorkTypeTable-' + process.env.STAGE,
          Item: workType
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/industries.json' : 'industries.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedIndustries = data;
      let promises = [];
      for (const industry of data) {
        let params = {
          TableName: 'IndustryTable-' + process.env.STAGE,
          Item: industry
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/career-categories.json' : 'career-categories.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedCategories = data;
      let promises = [];
      for (const category of data) {
        let params = {
          TableName: 'CareerCategoryTable-' + process.env.STAGE,
          Item: category
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/salary-types.json' : 'salary-types.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedSalaryTypes = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'SalaryTypeTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/incentives.json' : 'incentives.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedIncentives = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'IncentiveTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/benefits.json' : 'benefits.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedBnefits = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'BenefitTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/requirements.json' : 'requirements.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedRequirements = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'RequirementTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/current-statuses.json' : 'current-statuses.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedCurrentStatuses = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'CurrentStatusTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/educations.json' : 'educations.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedEducations = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'EducationTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/resumes.json' : 'resumes.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedResumes = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'ResumeTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/titles.json' : 'titles.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedTitles = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'TitleTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .then(() => {
      path = process.env.NODE_ENV == 'debug' ? 'seed/category-types.json' : 'category-types.json';
      return readFile(path, 'utf8');
    })
    .then(data => {
      loadedCategoryTypes = data;
      let promises = [];
      for (const value of data) {
        let params = {
          TableName: 'CategoryTypeTable-' + process.env.STAGE,
          Item: value
        };
        promises.push(documentClient.put(params).promise());
      }
      return Promise.all(promises);
    })
    .catch(error => {
      console.error(error);
    });
}

/**
 * Update attributes of the candidate specified by id parameter
 * @param {string} id id of candidate to update in CandidateTable
 */
function updateCandidate(id) {
  // prepare fake salaries
  const salaries = ['20000', '30000', '35000', '40000', '50000', '55000', '60000', '65000', '70000', '75000', '80000', '90000', '100000', '110000', '120000'];
  const salary =
    salaries[
      faker.random.number({
        min: 0,
        max: salaries.length - 1
      })
    ];

  const numberOfWorkTypes = faker.random.number({
    min: 1,
    max: loadedWorkTypes.length
  });
  const numberOfIndustries = faker.random.number({
    min: 1,
    max: loadedIndustries.length
  });
  let workTypes, industries;
  if (numberOfWorkTypes == 0) {
    workTypes = [];
  } else {
    workTypes = shuffle(loadedWorkTypes).slice(0, numberOfWorkTypes);
    workTypes = workTypes.map(workType => workType.id);
  }

  if (numberOfIndustries == 0) {
    industries = [];
  } else if (numberOfIndustries == loadedIndustries.length) {
    industries = ['any'];
  } else {
    industries = shuffle(loadedIndustries).slice(0, numberOfIndustries);
    industries = industries.map(industry => industry.id);
  }

  const currentStatus =
    loadedCurrentStatuses[
      faker.random.number({
        min: 0,
        max: loadedCurrentStatuses.length - 1
      })
    ];

  const education =
    loadedEducations[
      faker.random.number({
        min: 0,
        max: loadedEducations.length - 1
      })
    ];

  const numberOfResumes = faker.random.number({
    min: 1,
    max: loadedResumes.length
  });
  let resumes;
  if (numberOfResumes == 0) {
    resumes = [];
  } else if (numberOfResumes == loadedResumes.length) {
    resumes = ['any'];
  } else {
    resumes = shuffle(loadedResumes).slice(0, numberOfResumes);
    resumes = resumes.map(value => value.id);
  }

  let params = {
    TableName: 'CandidateTable-' + process.env.STAGE,
    Key: {
      id
    },
    UpdateExpression:
      'set radius = :radius, currentStatusId = :currentStatus, educationId = :education, salary = :salary, workTypeIds = :workTypes, industryIds = :industries, resumeIds = :resumes, createdAt = :createdAt, updatedAt = :updatedAt, #s=:s',
    ConditionExpression: 'id = :id',
    ExpressionAttributeNames: {
      '#s': 'status'
    },
    ExpressionAttributeValues: {
      ':id': id,
      // ':latitude': faker.address.latitude(),
      // ':longitude': faker.address.longitude(),
      ':radius': faker.random.number({
        min: 1000,
        max: 3000
      }),
      ':currentStatus': currentStatus.id,
      ':education': education.id,
      ':salary': salary,
      ':workTypes': workTypes,
      ':industries': industries,
      ':resumes': resumes,
      ':s': 'Offline',
      ':createdAt': new Date(Date.now()).toISOString(),
      ':updatedAt': new Date(Date.now()).toISOString()
    }
  };
  return documentClient.update(params).promise();
}

/**
 * Update attributes of the recruiter specified by id parameter
 * @param {string} id id of recruiter to update in RecruiterTable
 * @param {string} videoId id of video object associated with this recruiter
 */
function updateRecruiter(id, videoId) {
  let index = faker.random.number({
    min: 0,
    max: loadedIndustries.length - 1
  });
  const industry = loadedIndustries[index];

  index = faker.random.number({
    min: 0,
    max: loadedIndustries.length - 1
  });
  const title = loadedTitles[index];

  let params = {
    TableName: 'RecruiterTable-' + process.env.STAGE,
    Key: {
      id: id
    },
    UpdateExpression:
      'set #t = :type, reason = :reason, industryId = :industry, companyName = :companyName, companyPhone = :companyPhone, companyURL = :companyURL, createdAt = :createdAt, updatedAt = :updatedAt, #s=:s, titleId=:title, videoId = :videoId',
    ConditionExpression: 'id = :id',
    ExpressionAttributeNames: {
      '#t': 'type',
      '#s': 'status'
    },
    ExpressionAttributeValues: {
      ':id': id,
      ':type': faker.random.boolean() ? 'Company' : 'Agency',
      ':reason': faker.lorem.sentence(),
      ':companyName': faker.company.companyName(),
      ':companyPhone': faker.phone.phoneNumberFormat(),
      ':companyURL': faker.internet.url(),
      ':industry': industry.id,
      ':title': title.id,
      ':s': 'Offline',
      ':videoId': videoId,
      ':createdAt': new Date(Date.now()).toISOString(),
      ':updatedAt': new Date(Date.now()).toISOString()
    }
  };
  return documentClient.update(params).promise();
}

/**
 * start migration
 */
function start() {
  migrateEnumTable()
    .then(() => {
      console.log('Migrated enum tables'.green);
      // import users data migrated
      const path = process.env.NODE_ENV == 'debug' ? 'seed/users.json' : 'users.json';
      return readFile(path, 'utf8');
    })
    .then(users => {
      console.log('Imported users data'.green);

      var counter = 0;

      // sign up imported users in cognito user pool
      for (const user of users) {
        counter++;
        signup(user)
          .then(data => {
            counter--;
            console.log('Signed up user successfully!'.green);
            // put some delay before update candidate or recruiter
            counter++;
            return new Promise(resolve => {
              setTimeout(resolve, 1000, data);
            });
          })
          .then(async data => {
            counter--;
            const username = data.UserSub;
            if (user['custom:isRecruiter'] == 0) {
              // update candidate with its profile attributes in dynamodb table
              counter++;
              updateCandidate(username)
                .then(async () => {
                  console.log('Updated candidate'.green);
                  counter--;

                  // create profile videos for the candidate
                  const numberOfVideos = faker.random.number({
                    min: 1,
                    max: process.env.STAGE == 'dev' ? 2 : 5
                  });
                  let promises = [];
                  counter++;
                  for (let i = 0; i < numberOfVideos; i++) {
                    promises.push(createVideo({ type: faker.random.boolean() ? 'ProfileGeneric' : 'ProfileSpecific', candidateId: username }));
                    await sleep(300);
                  }

                  return Promise.all(promises);
                })
                .then(async data => {
                  console.log('Created videos for the candidate'.green);
                  counter--;

                  // store created profile generic videos for later usage
                  profileVideosPerCandidate[username] = data
                    .filter(item => {
                      return item.$response.request.rawParams.Item.type == 'ProfileGeneric';
                    })
                    .map(item => item.$response.request.rawParams.Item.id);

                  // create experiences
                  const numberOfExperiences = faker.random.number({
                    min: 1,
                    max: process.env.STAGE == 'dev' ? 2 : 4
                  });
                  let promises = [];
                  counter++;
                  for (let i = 0; i < numberOfExperiences; i++) {
                    promises.push(createExperience(username));
                    await sleep(300);
                  }

                  return Promise.all(promises);
                })
                .then(async () => {
                  console.log('Created experiences'.green);
                  counter--;

                  // create careers
                  const numberOfCareers = faker.random.number({
                    min: 1,
                    max: process.env.STAGE == 'dev' ? 2 : 4
                  });
                  let categories = shuffle(loadedCategories);
                  categories = categories.slice(0, numberOfCareers);
                  let promises = [];
                  counter++;
                  for (const category of categories) {
                    promises.push(createCareer(username, category));
                    await sleep(300);
                  }

                  return Promise.all(promises);
                })
                .then(() => {
                  console.log('Created careers'.green);
                  counter--;
                })
                .catch(error => {
                  console.error(error);
                  counter--;
                });
              await sleep(300);
            } else {
              // update recruiter with its profile attributes in dynamodb table
              counter++;
              let videoId = faker.random.uuid();
              updateRecruiter(username, videoId)
                .then(() => {
                  counter--;
                  console.log('Updated recruiter'.green);

                  // create recruiter video
                  counter++;
                  return createVideo({ id: videoId, type: 'Recruiter', recruiterId: username });
                })
                .then(async () => {
                  counter--;
                  console.log('Created a recruiter video'.green);

                  // create jobs for the recruiter
                  const numberOfJobs = faker.random.number({
                    min: process.env.STAGE == 'dev' ? 1 : 10,
                    max: process.env.STAGE == 'dev' ? 3 : 20
                  });
                  for (let i = 0; i < numberOfJobs; i++) {
                    counter++;
                    let videoId = faker.random.uuid();
                    createJob(username, videoId)
                      .then(async data => {
                        counter--;
                        console.log('Created new job: \n'.green);

                        // create questions of this job
                        const jobId = data.$response.request.rawParams.Item.id;

                        const numberOfQuestions = faker.random.number({
                          min: 1,
                          max: process.env.STAGE == 'dev' ? 2 : 4
                        });
                        for (let j = 0; j < numberOfQuestions; j++) {
                          counter++;
                          createQuestion(jobId, username)
                            .then(() => {
                              counter--;
                              console.log('Created new question: \n'.green);
                            })
                            .catch(error => {
                              counter--;
                              console.error(error);
                            });

                          await sleep(300);
                        }

                        counter++;
                        return Promise.resolve(data);
                      })
                      .then(data => {
                        counter--;
                        // create associated job video with a specified videoId
                        const jobId = data.$response.request.rawParams.Item.id;
                        counter++;
                        createVideo({ id: videoId, type: 'Job', jobId, recruiterId: username })
                          .then(data => {
                            counter--;
                            console.log(JSON.stringify(data));
                          })
                          .catch(error => {
                            counter--;
                            console.error(JSON.stringify(error));
                          });
                      })
                      .catch(error => {
                        counter--;
                        console.error(error);
                      });
                    await sleep(300);
                  }
                })
                .catch(error => {
                  counter--;
                  console.error(error);
                });

              await sleep(300);
            }
          })
          .catch(error => {
            console.error(error);
            counter--;
          });
      }

      // seed application items in ApplicationTable based on existing candidates and jobs
      const wait = () => {
        if (counter > 0) {
          // some promises are going yet, so waiting
          console.log('Waiting...'.yellow);
          setTimeout(wait, 2000);
        } else {
          // all promises have been settle
          console.log('All promises have been completed'.green);
          // setTimeout(createDismatch, 1000);
          setTimeout(createApplication, 2000);
        }
      };

      wait();
    })
    .catch(error => {
      console.error(error);
    });
}

// import us post codes, then start migration on completion
let path = process.env.NODE_ENV == 'debug' ? 'seed/us_postal_codes.csv' : 'us_postal_codes.csv';
fs.createReadStream(path)
  .pipe(csv())
  .on('data', data => {
    zipCodes.push(data['Zip Code']);
  })
  .on('end', () => {
    // start();
    migrateEnumTable().then(() => {
      console.log('Migrated enum tables'.green);
    });
  });
