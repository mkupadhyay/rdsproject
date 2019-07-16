'use strict';

/**
 * resolver for Mutation.sendMessage field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const PushHelper = require('utilities/push-helper');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let input = event.arguments;
  const identity = event.identity;

  // 1. Validate input arguments
  try {
    var message = JSON.parse(input.message);
  } catch (error) {
    console.error(error.message);
    throw new Error('Invalid message parameter, it should be valid JSON string!');
  }

  try {
    var alert = JSON.parse(input.alert);

    if (!alert.title || !alert.body) {
      throw new Error('Invalid alert paramter, it should include title & body keys!');
    }
  } catch (error) {
    console.error(error.message);
    throw new Error('Invalid alert parameter, it should be valid JSON string!');
  }

  // 2. Decide receiver
  var receiverId, isCandidate;
  if (identity.username == input.candidateId) {
    // sender is candidate and receiver is recruiter
    isCandidate = false;

    // Get application information to get recruiterId
    let params = {
      TableName: 'ApplicationTable-' + process.env.STAGE,
      Key: {
        candidateId: input.candidateId,
        jobId: input.jobId
      }
    };
    try {
      let application = (await documentClient.get(params).promise()).Item;
      receiverId = application.recruiterId;
    } catch (error) {
      console.error("Couldn't get application info");
      throw error;
    }
  } else {
    // sender is recruiter
    isCandidate = true;
    receiverId = input.candidateId;
  }

  // 3. Publish push notification to the receiver
  let result = await PushHelper.send(isCandidate, receiverId, alert.title, alert.body, message, 'Message');

  console.log(`Successfully, sent a message with the result: ${result}`);

  return result;
};
