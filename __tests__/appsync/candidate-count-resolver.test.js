/**
 * Unit test for candidate-count-resolver.js module
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
  test('usp_get_candidate_count', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_get_candidate_count(:candidateId, :statuses)`, {
        candidateId: 1,
        statuses: 'Pending, Accepted, Waiting, IsReady, Interview, ReadyForInterview'
      });

      console.log('usp_get_candidate_count', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
