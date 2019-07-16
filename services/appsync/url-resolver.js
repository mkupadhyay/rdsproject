'use strict';

/**
 * Resolver for Video.videoURL and Video.thumbnailURL field
 */

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

  // 1. decide owner, kind, type to build a key of the object
  var owner, kind, type;

  type = event.source.type;

  switch (type) {
    case 'ProfileGeneric':
    case 'ProfileSpecific':
      owner = event.source.candidateId;
      break;
    case 'Job':
      owner = event.source.recruiterId;
      break;
    case 'Recruiter':
      owner = event.source.recruiterId;
      break;
    case 'Application':
      owner = event.source.candidateId;
      break;
    case 'More':
      owner = event.source.candidateId;
      break;
    default:
      console.log('Not valid type, so skipping..');
      return null;
  }

  kind = event.field == 'video' ? 'vid' : 'img';

  if (event.source.videoURL && kind == 'vid') {
    // videoURL is resolved already by mutation, so just return it
    console.log(`videoURL: ${JSON.stringify(event.source.videoURL)}`);
    return event.source.videoURL;
  }

  if (event.source.thumbnailURL && kind == 'img') {
    // thumbnailURL is resolved already by mutation, so just return it
    console.log(`thumbnailURL: ${JSON.stringify(event.source.thumbnailURL)}`);
    return event.source.thumbnailURL;
  }

  if (!owner) {
    console.log('Unavailable owner!');
    return null;
  }

  let user = algo.hash(owner);

  let fileName;
  if (kind == 'vid') {
    fileName = event.source.video;
  } else {
    fileName = event.source.thumbnail;
  }

  if (!fileName) {
    console.log('file name is unavailable!');
    return null;
  }

  // 2. build a params for getting presigned URL
  const params = {
    Bucket: process.env.ORIGIN_BUCKET,
    Key: `${kind}2018accf28dcb-64a/${user}/${type}/${fileName}`
  };
  const params_thumb = {
    Bucket: process.env.LOW_BUCKET,
    Key: `thumb/${kind}2018accf28dcb-64a/${user}/${type}/${fileName}`
  };
  const params_blur = {
    Bucket: process.env.LOW_BUCKET,
    Key: `blur/${kind}2018accf28dcb-64a/${user}/${type}/${fileName}`
  };

  try {
    var url, thumbnail, blur;

    // 3. get Presigned URL of video or thumbnail
    if (event.arguments.method.toLowerCase() == 'get') {
      // check if file object exists in the bucket
      await s3.headObject(params).promise();

      url = s3.getSignedUrl('getObject', params);
      thumbnail = s3.getSignedUrl('getObject', params_thumb);
      blur = s3.getSignedUrl('getObject', params_blur);

      // convert to CloudFront URLs
      url = url.replace(`${process.env.ORIGIN_BUCKET}.s3.${process.env.AWSREGION}.amazonaws.com`, process.env[`CLOUDFRONT`]);
      thumbnail = thumbnail.replace(`${process.env.LOW_BUCKET}.s3.${process.env.AWSREGION}.amazonaws.com`, process.env[`CLOUDFRONT_LOW`]);
      blur = blur.replace(`${process.env.LOW_BUCKET}.s3.${process.env.AWSREGION}.amazonaws.com`, process.env[`CLOUDFRONT_LOW`]);
    } else if (event.arguments.method.toLowerCase() == 'post') {
      url = s3.getSignedUrl('putObject', params);
      thumbnail = s3.getSignedUrl('putObject', params_thumb);
      blur = s3.getSignedUrl('putObject', params_blur);
    }

    var response = {
      url,
      thumbnail,
      blur
    };

    console.log(`URL: ${JSON.stringify(response)}`);

    return response;
  } catch (error) {
    console.log(JSON.stringify({ error }));
    return null;
  }
};
