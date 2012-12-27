// Copyright 2012 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

var WebSocket = require('faye-websocket');
var http      = require('http');
var fs        = require('fs');

var server = http.createServer();

fs.readFile('mirror.html', function(err, mirrorHTML) {
  fs.readFile('mirror.js', function(err, mirrorJS) {
    fs.readFile('tree_mirror.js', function(err, treeMirrorJS) {

      server.addListener('request', function(request, response) {
        if (request.url == '/mirror.html' || request.url == '/' || request.url == '/index.html') {
          response.writeHead(200, {'Content-Type': 'text/html'});
          response.end(mirrorHTML);
          return;
        }

        if (request.url == '/mirror.js') {
          response.writeHead(200, {'Content-Type': 'text/javascript'});
          response.end(mirrorJS);
          return;
        }

        if (request.url == '/tree_mirror.js') {
          response.writeHead(200, {'Content-Type': 'text/javascript'});
          response.end(treeMirrorJS);
          return;
        }

        console.error('unknown resource: ' + request.url);
      });
    });
  });
});

var messages = [];
var receivers = [];
var projector;

server.addListener('upgrade', function(request, rawsocket, head) {
  var socket = new WebSocket(request, rawsocket, head);

  // Projector.
  if (request.url == '/projector') {
    console.log('projector connection initiating.');

    if (projector) {
      console.log('closing existing projector. setting messages to 0');
      projector.close();
      messages.length = 0;
    }

    projector = socket;

    messages.push(JSON.stringify({ clear: true }));

    receivers.forEach(function(socket) {
      socket.send(messages[0]);
    });


    socket.onmessage = function(event) {
      console.log('message received. now at ' + messages.length + ' . sending to ' + receivers.length);
      receivers.forEach(function(receiver) {
        receiver.send(event.data);
      });

      messages.push(event.data);
    };

    socket.onclose = function() {
      console.log('projector closing, clearing messages');
      messages.length = 0;
      receivers.forEach(function(socket) {
        socket.send(JSON.stringify({ clear: true }));
      });

      projector = undefined;
    }

    console.log('projector open completed.')
    return;
  }

  // Receivers.
  if (request.url == '/receiver') {
    receivers.push(socket);

    console.log('receiver opened. now at ' + receivers.length + ' sending ' + messages.length + ' messages');
    socket.send(JSON.stringify(messages));


    socket.onclose = function() {
      var index = receivers.indexOf(socket);
      receivers.splice(index, 1);
      console.log('receiver closed. now at ' + receivers.length);
    }
  }
});

server.listen(8080);