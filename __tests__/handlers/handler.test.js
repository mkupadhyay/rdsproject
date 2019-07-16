/**
 * Unit test for handler.js module
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
  test('usp_get_invitation', async () => {
    expect.assertions(1);
    const email = 'ravi@test.com';
    try {
      let invitations = await data.query(`call usp_get_invitation(:email)`, { email });
      console.log('usp_get_invitation', JSON.stringify(invitations));

      expect(invitations).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });

  test('usp_insert_users', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_insert_users(:username, :email,  :firstName, :lastName, :userType, :type, :phone, :zip)`, {
        username: 'username1',
        email: 'test1@test.com',
        firstName: 'firstName1',
        lastName: 'lastName1',
        userType: 'Candidate',
        type: 'HGC',
        phone: '19384294134',
        zip: '100343'
      });

      console.log('usp_insert_users', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });

  test('usp_update_invitation', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_update_invitation(:id, :userId)`, {
        id: 1,
        userId: 6
      });

      console.log('usp_update_invitation', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });

  test('usp_save_token', async () => {
    expect.assertions(1);
    try {
      let response = await data.query(`call usp_save_token(:userId, :token)`, {
        userId: 1,
        token: `iofjwifjwfjweofjwoiejfoiwjfdlfwe`
      });

      console.log('usp_save_token', JSON.stringify(response));

      expect(response).toEqual(expect.anything());
    } catch (error) {
      console.error(error);
    }
  });
});
