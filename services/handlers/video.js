'use strict';

/**
 * Lambda trigger for processing stream of VideoTable
 *
 * Here, we will do a post-process like delete all referring applications and
 * delete file objects from S3 bucket according to the soft & hard delete of video object
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});
const Converter = DynamoDB.Converter;

const elasticsearch = require('elasticsearch');
const httpAwsEs = require('http-aws-es');

const nch = require('non-crypto-hash');
const algo = nch.createHash('murmurhash3');
const S3 = require('aws-sdk/clients/s3');

const s3 = new S3({
  signatureVersion: 'v4',
  region: process.env.AWSREGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
});

/**
 * wait for some miliseconds
 * @param {number} ms miliseconds to wait
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Delete all referring applications to the video
 *
 * @param {Object} es Elasticsearch client object
 * @param {Object} record Event stream record
 */
async function deleteApplications(es, record) {
  let username = record.candidateId;
  let profileVideoId = record.id;

  // find referring applications to this video record
  let size = 1000;
  var params = {
    index: 'application',
    type: 'application',
    body: {
      size,
      query: {
        bool: {
          must: [
            {
              match_phrase: {
                candidateId: username
              }
            },
            {
              match_phrase: {
                profileVideoId
              }
            }
          ]
        }
      },
      sort: [
        {
          createdAt: {
            order: 'asc'
          }
        }
      ]
    }
  };

  try {
    var response = await es.search(params);
  } catch (error) {
    es.close();
    console.error(`${error}`);
    throw error;
  }

  let items = response.hits.hits.map(item => item._source);
  console.log(`Successfully, fetched referring applications: ${items.length}`);

  // delete referring applications
  params = {
    TableName: 'ApplicationTable-' + process.env.STAGE,
    Key: {
      candidateId: username,
      jobId: null
    },
    UpdateExpression: 'set #deleted = :deleted, #updatedAt = :updatedAt, #profileVideoId = :profileVideoId',
    ConditionExpression: 'attribute_exists(#candidateId) AND attribute_exists(#jobId)',
    ExpressionAttributeNames: {
      '#deleted': 'deleted',
      '#candidateId': 'candidateId',
      '#jobId': 'jobId',
      '#profileVideoId': 'profileVideoId',
      '#updatedAt': 'updatedAt'
    },
    ExpressionAttributeValues: {
      ':updatedAt': null,
      ':deleted': true,
      ':profileVideoId': null
    }
  };

  for (const application of items) {
    params.Key.jobId = application.jobId;
    params.ExpressionAttributeValues[':updatedAt'] = new Date(Date.now()).toISOString();
    documentClient
      .update(params)
      .promise()
      .then(data => console.log(`${data}`))
      .catch(error => console.error(`${error}`));
    await sleep(300);
  }
}

/**
 * delete all relational files from S3 bucket
 *
 * @param {Object} record event stream record
 */
async function deleteFiles(record) {
  let username = record.candidateId;
  let user = algo.hash(username);
  let video = record.video;
  let thumbnail = record.thumbnail;
  let type = record.type;
  let profileVideoId = record.id;

  console.log(`username: ${username}\nuser: ${user}\nvideo: ${video}\nthumbnail: ${thumbnail}\ntype: ${type}\nprofileVideoId: ${profileVideoId}`);

  var promises = [];
  if (video) {
    const params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `vid2018accf28dcb-64a/${user}/${type}/${video}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .catch(console.error)
    );
  }

  if (thumbnail) {
    // delete original image from S3 bucket
    let params = {
      Bucket: process.env.ORIGIN_BUCKET,
      Key: `img2018accf28dcb-64a/${user}/${type}/${thumbnail}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .catch(console.error)
    );

    // delete thumbnail image from S3 bucket
    params = {
      Bucket: process.env.LOW_BUCKET,
      Key: `thumb/img2018accf28dcb-64a/${user}/${type}/${thumbnail}`
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
      Key: `blur/img2018accf28dcb-64a/${user}/${type}/${thumbnail}`
    };
    promises.push(
      s3
        .deleteObject(params)
        .promise()
        .catch(console.error)
    );
  }

  return Promise.all(promises);
}

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  var es = new elasticsearch.Client({ host: process.env.ES_ENDPOINT, connectionClass: httpAwsEs });

  for (const record of event.Records) {
    if (record.eventName == 'MODIFY') {
      // 1. check if this video has been deleted
      let newImage = record.dynamodb.NewImage;
      newImage = Converter.unmarshall(newImage);
      if (!newImage.deleted) {
        continue;
      }

      console.log('Start soft delete');

      // 2. delete referring applications
      if (newImage.type === 'ProfileGeneric') {
        try {
          await deleteApplications(es, newImage);
        } catch (error) {
          console.error(JSON.stringify(error));
          continue;
        }
      }
    } else if (record.eventName == 'REMOVE') {
      console.log('Start hard delete');
      let oldImage = record.dynamodb.OldImage;
      oldImage = Converter.unmarshall(oldImage);

      // 1. delete files from S3
      let deleteFilePromise = deleteFiles(oldImage);

      // 2. delete referring applications
      if (oldImage.type === 'ProfileGeneric') {
        var deleteApplicationsPromise = deleteApplications(es, oldImage);
      }

      try {
        await deleteFilePromise;
        if (oldImage.type === 'ProfileGeneric') {
          await deleteApplicationsPromise;
        }
      } catch (error) {
        console.error(JSON.stringify(error));
      }
    }
    console.log('Successfully, deleted the video and referring applications');
  }

  es.close();
};
