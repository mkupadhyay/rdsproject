'use strict';

/**
 * resolver for Mutation.createVideo field
 */
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

const uuid = require('uuid/v4');

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

  let input = event.arguments.input;
  const identity = event.identity;
  const type = input.type;
  var isCandidate;

  // 1. input validation
  switch (type) {
    case 'ProfileGeneric': // candidate creates a video for himself
    case 'ProfileSpecific':
      isCandidate = true;
      break;
    case 'Recruiter': // recruiter creates a video for himself
      isCandidate = false;
      break;
    case 'Application': // candidate creates a video for the specific application
      isCandidate = true;
      if (!input.jobId || !input.recruiterId) {
        console.error('Error: jobId & recruiterId are required params for application video');
        throw new Error('jobId & recruiterId are required params for application video!');
      }
      break;
    case 'More': // recruiter creates more question about a specific application, but candidate will be owner of video
      isCandidate = true;
      if (!input.jobId || !input.candidateId) {
        console.error('jobId and candidateId are required params for more questions');
        throw new Error('jobId and candidateId are required params for more questions!');
      }
      break;
    case 'Job': // recruiter creates a video for the specific job
      isCandidate = false;
      if (!input.jobId) {
        console.error('jobId is required param for job video');
        throw new Error('jobId is required param for job video!');
      }
      break;
    default:
      throw new Error('Invalid video type, so aborting');
  }

  // 2. check if there is an existing video for Job, Recruiter, Application type
  if (type == 'Job' || type == 'Recruiter' || type == 'Application') {
    let params = {
      TableName: 'VideoTable-' + process.env.STAGE,
      KeyConditionExpression: '#type = :type',
      ExpressionAttributeNames: {
        '#type': 'type'
      },
      ExpressionAttributeValues: {}
    };

    switch (type) {
      case 'Job':
        params['IndexName'] = 'VideosByType';
        params.KeyConditionExpression += ' and #recruiterId = :recruiterId';
        params.ExpressionAttributeNames['#recruiterId'] = 'recruiterId';
        params.ExpressionAttributeValues[':type'] = 'Job';
        params.ExpressionAttributeValues[':recruiterId'] = identity.username;
        params.ExpressionAttributeValues[':jobId'] = input.jobId;
        params.FilterExpression = 'jobId = :jobId';
        break;
      case 'Recruiter':
        params['IndexName'] = 'VideosByType';
        params.KeyConditionExpression += ' and #recruiterId = :recruiterId';
        params.ExpressionAttributeNames['#recruiterId'] = 'recruiterId';
        params.ExpressionAttributeValues[':type'] = 'Recruiter';
        params.ExpressionAttributeValues[':recruiterId'] = identity.username;
        break;
      case 'Application':
        params['IndexName'] = 'Videos';
        params.KeyConditionExpression += ' and #candidateId = :candidateId';
        params.ExpressionAttributeNames['#candidateId'] = 'candidateId';
        params.ExpressionAttributeValues[':type'] = 'Application';
        params.ExpressionAttributeValues[':candidateId'] = identity.username;
        break;
      default:
        break;
    }

    try {
      let videos = (await documentClient.query(params).promise()).Items;
      if (videos && videos.length > 0) {
        // video exists already for this object, we just allowed 1:1 relationship only
        throw new Error('There is an existing video already for this object!');
      }
    } catch (error) {
      console.error(JSON.stringify(error));
      throw error;
    }
  }

  // 3. create a new video object with an input
  let params = {
    TableName: 'VideoTable-' + process.env.STAGE,
    Item: {
      id: uuid(),
      createdAt: new Date(Date.now()).toISOString(),
      updatedAt: new Date(Date.now()).toISOString()
    }
  };
  Object.assign(params.Item, input);

  // set candidateId, recruiterId, jobId according to the type
  var user;

  user = identity.username;
  isCandidate ? (params.Item['candidateId'] = user) : (params.Item['recruiterId'] = user);

  user = algo.hash(user);

  try {
    await documentClient.put(params).promise();
  } catch (error) {
    console.error(error);
    throw error;
  }

  let video = params.Item;

  // 4. generate presigned URL for videoURL/thumbnailURL and return created video object
  if (!user) {
    console.log('Successfully, created a new video');
    return video;
  }

  if (input.video) {
    const params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `vid2018accf28dcb-64a/${user}/${input.type}/${input.video}`,
      ACL: 'private',
      ContentType: 'video/mp4'
    };
    try {
      video.videoURL = {
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
      Key: `img2018accf28dcb-64a/${user}/${input.type}/${input.thumbnail}`,
      ACL: 'private',
      ContentType: 'image/jpeg'
    };

    try {
      video.thumbnailURL = {
        url: s3.getSignedUrl('putObject', params)
      };
    } catch (error) {
      console.log(JSON.stringify({ error }));
      throw error;
    }
  }

  console.log('Successfully, created a new video');

  return video;
};
