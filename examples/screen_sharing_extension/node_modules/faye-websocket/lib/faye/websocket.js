// API and protocol references:
// 
// * http://dev.w3.org/html5/websockets/
// * http://dvcs.w3.org/hg/domcore/raw-file/tip/Overview.html#interface-eventtarget
// * http://dvcs.w3.org/hg/domcore/raw-file/tip/Overview.html#interface-event
// * http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-75
// * http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-76
// * http://tools.ietf.org/html/draft-ietf-hybi-thewebsocketprotocol-17

var Draft75Parser = require('./websocket/draft75_parser'),
    Draft76Parser = require('./websocket/draft76_parser'),
    HybiParser    = require('./websocket/hybi_parser'),
    API           = require('./websocket/api'),
    Event         = require('./websocket/api/event');

var getParser = function(request) {
  var headers = request.headers;
  return headers['sec-websocket-version']
       ? HybiParser
       : (headers['sec-websocket-key1'] && headers['sec-websocket-key2'])
       ? Draft76Parser
       : Draft75Parser;
};

var isSecureConnection = function(request) {
  if (request.headers['x-forwarded-proto']) {
    return request.headers['x-forwarded-proto'] === 'https';
  } else {
    return (request.connection && request.connection.authorized !== undefined) ||
           (request.socket && request.socket.secure);
  }
};

var WebSocket = function(request, socket, head, supportedProtos) {
  this.request = request;
  this._stream = request.socket;
  
  this._stream.setTimeout(0);
  this._stream.setNoDelay(true);
  
  var scheme = isSecureConnection(request) ? 'wss:' : 'ws:';
  this.url = scheme + '//' + request.headers.host + request.url;
  this.readyState = API.CONNECTING;
  this.bufferedAmount = 0;
  
  var Parser = getParser(request);
  this._parser = new Parser(this, {protocols: supportedProtos});
  
  var handshake = this._parser.handshakeResponse(head);
  try { this._stream.write(handshake, 'binary') } catch (e) {}
  
  this.protocol = this._parser.protocol || '';
  this.readyState = API.OPEN;
  this.version = this._parser.getVersion();
  
  var event = new Event('open');
  event.initEvent('open', false, false);
  this.dispatchEvent(event);
  
  var self = this;
  
  this._stream.addListener('data', function(data) {
    var response = self._parser.parse(data);
    if (!response) return;
    try { self._stream.write(response, 'binary') } catch (e) {}
  });
  ['close', 'end', 'error'].forEach(function(event) {
    self._stream.addListener(event, function() { self.close(1006, '', false) });
  });
};

for (var key in API) WebSocket.prototype[key] = API[key];

WebSocket.WebSocket   = WebSocket;
WebSocket.Client      = require('./websocket/client');
WebSocket.EventSource = require('./eventsource');
module.exports        = WebSocket;

