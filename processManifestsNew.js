'use strict';
var http = require('http');

console.log('Loading function');

exports.handler = (event, context, callback) => {
    //console.log('Received event:', JSON.stringify(event, null, 2));
    event.Records.forEach((record) => {
        console.log(record);
        let nextManifest = {
            file_name: record.dynamodb.NewImage.file_name.S,
            subsidiary: record.dynamodb.NewImage.subsidiary.S,
            ticket_id: record.dynamodb.NewImage.ticket_id.S
        };
        if (record.dynamodb.NewImage.file_name.S.toLowerCase().indexOf('@cv') > 0) {
            sendTo(nextManifest, 'FieldCheck');
            sendTo(nextManifest, 'PAR');
            sendTo(nextManifest, 'CVOR');
            sendTo(nextManifest, 'Skech');
        }


    });
    callback(null, `Successfully processed ${event.Records.length} records.`);
};

function post(options, data) {
    let req = http.request(options, function (res) {
        console.log('Status: ' + res.statusCode);
        console.log('Headers: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
        res.on('data', function (body) {

            console.log('Body: ' + body);
        });
    });
    req.write(data);
}

function sendTo(data, service) {
    let options = {};
    switch (service) {
        case 'PAR':
            options = {
                hostname: 'www.par-new.certusview.com',
                port: 80,
                path: '/api/v1/postRiskScore',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            break;
        case 'CVOR':
            options = {
                hostname: 'www.cvor-new.certusview.com',
                port: 80,
                path: '/api/v1/calculate',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            break;
        case 'SketchMetrics':
            options = {
                hostname: 'www.sketchmetrics-new.certusview.com',
                port: 80,
                path: '/api/v1/addToMetrics',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            break;
        case 'FieldCheck':
            options = {
                hostname: 'www.fieldcheck-new.certusview.com',
                port: 80,
                path: '/api/v2/getTicketDetails',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            };
            break;

    }
    post(data, options);
}
