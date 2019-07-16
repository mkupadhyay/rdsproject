'use strict';

/**
 * Bootstraper for creating all possible topics for all combination of industries & career categories
 */

// import environment variables
const dotenv = require('dotenv');
dotenv.config({
  path: '../.env'
});
dotenv.config({
  path: '.env'
});

// import DDB
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: 'us-east-1',
  apiVersion: '2012-08-10'
});

// import SNS
const SNS = require('aws-sdk/clients/sns');
const sns = new SNS();

const product = require('../utilities/product').product;

/**
 * Start bootstrapping
 */
async function start() {
  // 1. Get all existing industryId list & careerCategoryId list in the system

  // Get all existing industry ids
  var params = {
    TableName: 'IndustryTable-' + process.env.STAGE,
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': true
    },
    FilterExpression: '#status = :status'
  };

  try {
    var industries = (await documentClient.scan(params).promise()).Items;
    industries = industries.map(item => item.id);
    console.log('Successfully, fetched all industry Ids');
    console.log(industries);
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // Get all existing career category ids
  params = {
    TableName: 'CareerCategoryTable-' + process.env.STAGE,
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': true
    },
    FilterExpression: '#status = :status'
  };

  try {
    var careerCategories = (await documentClient.scan(params).promise()).Items;
    careerCategories = careerCategories.map(item => item.id);
    console.log('Successfully, fetched all career category Ids');
    console.log(careerCategories);
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 2. Generate all combinations with industryIds & careerCategoryIds to use as topic names
  var names = product(industries, careerCategories);

  // 3. Create topics for each combination
  var promises = [];
  for (const Name of names) {
    params = {
      Name
    };
    let promise = sns
      .createTopic(params)
      .promise()
      .then(console.log)
      .catch(console.error);
    promises.push(promise);
  }
  await Promise.all(promises);

  console.log('Successfully, created all topics!');
}

start();
