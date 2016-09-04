var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({imageMagick: true}); // Enable ImageMagick integration.
var util = require('util');

// constants
var MAX_WIDTH = 100;
var MAX_HEIGHT = 100;

// get reference to S3 client
var s3 = new AWS.S3();

// Your first function handler
module.exports.newImage = (event, context, cb) => {
    processEvent(event, cb);
    makeThumbnail(event, cb);

};

function process(ticketId, fileName){
    sendToFieldCheck(ticketId);
    sendToPAR(ticketId);
    sendToCVOR(ticketId);
}

function processEvent(event, cb) {
    let item = event.Records[0];
    let srcKey = decodeURIComponent(item.s3.object.key);
    let ticketId = getItem(srcKey, 2);
    let fileName = getItems(srcKey, 1);
    process(ticketId, fileName);
}

function getItem(srcKey, spot){
    let items = srcKey.split('/');
    return items[items.length - spot];

}

function getFileType(fileName) {
    let typeMatch = fileName.match(/\.([^.]*)$/);
    if (!typeMatch) {
        cb("Could not determine the image type.");
        return;
    }
    return typeMatch;
}


function makeThumbnail(event, cb) {
    let srcBucket = event.Records[0].s3.bucket.name,
        srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));

    let fileName = getItem(srcKey, 1), imageType = getFileType(fileName), dstKey = "resized${fileName}";

    if (imageType != "jpg" && imageType != "png") {
        cb('Unsupported image type: ${imageType}');
        return;
    }

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
            function download(next) {
                // Download the image from S3 into a buffer.
                s3.getObject({
                        Bucket: srcBucket,
                        Key: srcKey
                    },
                    next);
            },
            function transform(response, next) {
                gm(response.Body).size(function (err, size) {
                    // Infer the scaling factor to avoid stretching the image unnaturally.
                    var scalingFactor = Math.min(
                        MAX_WIDTH / size.width,
                        MAX_HEIGHT / size.height
                    );
                    var width = scalingFactor * size.width;
                    var height = scalingFactor * size.height;

                    // Transform the image buffer in memory.
                    this.resize(width, height)
                        .toBuffer(imageType, function (err, buffer) {
                            if (err) {
                                next(err);
                            } else {
                                next(null, response.ContentType, buffer);
                            }
                        });
                });
            },
            function upload(contentType, data, next) {
                // Stream the transformed image to a different S3 bucket.
                s3.putObject({
                        Bucket: srcBucket,
                        Key: dstKey,
                        Body: data,
                        ContentType: contentType
                    },
                    next);
            }
        ], function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + dstBucket + '/' + dstKey
                );
            }

            cb(null, "message");
        }
    );

}


// You can add more handlers here, and reference them in serverless.yml
