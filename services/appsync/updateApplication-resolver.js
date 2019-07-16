'use strict';

/**
 * resolver for Mutation.updateApplication field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const PushHelper = require('utilities/push-helper');

const uuid = require('uuid/v4');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  let input = event.arguments.input;
  const identity = event.identity;

  // 1. Validate input arguments and set some input in background
  if (!input.candidateId || !input.jobId) {
    // candidateId & jobId are keys for the application
    throw new Error('Please, specify candidateId and jobId for the application!');
  }
  if (input.preferred && input.status != 'Accepted') {
    // accepted applications only could be preferred by the recruiter
    throw new Error('Invalid request: Accepeted applications only could be preferred by the recruiter!');
  }

  switch (input.status) {
    case 'ReadyForInterview':
      input.roomId = uuid();
      break;
    case 'Declined':
    case 'Withdrawn':
    case 'RecruiterExchanged':
    case 'CandidateExchanged':
    case 'NotExchanged':
      input.readStatus = false;
      break;
    default:
      break;
  }

  // 2. Update object with an input
  let now = new Date(Date.now()).toISOString();
  let params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    Key: {
      candidateId: input.candidateId,
      jobId: input.jobId
    },
    UpdateExpression: 'set updatedAt = :updatedAt',
    ConditionExpression: 'attribute_exists(#candidateId) AND attribute_exists(#jobId)',
    ExpressionAttributeNames: {
      '#candidateId': 'candidateId',
      '#jobId': 'jobId'
    },
    ExpressionAttributeValues: {
      ':updatedAt': now
    },
    ReturnValues: 'ALL_OLD'
  };

  if (input.deleted) {
    // set TTL to 30 days
    input['ttl'] = Math.round(Date.now() / 1000) + 3600 * 24 * 30;
  }

  // configure update expression with input entries
  delete input.candidateId;
  delete input.jobId;
  for (const key in input) {
    if (input.hasOwnProperty(key) && key != 'id') {
      params.UpdateExpression += `, #${key} = :${key}`;
      params.ExpressionAttributeNames[`#${key}`] = key;
      params.ExpressionAttributeValues[`:${key}`] = input[key];
    }
  }

  try {
    var oldObject = (await documentClient.update(params).promise()).Attributes;
    var result = {};
    Object.assign(result, oldObject, input);
    result['updatedAt'] = now;
  } catch (error) {
    console.error(error);
    throw error;
  }
  console.log('Successfully, updated item with input!');

  // Skip sending push notification if the user didn't update application status
  if (!input.hasOwnProperty('status')) {
    console.log('Completed update!');
    return result;
  }

  // 3. Publish push notification to counterpart or both parties according to the application status

  // 3.1. Decide whom to send push notification
  let both = false;
  switch (result.status) {
    case 'Pending':
    case 'Withdrawn':
    case 'Waiting':
    case 'IsReady':
    case 'Interviewing':
    case 'Exchanged':
    case 'NotExchanged':
      both = null;
      break;
    case 'Postponed':
    case 'Missed':
    case 'Interrupted':
    case 'InterviewFinished':
      both = true;
      break;
    default:
      break;
  }

  if (both == null) {
    console.log('Completed update!');
    return result;
  }

  // 3.2. Decide notification type
  const Type = {
    Application: 'Application',
    Interview: 'Interview'
  };
  let type;
  switch (input.status) {
    case 'Pending':
    case 'More':
    case 'Declined':
    case 'Accepted':
    case 'Withdrawn':
      type = Type.Application;
      break;
    default:
      type = Type.Interview;
      break;
  }

  // 3.3. Get recruiter info of this application
  let recruiter, job;

  params = {
    TableName: 'RecruiterTable-' + process.env.STAGE,
    Key: {
      id: result.recruiterId
    }
  };
  let getRecruiterPromise = documentClient
    .get(params)
    .promise()
    .then(data => {
      return (recruiter = data.Item);
    })
    .catch(console.error);

  // 3.4. Get job info of this application
  params = {
    TableName: 'JobTable-' + process.env.STAGE,
    Key: {
      id: result.jobId
    }
  };
  let getJobPromise = documentClient
    .get(params)
    .promise()
    .then(data => {
      return (job = data.Item);
    })
    .catch(console.error);

  await Promise.all([getRecruiterPromise, getJobPromise]);

  // 3.5. Build title & body according to type of notification
  let title, body;
  switch (type) {
    case Type.Application:
      title = `Your Application has been ${result.status}`;
      body = `${recruiter.companyName} has been ${result.status} your application for ${job.title} position`;
      break;
    case Type.Interview:
      title = 'Notification';
      body = 'The application has been updated!';
      break;
    default:
      break;
  }

  // 3.6. Publish push notification to the counterpart only or both parties
  let status = await PushHelper.publish(identity, both, title, body, result, type);

  console.log(`Push sending result: ${status}`);

  console.log('Completed update!');

  return result;
};
