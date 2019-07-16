/**
 * Unit test for application.js module
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
  test('usp_delete_video', async () => {
    expect.assertions(1);

    try {
      let response = await data.query(`call usp_delete_video(:id)`, {
        id: 1
      });

      console.log('usp_delete_video', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });

  test('usp_get_more_questions', async () => {
    expect.assertions(1);

    try {
      let response = await data.query(`call usp_get_more_questions(:candidateId, :jobId, :type)`, {
        candidateId: 1,
        jobId: 1,
        type: 'More'
      });

      console.log('usp_get_more_questions', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
