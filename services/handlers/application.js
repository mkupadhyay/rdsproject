'use strict';

/**
 * Lambda trigger for processing attributes of ApplicationTable
 */

const DynamoDB = require('aws-sdk/clients/dynamodb');
const Converter = DynamoDB.Converter;

const data = require('data-api-client')({
  secretArn: process.env.AWS_SECRET_STORE_ARN,
  resourceArn: process.env.DB_CLUSTER_ARN,
  database: process.env.DB_NAME
});

/**
 * Query more questions related with a specific application
 *
 * @param {string} TableName DDB table name to operate
 * @param {object} image stream record new image object
 * @param {string} IndexName Index name to operate
 */
function getMoreQuestions(TableName, image, IndexName) {
  return data.query(`call usp_get_more_questions(:candidateId, :jobId, :type)`, {
    candidateId: image.candidateId,
    jobId: image.jobId,
    type: 'More'
  });
}

/**
 * Delete a specified item from a specific DDB table except ApplicationTable
 *
 * @param {string} id id of item
 */
function deleteItem(id) {
  return data.query(`call usp_delete_video(:id)`, {
    id
  });
}

/**
 * Cascade or Nullify delete against related objects and files
 *
 * @param {object} image new or old image of the record to do delete operation
 * @param {boolean} isHard indicates it's hard delete or soft delete, if it's true, it's hard delete
 */
async function cascadeDelete(image, isHard) {
  var deleteQuestionPromise;

  // get job's more questions
  deleteQuestionPromise = getMoreQuestions('VideoTable-' + process.env.STAGE, image, 'VideosByType');

  // 1. delete more questions
  try {
    let questions = (await deleteQuestionPromise).Items;
    for (const question of questions) {
      await deleteItem(question.id);
    }
    console.log(`Successfully, ${isHard ? 'hard' : 'soft'} deleted more questions`);
  } catch (error) {
    console.error(JSON.stringify(error));
  }

  // 2. delete application video
  if (image.videoId) {
    try {
      await deleteItem(image.id);
      console.log(`Successfully, ${isHard ? 'hard' : 'soft'} deleted video`);
    } catch (error) {
      console.error(JSON.stringify(error));
    }
  }
}

module.exports.handler = async event => {
  console.log(JSON.stringify(event));

  /***************************************************
   * a. Post processing on delete of the application *
   ***************************************************/
  for (const record of event.Records) {
    if (record.eventName == 'MODIFY') {
      // 1. check if this item has been deleted
      let newImage = record.dynamodb.NewImage;
      newImage = Converter.unmarshall(newImage);
      if (!newImage.deleted) {
        continue;
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
  console.log('Successfully, deleted the application and referring entities!');

  console.log('Successfully, completed all processing');
};
