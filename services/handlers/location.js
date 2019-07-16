'use strict';
const DynamoDB = require('aws-sdk/clients/dynamodb');
const documentClient = new DynamoDB.DocumentClient({
  region: process.env.AWSREGION,
  apiVersion: '2012-08-10'
});

var zipcodes = require('zipcodes');

module.exports.handler = async event => {
  console.log(JSON.stringify(event));
  var newZip;
  for (const record of event.Records) {
    if (record.eventName == 'REMOVE') continue;
    if (record.eventName == 'INSERT') {
      // convert zip to lat/lng
      newZip = record.dynamodb.NewImage['zip'] ? record.dynamodb.NewImage.zip.S : null;
      if (!newZip) continue;
    } else if (record.eventName == 'MODIFY') {
      // convert zip to lat/lng
      newZip = record.dynamodb.NewImage['zip'] ? record.dynamodb.NewImage.zip.S : null;
      var oldZip = record.dynamodb.OldImage['zip'] ? record.dynamodb.OldImage.zip.S : null;
      if (newZip && newZip == oldZip) continue;
    }

    let location = zipcodes.lookup(newZip); // this might fail because of invalid zip code

    // store lat/lng to Table
    let tableName = null;
    if (record.eventSourceARN.indexOf('CandidateTable') > -1) {
      tableName = 'CandidateTable-' + process.env.STAGE;
    } else if (record.eventSourceARN.indexOf('JobTable') > -1) {
      tableName = 'JobTable-' + process.env.STAGE;
    }
    let params = {
      TableName: tableName,
      Key: {
        id: record.dynamodb.Keys.id.S
      },
      UpdateExpression: 'set latitude = :latitude, longitude = :longitude, #location = :location',
      ExpressionAttributeNames: {
        '#location': 'location'
      },
      ExpressionAttributeValues: {
        ':latitude': location ? location.latitude : 0,
        ':longitude': location ? location.longitude : 0,
        ':location': location ? `${location.city}, ${location.state}` : 'Unknown'
      },
      ConditionExpression: 'attribute_exists(id)'
    };
    try {
      await documentClient.update(params).promise();
      console.log('converted successfully!');
    } catch (error) {
      console.error(error);
      continue;
    }
  }
};
