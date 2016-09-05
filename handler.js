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

// Your first function handler
module.exports.newImage = (event, context, cb) => {
    processEvent(event, cb);
    makeThumbnail(event, cb);

};

function post(options, data) {
    let req =  http.request(options, function(res) {
        console.log('Status: ' + res.statusCode);
        console.log('Headers: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (body) {
            console.log('Body: ' + body);
        });
    });
    req.write(data);
}

function sendToIRS(ticketId, fileName) {
    let options = {
        hostname: 'www.irs-new.certusview.com',
        port: 80,
        path: '/add/image',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    let data = {"subsidiary": "UTQ", "ticket_id": ticketId, "filename": fileName};
}

function sendToMRS(ticketId, fileName) {
    let options = {
        hostname: 'www.mrs-new.certusview.com',
        port: 80,
        path: '/add/manifest',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    let data = {"subsidiary": "UTQ", "ticket_id": ticketId, "filename": fileName};

}

function sendToPAR(ticketId, fileName) {
    let options = {
        hostname: 'www.par-new.certusview.com',
        port: 80,
        path: '/notify/newManifestToBeScored',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    let data = {"ticket_id": ticketId, "filename": fileName};
}

function sendToCVOR(ticketId, fileName) {
    let options = {
        hostname: 'www.cvor-new.certusview.com',
        port: 80,
        path: '/notify/newManifestToBeCalculated',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    let data = { "ticket_id": ticketId, "filename": fileName};
}

function process(ticketId, fileName) {
    sendToIRS(ticketId, fileName);
    sendToMRS(ticketId, fileName);
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

function getItem(srcKey, spot) {
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



