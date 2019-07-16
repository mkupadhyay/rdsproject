'use strict';

/**
 * Helper module for SNS management
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const SNS = require('aws-sdk/clients/sns');
const sns = new SNS();

const uuid = require('uuid/v4');

/**
 * Get endpint ARN registered previously from DB
 *
 * @param {string} deviceToken device token to register
 * @param {boolean} isCandidate indicates whether the registering user is candidate or not
 * @param {string} userId user id of registering user
 *
 * @return endpoint arn registered previously, or null if no endpoint arn is stored
 */
async function getEndpointArn(deviceToken, isCandidate, userId) {
  console.log(`Getting endpoint associated with device token: ${deviceToken} of ${isCandidate ? 'candidate' : 'recruiter'}: ${userId}`);

  var params = {
    TableName: 'DeviceTable-' + process.env.STAGE,
    IndexName: 'DevicesByUser',
    KeyConditionExpression: 'userId = :userId and #token = :token',
    ExpressionAttributeNames: {
      '#token': 'token',
      '#deleted': 'deleted'
    },
    ExpressionAttributeValues: {
      ':userId': userId,
      ':token': deviceToken,
      ':userType': isCandidate ? 'Candidate' : 'Recruiter',
      ':deleted': true
    },
    FilterExpression: 'userType = :userType and #deleted <> :deleted'
  };

  try {
    let devices = (await documentClient.query(params).promise()).Items;
    if (devices && devices.length > 0) {
      return devices[0].endpointArn;
    } else {
      return null;
    }
  } catch (error) {
    console.error(JSON.stringify(error));
    return null;
  }
}

/**
 * Stores the endpoint arn in DB for look up next time
 *
 * @param {string} platform mobile platform
 * @param {string} token device token to register
 * @param {string} endpointArn SNS platform endpoint object ARN to delete
 * @param {boolean} isCandidate indicates whether the registering user is candidate or not
 * @param {string} userId user id of registering user
 *
 * @return returns a stored device id
 */
async function storeEndpointArn(platform, token, endpointArn, isCandidate, userId) {
  console.log(`Storing endpoint: ${endpointArn} of ${isCandidate ? 'candidate' : 'recruiter'}: ${userId}`);

  // 1. Check if device is registered already in DB
  let params = {
    TableName: 'DeviceTable-' + process.env.STAGE,
    IndexName: 'DevicesByUser',
    KeyConditionExpression: 'userId = :userId and #token = :token',
    ExpressionAttributeNames: {
      '#token': 'token',
      '#deleted': 'deleted'
    },
    ExpressionAttributeValues: {
      ':userId': userId,
      ':token': token,
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

  // 2. Store device to DB
  if (devices.length > 0) {
    console.log('Found existing device stored already');

    // 2.1. Update device if there is existing device in DB
    let deviceToUpdate = devices[0];
    params = {
      TableName: 'DeviceTable-' + process.env.STAGE,
      Key: {
        id: deviceToUpdate.id
      },
      UpdateExpression: 'set #endpointArn = :endpointArn, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#endpointArn': 'endpointArn'
      },
      ExpressionAttributeValues: {
        ':endpointArn': endpointArn,
        ':updatedAt': new Date(Date.now()).toISOString()
      }
    };

    try {
      await documentClient.update(params).promise();
      console.log('Updated device in DB');

      return deviceToUpdate.id;
    } catch (error) {
      console.error(JSON.stringify(error));
      throw error;
    }
  } else {
    // 2.2 Store device if there is no existing device item in DB

    let id = uuid();
    params = {
      TableName: 'DeviceTable-' + process.env.STAGE,
      Item: {
        id,
        token,
        endpointArn,
        platform,
        userId,
        userType: isCandidate ? 'Candidate' : 'Recruiter',
        createdAt: new Date(Date.now()).toISOString(),
        updatedAt: new Date(Date.now()).toISOString()
      }
    };

    try {
      await documentClient.put(params).promise();
      console.log(`Stored endpointArn to DB with id: ${id}`);
    } catch (error) {
      console.error(JSON.stringify(error));
      throw error;
    }

    return id;
  }
}

/**
 * Set endpint attributes
 *
 * @param {string} endpointArn endpointArn to set attributes
 * @param {string} deviceToken device token associated with endpoint
 * @param {boolean} isCandidate indicates whether owner is candidate or recruiter
 * @param {string} userId owner user id
 */
async function setEndpointAttributes(endpointArn, deviceToken, isCandidate, userId) {
  console.log('Setting endpoint attributes in SNS');
  try {
    // 1. Get registering user info
    let params = {
      TableName: isCandidate ? 'CandidateTable-' + process.env.STAGE : 'RecruiterTable-' + process.env.STAGE,
      Key: {
        id: userId
      }
    };
    let user = (await documentClient.get(params).promise()).Item;

    // 2. Set attributes of specified endpoint
    params = {
      EndpointArn: endpointArn,
      Attributes: {
        Enabled: 'true',
        Token: deviceToken,
        CustomUserData: JSON.stringify({ username: userId, email: user.email, isCandidate })
      }
    };
    await sns.setEndpointAttributes(params).promise();
  } catch (error) {
    console.error(JSON.stringify(error));
  }
}

/**
 * Create endpoint in SNS and store it in DB
 *
 * @param {string} platform mobile platform published device token
 * @param {string} deviceToken device token to register
 * @param {boolean} isCandidate indicates whether the registering user is candidate or not
 * @param {string} userId user id of registering user
 */
async function createEndpoint(platform, deviceToken, isCandidate, userId) {
  console.log(`Creating endpoint for device token: ${deviceToken} of ${isCandidate ? 'candidate' : 'recruiter'}: ${userId}`);

  var endpointArn;

  // 1. Create endpoint in SNS
  let PlatformApplicationArn;
  if (platform == 'iOS') {
    PlatformApplicationArn = isCandidate ? process.env[`SNS_APPLICATION_CANDIDATE_IOS_ARN`] : process.env[`SNS_APPLICATION_RECRUITER_IOS_ARN`];
  } else if (platform == 'Android') {
    PlatformApplicationArn = isCandidate ? process.env[`SNS_APPLICATION_CANDIDATE_ANDROID_ARN`] : process.env[`SNS_APPLICATION_RECRUITER_ANDROID_ARN`];
  }

  try {
    let params = {
      PlatformApplicationArn,
      Token: deviceToken
    };
    endpointArn = (await sns.createPlatformEndpoint(params).promise()).EndpointArn;
  } catch (error) {
    console.error(JSON.stringify(error));

    let reg = /.*Endpoint (arn:aws:sns[^ ]+) already exists with the same Token.*/;
    let matches = error.message.match(reg);
    if (matches) {
      console.log('Endpoint exists already with same token, but different custom user data');
      // 1.1. Extract endpointArn from error
      endpointArn = matches[1];

      try {
        // 1.2. delete old devices associated to other user from DB
        console.log('Deleting old devices associated with other user from DB');

        let params = {
          TableName: 'DeviceTable-' + process.env.STAGE,
          IndexName: 'DevicesByToken',
          KeyConditionExpression: '#token = :token',
          ExpressionAttributeNames: {
            '#token': 'token',
            '#deleted': 'deleted'
          },
          ExpressionAttributeValues: {
            ':token': deviceToken,
            ':deleted': true
          },
          FilterExpression: '#deleted <> :deleted'
        };

        let oldDevices = (await documentClient.query(params).promise()).Items;

        oldDevices = oldDevices.filter(device => device.userId != userId);

        console.log(`Old devices to delete: ${JSON.stringify(oldDevices)}`);

        let promises = [];
        for (const device of oldDevices) {
          params = {
            TableName: 'DeviceTable-' + process.env.STAGE,
            Key: {
              id: device.id
            }
          };
          promises.push(documentClient.delete(params).promise());
        }

        await Promise.all(promises);

        console.log(`Deleted old devices from DB`);
      } catch (error) {
        console.error(JSON.stringify(error));
        throw error;
      }
    } else {
      // actually bad input, throws an error
      throw error;
    }
  }

  try {
    // 2. Set Endpint attributes in SNS
    await setEndpointAttributes(endpointArn, deviceToken, isCandidate, userId);
    console.log(`Created endpoint: ${endpointArn}`);

    // 3. Store endpoint in DB
    await storeEndpointArn(platform, deviceToken, endpointArn, isCandidate, userId);
  } catch (error) {
    console.error(JSON.stringify(error));

    // roll back
    let params = {
      EndpointArn: endpointArn
    };
    await sns.deleteEndpoint(params).promise();

    throw error;
  }

  return endpointArn;
}

/**
 * Register device token in specified SNS platform appliction
 *
 * @param {string} platform mobile platform published device token
 * @param {string} deviceToken device token to register in SNS
 * @param {boolean} isCandidate indicates whether the registering user is candidate or not
 * @param {string} userId user id of a registering user
 */
module.exports.registerDeviceToken = async (platform, deviceToken, isCandidate, userId) => {
  console.log(`Registering device token: ${deviceToken} of ${isCandidate ? 'candidate' : 'recruiter'}: ${userId}`);

  // 1. Retrieve endpoint for this user from DB
  var endpointArn;

  try {
    endpointArn = await getEndpointArn(deviceToken, isCandidate, userId);
  } catch (error) {
    throw error;
  }

  // 2. Create endpoint if it's not stored in DB
  if (!endpointArn) {
    try {
      endpointArn = await createEndpoint(platform, deviceToken, isCandidate, userId);
    } catch (error) {
      throw error;
    }
  }

  console.log('Checking endpoint data...');

  // 3. Check the endpoint attributes and make sure it has lastly updated
  try {
    let params = {
      EndpointArn: endpointArn
    };
    let attributes = (await sns.getEndpointAttributes(params).promise()).Attributes;

    if (attributes.Enabled.toLocaleLowerCase() !== 'true' || attributes.Token !== deviceToken) {
      // 3.1. update endpoint data with lastest info if it's not updated
      console.log('Updating endpoint data with lastest info');
      await setEndpointAttributes(endpointArn, deviceToken, isCandidate, userId);
    }
  } catch (error) {
    console.error(JSON.stringify(error));
    if (error.code == 'NotFound') {
      // 3.2. endpoint was deleted, so recreate it
      console.log('Recreating endpoint as it has been deleted');
      endpointArn = await createEndpoint(platform, deviceToken, isCandidate, userId);
    } else {
      throw error;
    }
  }

  console.log(`Registered endpointArn: ${endpointArn}`);

  return endpointArn;
};

/**
 * Unregister device token from SNS and DB
 *
 * @param {string} deviceToken device token to register
 * @param {boolean} isCandidate indicates whether the registering user is candidate or not
 * @param {string} userId user id of a registering user
 */
module.exports.unregisterDeviceToken = async (deviceToken, isCandidate, userId) => {
  console.log(`Unregistering device: ${deviceToken} of ${isCandidate ? 'candidate' : 'recruiter'}: ${userId}`);

  // 1. Get device to delete from DB by device token
  let params = {
    TableName: 'DeviceTable-' + process.env.STAGE,
    IndexName: 'DevicesByUser',
    KeyConditionExpression: 'userId = :userId and #token = :token',
    ExpressionAttributeNames: {
      '#token': 'token',
      '#deleted': 'deleted'
    },
    ExpressionAttributeValues: {
      ':userId': userId,
      ':token': deviceToken,
      ':deleted': true
    },
    FilterExpression: '#deleted <> :deleted'
  };

  try {
    var devices = (await documentClient.query(params).promise()).Items;
    console.log(`Devices to unregister:\n${JSON.stringify(devices)}`);
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 2. Delete endpoint from SNS
  let promises = [];
  for (const device of devices) {
    params = {
      EndpointArn: device.endpointArn
    };

    promises.push(sns.deleteEndpoint(params).promise());
  }

  try {
    await Promise.all(promises);
    console.log('Deleted endpoints from SNS');
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 3. Delete device from DB
  promises.length = 0;
  for (const device of devices) {
    params = {
      TableName: 'DeviceTable-' + process.env.STAGE,
      Key: {
        id: device.id
      }
    };
    promises.push(documentClient.delete(params).promise());
  }

  try {
    await Promise.all(promises);
    console.log('Deleted devices from DB');
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }
};
