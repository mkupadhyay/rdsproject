/**
 * Unit test for candidate-jobs-resolver.js module
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config({
  path: '.env'
});

const data = require('data-api-client')({
  secretArn: process.env.AWS_SECRET_STORE_ARN,
  resourceArn: process.env.DB_CLUSTER_ARN,
  database: process.env.DB_NAME
});

describe('DB operations', () => {
  test('usp_get_candidate_jobs', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_get_candidate_jobs(:candidateId)`, { candidateId: 1 });

      console.log('usp_get_candidate_jobs', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
