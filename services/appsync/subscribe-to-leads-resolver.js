'use strict';

/**
 * Resolver for Mutation.subscribeToLeads field
 */

// Import DDB
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

// Import SNS
const SNS = require('aws-sdk/clients/sns');
const sns = new SNS();

// Import Product
const product = require('utilities/product').product;

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  var username = event.identity.username;

  // 1. Get industry ids & career category ids of this candidate
  // Get industry ids of this candidate
  var params = {
    TableName: 'CandidateTable-' + process.env.STAGE,
    Key: {
      id: username
    }
  };

  try {
    var candidate = (await documentClient.get(params).promise()).Item;
    var industries = candidate.industryIds;
    console.log(industries);
    console.log('Successfully, fetched industry Ids');
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // Get career category ids of this candidate
  params = {
    TableName: 'CareerTable-' + process.env.STAGE,
    IndexName: 'Careers',
    KeyConditionExpression: 'candidateId = :candidateId',
    ExpressionAttributeValues: {
      ':candidateId': username
    }
  };

  try {
    let careers = (await documentClient.query(params).promise()).Items;
    var careerCategories = careers.map(item => item.categoryId);
    console.log(careerCategories);
    console.log('Successfully, fetched career category Ids');
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 2. Generate all combinations with industryIds & careerCategoryIds to use as topic names
  var names = product(industries, careerCategories);

  // 3. Get TopicArns for this candidate to subscribe
  var promises = [];
  for (const Name of names) {
    promises.push(
      sns
        .createTopic({ Name })
        .promise()
        .then(data => data.TopicArn)
    );
  }

  try {
    var topicArns = await Promise.all(promises);
    console.log(JSON.stringify(topicArns));
    console.log('Successfully, Got TopicArns');
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 4. Subscribe to topics

  // Get all registered endpoints of this user
  params = {
    TableName: 'DeviceTable-' + process.env.STAGE,
    IndexName: 'DevicesByUser',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeNames: {
      '#deleted': 'deleted'
    },
    ExpressionAttributeValues: {
      ':userId': username,
      ':deleted': true
    },
    FilterExpression: '#deleted <> :deleted'
  };

  try {
    var devices = (await documentClient.query(params).promise()).Items;
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  var endpointArns = devices.map(device => device.endpointArn);

  if (!endpointArns || endpointArns.length == 0) {
    console.error('Error: No endoint for this user yet!');
    throw new Error('No endpoint for this user yet!');
  }

  promises = [];
  for (const TopicArn of topicArns) {
    // subscribe each endpoint to the topic
    for (const endpointArn of endpointArns) {
      promises.push(
        sns
          .subscribe({ Protocol: 'application', TopicArn, Endpoint: endpointArn, ReturnSubscriptionArn: true })
          .promise()
          .then(data => data.SubscriptionArn)
      );
    }
  }

  try {
    var subscriptionArns = await Promise.all(promises);
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 5. Return subscription ARN list subscribed
  console.log(JSON.stringify(subscriptionArns));
  console.log('Successfully, subscribed to leads');

  return subscriptionArns;
};
