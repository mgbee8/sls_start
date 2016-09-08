'use strict';

var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({imageMagick: true}); // Enable ImageMagick integration.
var util = require('util');
var http = require('http');

// constants
var MAX_WIDTH = 100;
var MAX_HEIGHT = 100;

// get reference to S3 client
var s3 = new AWS.S3();
var docClient = new AWS.DynamoDB.DocumentClient();

module.exports.imageAdded = (event, context, cb) => {
    sendToDynamoDb(event, cb);
    makeThumbnail(event, cb);
};

module.exports.fakeAuthorize = (event, context, cb) => {
    context.succeed(generatePolicy('user', 'Allow', event.methodArn));
};

module.exports.fakeResponseFieldCheck = (event, context, cb) => {

    let response = {
        "ticket_id": event.body.ticket_id,
        "subsidiary": event.body.subsidiary,
        "ticket_description": "some random text"
    };
    console.log(response);
    cb(null, response);
};

function generatePolicy(principalId, effect, resource) {
    var authResponse = {};
    authResponse.principalId = principalId;
    if (effect && resource) {
        var policyDocument = {};
        policyDocument.Version = '2012-10-17'; // default version
        policyDocument.Statement = [];
        var statementOne = {};
        statementOne.Action = 'execute-api:Invoke'; // default action
        statementOne.Effect = effect;
        statementOne.Resource = resource;
        policyDocument.Statement[0] = statementOne;
        authResponse.policyDocument = policyDocument;
    }
    return authResponse;
}

function sendToManifests(event, cb) {
    let srcBucket = event.Records[0].s3.bucket.name,
        srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")),
        fileName = getItem(srcKey, 1),
        subsidiary = getItem(srcKey, 0),
        ticketId = getItem(srcKey, 2);

    var params = {
        TableName: 'manifests',
        Item: {
            file_name: fileName,
            subsidiary: subsidiary,
            ticket_id: ticketId,
            bucket: srcBucket,
            key: srcKey
        }
    };

    docClient.put(params, function (err, data) {
        if (err) console.log(err);
        else console.log(data);
        cb('mainfest inserted');
    });
}

function sendToImages(event, cb) {
    let srcBucket = event.Records[0].s3.bucket.name,
        srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")),
        fileName = getItem(srcKey, 1),
        subsidiary = getItem(srcKey, 0),
        ticketId = getItem(srcKey, 2);

    if (srcKey.toLowerCase().indexOf("resized") != -1) {
        getExifData(event, cb);
        var params = {
            TableName: 'images',
            Item: {
                file_name: fileName,
                subsidiary: subsidiary,
                ticket_id: ticketId,
                bucket: srcBucket,
                key: srcKey
            }
        };

        docClient.put(params, function (err, data) {
            if (err) console.log(err);
            else console.log(data);
            cb('image inserted');
        });
    }
}


function sendToDynamoDb(event, cb) {

    let srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")),
        fileName = getItem(srcKey, 1),
        imageType = getFileType(fileName)[1];

    if (imageType.toLowerCase() == '@cv') {
        sendToManifests(event, cb);
    } else {
        sendToImages(event, cb);
    }
}

function getItem(srcKey, spot) {
    let items = srcKey.split('/');
    return spot == 0 ? items[0] : items[items.length - spot];

}

function getFileType(fileName) {
    let typeMatch = fileName.match(/\.([^.]*)$/);
    console.log(typeMatch);
    if (!typeMatch) {
        cb("Could not determine the image type.");
        return;
    }
    return typeMatch;
}

function getExifData(event, cb) {

}

function makeThumbnail(event, cb) {
    let srcBucket = event.Records[0].s3.bucket.name,
        srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")),
        fileName = getItem(srcKey, 1),
        imageType = getFileType(fileName)[1],
        dstKey = `resized${fileName}`;


    if (imageType != "jpg" && imageType != "png") {
        cb(`Unsupported image type: ${imageType}`);
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
                    ' and upload to ' + srcBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
                console.log(
                    'Successfully resized ' + srcBucket + '/' + srcKey +
                    ' and uploaded to ' + srcBucket + '/' + dstKey
                );
            }

            cb(null, "message");
        }
    );

}



