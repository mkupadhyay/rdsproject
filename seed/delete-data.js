'use strict';

/**
 * Wipe all table items for HIREGOAT service and users in user pool: 'hiregoat'
 */
const jsonfile = require('jsonfile');
const util = require('util');
const dotenv = require('dotenv');
require('colors');

const readFile = util.promisify(jsonfile.readFile);
dotenv.config({
  path: '../.env'
});
dotenv.config({
  path: '.env'
});

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

/**
 * wait for some time
 * @param {Number} ms miliseconds to wait
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delete specified user from user pool
 * @param {string} username username to delete from user pool
 */
function deleteUserFromUserPool(username) {
  // delete from user pool
  const params = {
    UserPoolId: process.env['USER_POOL_ID_' + process.env.STAGE],
    Username: username
  };

  cognitoISP
    .adminDeleteUser(params)
    .promise()
    .then(() => {
      console.log('deleted user from user pool'.green);
    })
    .catch(error => {
      console.log(error.message.red);
    });
}

/**
 * wipe all recruiters or candidates according to `isRecruiter` flag
 * @param {boolean} isRecruiter indicates if its wipe for recruiters or candidates
 */
async function wipeUsers(isRecruiter) {
  let params = {
    TableName: isRecruiter ? 'RecruiterTable-' + process.env.STAGE : 'CandidateTable-' + process.env.STAGE,
    AttributesToGet: ['id']
  };
  documentClient
    .scan(params)
    .promise()
    .then(async data => {
      if (data && data.Items.length == 0) {
        return Promise.reject();
      }
      for (const item of data.Items) {
        params = {
          TableName: isRecruiter ? 'RecruiterTable-' + process.env.STAGE : 'CandidateTable-' + process.env.STAGE,
          Key: {
            id: item.id
          }
        };
        documentClient
          .delete(params)
          .promise()
          .then(() => {
            console.log('deleted user'.green);
          })
          .catch(error => {
            console.log(error);
          });

        // delete from user pool
        deleteUserFromUserPool(item.id);
        await sleep(500);
      }
    })
    .catch(() => {
      console.log("items are not available or don't exist in the tables".green, 'so trying to delete from user pool directly'.green);
      // import users data migrated from users.json
      let path = process.env.NODE_ENV == 'debug' ? 'seed/users.json' : 'users.json';
      return readFile(path, 'utf8');
    })
    .then(async data => {
      console.log('read from users.json'.green);
      if (!data) return;
      for (const user of data) {
        deleteUserFromUserPool(user.username);
        await sleep(500);
      }
    })
    .catch(error => console.log(error.message.red));
}

/**
 * wipe specified table
 * @param {string} table table name to wipe
 */
async function wipe(table) {
  let params = {
    TableName: table,
    AttributesToGet: ['id']
  };
  documentClient
    .scan(params)
    .promise()
    .then(async data => {
      for (const item of data.Items) {
        params = {
          TableName: table,
          Key: {
            id: item.id
          }
        };
        documentClient
          .delete(params)
          .promise()
          .then(() => {
            console.log('deleted '.green + table.green + ' item'.green);
          })
          .catch(error => {
            console.log(error.message.red);
          });

        await sleep(500);
      }
    })
    .catch(error => console.log(error.message.red));
}

/**
 * wipe DismatchTable-*
 */
function wipeDismatch() {
  const table = 'DismatchTable-' + process.env.STAGE;
  let params = {
    TableName: table,
    AttributesToGet: ['candidateId', 'jobId']
  };
  documentClient
    .scan(params)
    .promise()
    .then(async data => {
      for (const item of data.Items) {
        params = {
          TableName: table,
          Key: {
            candidateId: item.candidateId,
            jobId: item.jobId
          }
        };
        documentClient
          .delete(params)
          .promise()
          .then(() => {
            console.log('deleted '.green + table.green + ' item'.green);
          })
          .catch(error => {
            console.log(error.message.red);
          });

        await sleep(500);
      }
    })
    .catch(error => console.log(error.message.red));
}

/**
 * wipe ApplicationTable-*
 */
function wipeApplication() {
  const table = 'ApplicationTable-' + process.env.STAGE;
  let params = {
    TableName: table,
    AttributesToGet: ['candidateId', 'jobId']
  };
  documentClient
    .scan(params)
    .promise()
    .then(async data => {
      for (const item of data.Items) {
        params = {
          TableName: table,
          Key: {
            candidateId: item.candidateId,
            jobId: item.jobId
          }
        };
        documentClient
          .delete(params)
          .promise()
          .then(() => {
            console.log('deleted '.green + table.green + ' item'.green);
          })
          .catch(error => {
            console.log(error.message.red);
          });

        await sleep(500);
      }
    })
    .catch(error => console.log(error.message.red));
}

// wipe RecruiterTable and recruiters in user pool
wipeUsers(true);

// wipe CandidateTable and candidates in user pool
wipeUsers(false);

// wipe JobTable
wipe('JobTable-' + process.env.STAGE);

// wipe QuestionTable
wipe('QuestionTable-' + process.env.STAGE);

// wipe VideoTable
wipe('VideoTable-' + process.env.STAGE);

// wipe CareerTable
wipe('CareerTable-' + process.env.STAGE);

// wipe ExperienceTable
wipe('ExperienceTable-' + process.env.STAGE);

// wipe IndustryTable
wipe('IndustryTable-' + process.env.STAGE);

// wipe WorkTypeTable
wipe('WorkTypeTable-' + process.env.STAGE);

// wipe CareerCategory
wipe('CareerCategoryTable-' + process.env.STAGE);

// wipe SalaryTypeTable
wipe('SalaryTypeTable-' + process.env.STAGE);

// wipe IncentiveTable
wipe('IncentiveTable-' + process.env.STAGE);

// wipe CategoryTypeTable
wipe('CategoryTypeTable-' + process.env.STAGE);

// wipe BenefitTable
wipe('BenefitTable-' + process.env.STAGE);

// wipe RequirementTable
wipe('RequirementTable-' + process.env.STAGE);

// wipe CurrentStatusTable
wipe('CurrentStatusTable-' + process.env.STAGE);

// wipe EducationTable
wipe('EducationTable-' + process.env.STAGE);

// wipe ResumeTable
wipe('ResumeTable-' + process.env.STAGE);

// wipe TitleTable
wipe('TitleTable-' + process.env.STAGE);

// wipe ApplicationTable
wipeApplication();

// wipe DismatchTable
wipeDismatch();
