/**
 * Unit test for ask-resolver.js module
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
  test('usp_ask', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_ask(:recruiterId, :jobIds)`, { recruiterId: 1, jobIds: '1,2,3' });

      console.log('usp_ask', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
