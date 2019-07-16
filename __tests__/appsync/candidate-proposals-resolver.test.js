/**
 * Unit test for candidate-proposals-resolver.js module
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
  test('usp_get_candidate_proposals', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_get_candidate_proposals(:candidateId, :jobId, :statuses)`, {
        candidateId: 1,
        jobId: 1,
        statuses: 'Pending, Waiting, Accepted'
      });

      console.log('usp_get_candidate_proposals', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
