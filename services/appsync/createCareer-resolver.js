'use strict';

/**
 * resolver for Mutation.createCareer field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const uuid = require('uuid/v4');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let args = event.arguments;

  // 1. validate args
  if (!args.input) throw new Error('Specify input argument!');

  if (!args.input.categoryId || !args.input.experience || !args.input.candidateId) throw new Error('Specify categoryId, experience and candidateId arguments!');

  const categoryId = args.input.categoryId;
  const candidateId = args.input.candidateId;
  const experience = args.input.experience;

  // 2. check if it's existing career or not for a specific career category
  var params = {
    TableName: 'CareerTable-' + process.env.STAGE,
    IndexName: 'Careers',
    KeyConditionExpression: 'candidateId = :candidateId',
    FilterExpression: '#categoryId = :categoryId',
    ExpressionAttributeNames: {
      '#categoryId': 'categoryId'
    },
    ExpressionAttributeValues: {
      ':candidateId': candidateId,
      ':categoryId': categoryId
    }
  };

  try {
    var careers = (await documentClient.query(params).promise()).Items;
  } catch (error) {
    console.error(error);
    throw error;
  }

  var existingCareer = !careers || careers.length == 0 ? false : true;

  // 3. update if it's existing career and else create new one
  if (existingCareer) {
    // get existing career
    let career = careers[0];
    let updatedAt = new Date(Date.now()).toISOString();
    params = {
      TableName: 'CareerTable-' + process.env.STAGE,
      Key: {
        id: career.id
      },
      UpdateExpression: 'set #e = :e, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#e': 'experience',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':e': experience,
        ':updatedAt': updatedAt
      }
    };

    try {
      await documentClient.update(params).promise();
      career.experience = experience;
      career.updatedAt = updatedAt;
      return career;
    } catch (error) {
      console.error(error);
      throw error;
    }
  } else {
    let career = {
      id: uuid(),
      categoryId,
      experience,
      candidateId,
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    };
    params = {
      TableName: 'CareerTable-' + process.env.STAGE,
      Item: career
    };

    try {
      await documentClient.put(params).promise();
      return career;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }
};
