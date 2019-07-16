'use strict';

/**
 * Lambda trigger for processing attributes of JobTable
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});
const Converter = DynamoDB.Converter;

const PushHelper = require('utilities/push-helper');

// Import SNS
const SNS = require('aws-sdk/clients/sns');
const sns = new SNS();

/**
 * compare old and new objects and extract different key/value pairs betweeen them
 *
 * @param {object} oldObject old object
 * @param {object} newObject new object
 */
function diff(oldObject, newObject) {
  let result = {};
  if (oldObject) {
    for (const key in oldObject) {
      if (oldObject.hasOwnProperty(key)) {
        const element = oldObject[key];
        if (newObject && newObject.hasOwnProperty(key)) {
          if (JSON.stringify(element) !== JSON.stringify(newObject[key])) {
            result[key] = newObject[key];
          }
        } else {
          result[key] = element;
        }
      }
    }
  }

  if (newObject) {
    for (const key in newObject) {
      if (newObject.hasOwnProperty(key)) {
        if (oldObject && oldObject.hasOwnProperty(key)) continue;
        result[key] = newObject[key];
      }
    }
  }

  if (Object.keys(result).length == 0) {
    result = null;
  }

  return result;
}

/**
 * Send push notification to appropriate topic about newly created or updated job
 *
 * 1. Validate whether to proceed or not
 * 2. Decide target topic to publish a push notification from Recruiter.industryId & Job.careerCategoryId
 * 3. Publish a push notifiction to target topic
 *
 * @param {array} records event stream records
 */
async function notifyMatchedJobs(records) {
  for (const record of records) {
    // 1. Validate whether to proceed or not

    // Skip for hard delete case
    if (record.eventName == 'REMOVE') continue;

    let newImage = record.dynamodb.NewImage;
    newImage = Converter.unmarshall(newImage);

    // Skip for other unnecessary cases
    if (record.eventName == 'MODIFY') {
      let oldImage = record.dynamodb.OldImage;
      oldImage = Converter.unmarshall(oldImage);

      // get changes update made
      let changes = diff(oldImage, newImage);
      console.log(`changes: ${JSON.stringify(changes)}`);

      // skip sending of a notification for unnecessary cases
      if (changes) {
        if (changes.hasOwnProperty('loweredTitle')) continue;
        if (changes.hasOwnProperty('loweredDescription')) continue;
        if (changes.hasOwnProperty('location')) continue;
        if (Object.keys(changes).length == 1 && changes.hasOwnProperty('updatedAt')) continue;
      } else {
        continue;
      }
    }

    // check if this job is valid one to notify
    if (!newImage.status || newImage.status == 'Expired' || newImage.status == 'Deleted' || newImage.status == 'Draft') {
      continue;
    }

    // skip sending a notification if this job is being soft deleted
    if (newImage.deleted) continue;

    // 2. Get target TopicArn
    // Get industryId of this job
    let params = {
      TableName: 'RecruiterTable-' + process.env.STAGE,
      KeyConditionExpression: '#id = :recruiterId',
      ExpressionAttributeNames: {
        '#id': 'id'
      },
      ExpressionAttributeValues: {
        ':recruiterId': newImage.recruiterId
      }
    };

    try {
      let response = await documentClient.query(params).promise();
      var industryId = response.Items[0].industryId;
    } catch (error) {
      console.error(JSON.stringify(error));
      continue;
    }

    // Get TargetArn
    let Name = `${industryId}_${newImage.careerCategoryId}`;
    try {
      var TopicArn = (await sns.createTopic({ Name }).promise()).TopicArn;
    } catch (error) {
      console.error(JSON.stringify(error));
      continue;
    }

    // 3. Publish push notification to TopicArn
    let payload = { id: newImage.id, event: record.eventName };
    let result = await PushHelper.publishToTopic(TopicArn, 'title', 'body', payload);
    console.log(`Push sending result: ${result}`);
  }

  console.log('Completed notification publishing!');
}

/**
 * Process Job stream and set loweredTitle & loweredDescription against setting title & description or updating
 *
 * @param {array} records event stream records to process
 */
async function processJob(records) {
  var dbPromises = [];
  for (const record of records) {
    if (record.eventName == 'REMOVE') continue;

    let newImage = record.dynamodb.NewImage;
    newImage = Converter.unmarshall(newImage);
    let oldImage = record.dynamodb.OldImage;
    oldImage = Converter.unmarshall(oldImage);

    var isTitleUpdated = false,
      isDescriptionUpdated = false;
    if (record.eventName == 'INSERT') {
      if (newImage.title) {
        isTitleUpdated = true;
      }
      if (newImage.description) {
        isDescriptionUpdated = true;
      }
    } else if (record.eventName == 'MODIFY') {
      let changes = diff(oldImage, newImage);
      if (changes) {
        if (changes.hasOwnProperty('loweredTitle')) continue;
        if (changes.hasOwnProperty('loweredDescription')) continue;
        if (changes.hasOwnProperty('location')) continue;
        if (Object.keys(changes).length == 1 && changes.hasOwnProperty('updatedAt')) continue;
      } else {
        continue;
      }

      if (newImage.title && newImage.title == oldImage.title) {
        isTitleUpdated = false;
      }

      if (newImage.description && newImage.description == oldImage.description) {
        isDescriptionUpdated = false;
      }
    }

    if (!isTitleUpdated && !isDescriptionUpdated) continue;

    var UpdateExpression = `set ${isTitleUpdated ? '#t = :t, #lt = :lt' : ''}${isDescriptionUpdated ? (isTitleUpdated ? ', #d = :d, #ld = :ld' : ' #d = :d, #ld = :ld') : ''}`;
    var ExpressionAttributeNames = {};
    var ExpressionAttributeValues = {};

    if (isTitleUpdated) {
      ExpressionAttributeNames['#t'] = 'title';
      ExpressionAttributeNames['#lt'] = 'loweredTitle';
      ExpressionAttributeValues[':t'] = newImage.title;
      ExpressionAttributeValues[':lt'] = newImage.title.toLowerCase();
    }

    if (isDescriptionUpdated) {
      ExpressionAttributeNames['#d'] = 'description';
      ExpressionAttributeNames['#ld'] = 'loweredDescription';
      ExpressionAttributeValues[':d'] = newImage.description;
      ExpressionAttributeValues[':ld'] = newImage.description.toLowerCase();
    }

    let params = {
      TableName: 'JobTable-' + process.env.STAGE,
      Key: {
        id: record.dynamodb.Keys.id.S
      },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ConditionExpression: 'attribute_exists(id)'
    };
    dbPromises.push(
      documentClient
        .update(params)
        .promise()
        .then(console.log)
        .catch(console.error)
    );
  }

  await Promise.all(dbPromises);

  console.log('Completed title & description processing!');
}

/**
 * Query related items
 *
 * @param {string} TableName DDB table name to operate
 * @param {string} jobId id of referring job
 * @param {string} IndexName Index name to operate
 */
function getRelatedObjects(TableName, jobId, IndexName) {
  let params = {
    TableName,
    KeyConditionExpression: '#jobId = :jobId',
    ExpressionAttributeNames: {
      '#jobId': 'jobId'
    },
    ExpressionAttributeValues: {
      ':jobId': jobId
    }
  };
  IndexName ? (params['IndexName'] = IndexName) : null;
  return documentClient.query(params).promise();
}

/**
 * Delete a specified item from a specific DDB table
 *
 * @param {boolean} isHard indicates whether to soft or hard delete
 * @param {string} TableName DDB table name to operate
 * @param {string} id id of item to soft delete
 */
function deleteItem(isHard, TableName, item) {
  const isApplication = TableName.indexOf('ApplicationTable') > -1;
  if (isHard) {
    // hard delete item
    let params = {
      TableName
    };
    if (isApplication) {
      params['Key'] = { candidateId: item.candidateId, jobId: item.jobId };
    } else {
      params['Key'] = { id: item.id };
    }
    return documentClient.delete(params).promise();
  } else {
    // soft delete item
    let updatedAt = new Date(Date.now()).toISOString();
    let params = {
      TableName,
      UpdateExpression: 'set #d = :d, #t = :t, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#d': 'deleted',
        '#t': 'ttl',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':d': true,
        ':t': Math.round(Date.now() / 1000) + 3600 * 24 * 30,
        ':updatedAt': updatedAt
      }
    };
    if (isApplication) {
      params['Key'] = { candidateId: item.candidateId, jobId: item.jobId };
    } else {
      params['Key'] = { id: item.id };
    }
    return documentClient.update(params).promise();
  }
}

/**
 * Cascade or Nullify delete against related objects and files
 *
 * @param {object} image new or old image of the record to do delete operation
 * @param {boolean} isHard indicates it's hard delete or soft delete, if it's true, it's hard delete
 */
async function cascadeDelete(image, isHard) {
  var deleteQuestionPromise, deleteInvitationPromise, deleteApplicationPromise;

  // get job's questions
  deleteQuestionPromise = getRelatedObjects('QuestionTable-' + process.env.STAGE, image.id, 'Questions');

  // get job's invitations
  deleteInvitationPromise = getRelatedObjects('InvitationTable-' + process.env.STAGE, image.id, 'InvitationsByJob');

  // get job's applications
  deleteApplicationPromise = getRelatedObjects('ApplicationTable-' + process.env.STAGE, image.id, 'Applications');

  // 1. delete questions
  try {
    let questions = (await deleteQuestionPromise).Items;
    for (const question of questions) {
      await deleteItem(isHard, 'QuestionTable-' + process.env.STAGE, question);
    }
    console.log(`Successfully, ${isHard ? 'hard' : 'soft'} deleted questions`);
  } catch (error) {
    console.error(JSON.stringify(error));
  }

  // 2. delete invitations
  try {
    let invitations = (await deleteInvitationPromise).Items;
    for (const invitation of invitations) {
      await deleteItem(isHard, 'InvitationTable-' + process.env.STAGE, invitation);
    }
    console.log(`Successfully, ${isHard ? 'hard' : 'soft'} deleted invitations`);
  } catch (error) {
    console.error(JSON.stringify(error));
  }

  // 3. delete job video
  if (image.videoId) {
    try {
      await deleteItem(isHard, 'VideoTable-' + process.env.STAGE, image);
      console.log(`Successfully, ${isHard ? 'hard' : 'soft'} deleted job video`);
    } catch (error) {
      console.error(JSON.stringify(error));
    }
  }

  // 4. delete applications
  try {
    let applications = (await deleteApplicationPromise).Items;
    for (const application of applications) {
      await deleteItem(isHard, 'ApplicationTable-' + process.env.STAGE, application);
    }
    console.log(`Successfully, ${isHard ? 'hard' : 'soft'} deleted applications`);
  } catch (error) {
    console.error(JSON.stringify(error));
  }
}

module.exports.handler = async event => {
  console.log(JSON.stringify(event));
  /************************************************************************
   * a. Notify to matched candidates about new or updated job through SNS *
   ************************************************************************/
  await notifyMatchedJobs(event.Records);

  /**********************************************
   * b. Handle title and description attributes *
   **********************************************/
  await processJob(event.Records);

  /*******************************************
   * c. Post processing on delete of the job *
   *******************************************/
  for (const record of event.Records) {
    if (record.eventName == 'MODIFY') {
      // 1. check if this item has been deleted
      let newImage = record.dynamodb.NewImage;
      newImage = Converter.unmarshall(newImage);
      if (!newImage.deleted) {
        if (!(newImage.status == 'Expired' || newImage.status == 'Deleted' || newImage.status == 'Filled' || newImage.status == 'Canceled')) {
          continue;
        }
      }

      console.log('Start soft delete');
      await cascadeDelete(newImage, false);
    } else if (record.eventName == 'REMOVE') {
      console.log('Start hard delete');
      let oldImage = record.dynamodb.OldImage;
      oldImage = Converter.unmarshall(oldImage);
      await cascadeDelete(oldImage, true);
    }
  }
  console.log('Successfully, deleted the job and referring entities!');

  console.log('Successfully, completed all processing');
};
