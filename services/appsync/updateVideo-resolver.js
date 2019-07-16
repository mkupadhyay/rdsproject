'use strict';

/**
 * resolver for Mutation.updateVideo field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const nch = require('non-crypto-hash');
const algo = nch.createHash('murmurhash3');
const S3 = require('aws-sdk/clients/s3');

const s3 = new S3({
  signatureVersion: 'v4',
  region: process.env.AWSREGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
});

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  const input = event.arguments.input;
  const identity = event.identity;

  // 1. get old video object to update
  let params = {
    TableName: 'VideoTable-' + process.env.STAGE,
    Key: {
      id: input.id
    }
  };

  try {
    var oldVideo = (await documentClient.get(params).promise()).Item;
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 2. update object with an input
  const updatedAt = new Date(Date.now()).toISOString();
  params = {
    TableName: 'VideoTable-' + process.env.STAGE,
    Key: {
      id: input.id
    },
    UpdateExpression: 'set updatedAt = :updatedAt',
    ConditionExpression: 'attribute_exists(#id) and #owner = :username',
    ExpressionAttributeNames: {
      '#id': 'id'
    },
    ExpressionAttributeValues: {
      ':updatedAt': updatedAt
    },
    ReturnValues: 'ALL_OLD'
  };

  // set :username
  params.ExpressionAttributeValues[':username'] = identity.username;

  // set #owner
  if (identity) {
    switch (oldVideo.type) {
      case 'ProfileGeneric':
      case 'ProfileSpecific':
      case 'Application':
      case 'More':
        params.ExpressionAttributeNames['#owner'] = 'candidateId';
        break;
      case 'Recruiter':
      case 'Job':
        params.ExpressionAttributeNames['#owner'] = 'recruiterId';
        break;
      default:
        break;
    }
  }

  if (input.deleted) {
    // if user soft deleted, then we set TTL for this item with 30 days interval
    input['ttl'] = Math.round(Date.now() / 1000) + 3600 * 24 * 30;
  }

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
    result['updatedAt'] = updatedAt;
  } catch (error) {
    console.error(JSON.stringify(error));
    throw error;
  }

  // 3. delete old video and image files from S3 bucket
  var user;
  let type = oldObject.type;
  let isCandidate;

  switch (type) {
    case 'ProfileGeneric': // candidate creates a video for himself
    case 'ProfileSpecific':
    case 'Application': // candidate creates a video for the specific application
    case 'More': // recruiter creates more question about a specific application, but owner is candidate
      isCandidate = true;
      break;
    case 'Recruiter': // recruiter creates a video for himself
    case 'Job': // recruiter creates a video for the specific job
      isCandidate = false;
      break;
    default:
      throw new Error('Invalid video type, so aborting');
  }

  user = algo.hash(identity.username);

  if (!user) {
    console.log('Successfully, updated a video');
    return result;
  }

  let promises = [];
  if (input.video && oldObject.video && type) {
    const params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `vid2018accf28dcb-64a/${user}/${type}/${oldObject.video}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .then(console.log)
        .catch(console.error)
    );
  }

  if (input.thumbnail && oldObject.thumbnail && type) {
    // delete original image file from S3 bucket
    let params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `img2018accf28dcb-64a/${user}/${type}/${oldObject.thumbnail}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .then(console.log)
        .catch(console.error)
    );

    // delete thumbnail image from S3 bucket
    params = {
      Bucket: process.env.LOW_BUCKET,
      Key: `thumb/img2018accf28dcb-64a/${user}/${type}/${oldObject.thumbnail}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .catch(console.error)
    );

    // delete blur image from S3 bucket
    params = {
      Bucket: process.env.LOW_BUCKET,
      Key: `blur/img2018accf28dcb-64a/${user}/${type}/${oldObject.thumbnail}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .catch(console.error)
    );
  }

  await Promise.all(promises);

  // 4. generate presigned URL for videoURL/thumbnailURL and return updated video object
  if (input.video) {
    const params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `vid2018accf28dcb-64a/${user}/${type}/${input.video}`,
      ACL: 'private',
      ContentType: 'video/mp4'
    };
    try {
      result.videoURL = {
        url: s3.getSignedUrl('putObject', params)
      };
    } catch (error) {
      console.log(JSON.stringify({ error }));
      throw error;
    }
  }

  if (input.thumbnail) {
    const params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `img2018accf28dcb-64a/${user}/${type}/${input.thumbnail}`,
      ACL: 'private',
      ContentType: 'image/jpeg'
    };

    try {
      result.thumbnailURL = {
        url: s3.getSignedUrl('putObject', params)
      };
    } catch (error) {
      console.log(JSON.stringify({ error }));
      throw error;
    }
  }

  console.log('Completed update!');

  return result;
};
