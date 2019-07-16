'use strict';

/**
 * Helper module for push notification feature
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const SNS = require('aws-sdk/clients/sns');
const sns = new SNS();

/**
 * Send the push notification to counterpart candidate or recrutier according to isCandidate
 *
 * @param {boolean} isCandidate indicates whether the receiver is candidate or not
 * @param {string} receiverId user id of receiver
 * @param {string} title message title
 * @param {body} body message body
 * @param {object} payload payload data to be sent along the push notification
 * @param {string} type notification type
 */
async function send(isCandidate, receiverId, title, body, payload, type) {
  try {
    // 1. Get receiver info
    var params = {
      TableName: (isCandidate ? 'CandidateTable-' : 'RecruiterTable-') + process.env.STAGE,
      Key: {
        id: receiverId
      }
    };
    let receiver = (await documentClient.get(params).promise()).Item;

    // 2. Check receiver's status
    var data;
    switch (type) {
      case 'Interview':
        data = { data: payload, type: 'application' };
        if (receiver.status === 'Offline' || receiver.status === 'Invisible') {
          console.error('Error: Skipping, receiver is not available to get any notification!');
          return false;
        }
        break;
      case 'Ask':
        data = { data: payload, type: 'ask' };
        if (receiver.status != 'Online') {
          console.error('Error: Skipping, receiver is not available to get any notification!');
          return false;
        }
        break;
      case 'Application':
        data = { data: payload, type: 'application' };
        if (receiver.status === 'Offline') {
          console.error('Error: Skipping, receiver is not available to get any notification!');
          return false;
        }
        break;
      case 'Message':
        data = { data: payload, type: 'interview' };
        if (receiver.status != 'Online') {
          console.error('Error: Skipping, receiver is not available to get any notification!');
          return false;
        }
        break;
      default:
        break;
    }

    // 3. Get all devices of receiver
    params = {
      TableName: 'DeviceTable-' + process.env.STAGE,
      IndexName: 'DevicesByUser',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeNames: {
        '#deleted': 'deleted'
      },
      ExpressionAttributeValues: {
        ':userId': receiverId,
        ':deleted': true
      },
      FilterExpression: '#deleted <> :deleted'
    };

    let devices = (await documentClient.query(params).promise()).Items;
    if (!devices) {
      console.error(`Not Found registered devices for the receiver: ${receiver.id}`);
      return false;
    }

    // 4. Publish push notification to all devices of receiver
    let publishPromises = [];

    // todo: add support for FCM
    let key = process.env.STAGE == 'beta' || process.env.STAGE == 'prod' ? 'APNS' : 'APNS_SANDBOX';

    let Message = {
      default: 'This is default message'
    };

    Message[key] = JSON.stringify({
      aps: {
        alert: {
          title,
          body
        },
        sound: 'default'
      },
      data
    });
    Message = JSON.stringify(Message);

    console.log(`Sending Message: ${Message}`);

    for (const device of devices) {
      params = {
        TargetArn: device.endpointArn,
        MessageStructure: 'json',
        Message
      };

      publishPromises.push(
        sns
          .publish(params)
          .promise()
          .then(console.log)
          .catch(console.error)
      );
    }

    await Promise.all(publishPromises);

    console.log('Successfully, sent push notifications to the receiver');

    return true;
  } catch (error) {
    console.error(JSON.stringify(error));
    return false;
  }
}

module.exports.send = send;

/**
 * Publish push notification to the receiver with specifed payload, alert title, body
 *
 * @param {Object} identity sender's identity sending this push notification
 * @param {boolean} both indicates if we should send the push notification to only one receiver or both parties
 * @param {string} title message title
 * @param {body} body message body
 * @param {object} payload payload data to be sent along the push notification
 * @param {string} type notification type
 */
module.exports.publish = async (identity, both, title, body, payload, type) => {
  // 1. Identify whether sender is recruier or candidate
  if (!identity) return false;

  let isCandidate = false;
  if (identity.groups.includes('Admin')) {
    console.log('Skipping sending push notification as this is update by admin..');
    return false;
  }

  isCandidate = identity.groups.includes('Candidate');
  isCandidate = !isCandidate;

  // 2. Send push notification to counterpart
  let receiverId = isCandidate ? payload.candidateId : payload.recruiterId;
  var promises = [];

  promises.push(send(isCandidate, receiverId, title, body, payload, type));

  // 3. Send also himself if both is turned on
  if (both) {
    promises.push(send(!isCandidate, receiverId, title, body, payload, type));
  }

  await Promise.all(promises);

  return false;
};

/**
 * Publish push notification to specific topic with specifed payload, alert title, body
 *
 * @param {string} TopicArn topic arn to publish message
 * @param {string} title alert title of push notification
 * @param {string} body alert body of push notification
 * @param {Object} payload payload data to be sent along push notification
 * @return returns true if it's successful, else false
 */
module.exports.publishToTopic = async (TopicArn, title, body, payload) => {
  // 1. Validate
  if (!TopicArn) return false;

  // 2. Publish push notification to topic
  let data = { data: payload, type: 'lead' };

  // todo: add support for FCM
  let key = process.env.STAGE == 'beta' || process.env.STAGE == 'prod' ? 'APNS' : 'APNS_SANDBOX';

  let Message = {
    default: 'This is default message'
  };

  Message[key] = JSON.stringify({
    aps: {
      alert: {
        title,
        body
      },
      sound: 'default'
    },
    data
  });

  Message = JSON.stringify(Message);

  let params = {
    TopicArn,
    MessageStructure: 'json',
    Message
  };

  console.log(`Message: ${Message}`);

  return sns
    .publish(params)
    .promise()
    .then(() => {
      console.log('Successfully, published a push notifiation to topic');
      return true;
    })
    .catch(error => {
      console.error(JSON.stringify(error));
      return false;
    });
};
