'use strict';

var Jimp = require('jimp');
var FS = require('fs');
const S3 = require('aws-sdk/clients/s3');

const s3 = new S3({
  signatureVersion: 'v4',
  region: process.env.AWSREGION,
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
});

const uuid = require('uuid/v4');

module.exports.handler = event => {
  console.log(JSON.stringify(event));

  var sourceBucket = process.env.ORIGIN_BUCKET;
  var destinationBucket = process.env.LOW_BUCKET;

  // 1. Get source image from S3 bucket
  var objectKey = event.Records[0].s3.object.key;
  var getObjectParams = {
    Bucket: sourceBucket,
    Key: objectKey
  };

  s3.getObject(getObjectParams, function(error, data) {
    if (error) {
      console.log(error, error.stack);
    } else {
      console.log('Successfully, got the source image.');

      Jimp.read(data.Body, (err, image) => {
        if (err) throw err;
        var thumbnail = image.clone();
        image.resize(Jimp.AUTO, 100);
        image.blur(5);
        thumbnail.resize(Jimp.AUTO, 160);

        // 2. Store blur image to the bucket
        var blurName = uuid();
        image.write(`/tmp/${blurName}.png`, (err, res) => {
          if (err) throw err;

          console.log(res);

          var content = new Buffer(FS.readFileSync(`/tmp/${blurName}.png`));

          var uploadParams = {
            Bucket: destinationBucket,
            Key: 'blur/' + objectKey,
            Body: content,
            ContentType: data.ContentType,
            StorageClass: 'STANDARD'
          };

          s3.upload(uploadParams, function(err) {
            if (err) {
              console.log(err, err.stack);
            } else {
              console.log('Blur image has been uploaded successfully.');
            }
          });
        });

        // 3. Store thumbnail image to the bucket
        var thumbnailName = uuid();
        thumbnail.write(`/tmp/${thumbnailName}.png`, (err, res) => {
          if (err) throw err;
          console.log(res);

          var content = new Buffer(FS.readFileSync(`/tmp/${thumbnailName}.png`));
          var uploadParams = {
            Bucket: destinationBucket,
            Key: 'thumb/' + objectKey,
            Body: content,
            ContentType: data.ContentType,
            StorageClass: 'STANDARD'
          };
          s3.upload(uploadParams, function(err) {
            if (err) {
              console.log(err, err.stack);
            } else {
              console.log('Thumbnail has been uploaded successfully.');
            }
          });
        });
      });
    }
  });
};
