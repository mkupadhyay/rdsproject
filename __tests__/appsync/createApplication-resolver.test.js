/**
 * Unit test for createApplication-resolver.js module
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
  test('usp_create_application', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_create_application(:candidateId, :jobId, :ready, :profileVideoId)`, {
        candidateId: 1,
        jobId: 1,
        ready: 1,
        profileVideoId: 1
      });

      console.log('usp_create_application', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
