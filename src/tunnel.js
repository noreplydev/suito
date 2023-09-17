const net = require('net')
const http = require('http')
const { nanoid } = require('nanoid')
const { createSession, secondsToMs, getSessionData } = require('alive-sessions')
const { storeSession, getSessionID, removeSession } = require('./lib/sessions')
const { getLogTime, toTitleCase } = require('./lib/utils')

// http server for consumption
http.createServer((req, res) => {
  let body = '';
  let headers = '';

  req.on('data', function (chunk) {
    body += chunk;
  });

  req.on('end', function () {
    // _ to ignore the empty string at the start
    const [_, requestEndpoint, ...hostRequestEndpoint] = req.url.split('/')

    if (!requestEndpoint && !hostRequestEndpoint.length) {
      res.writeHead(200);
      res.end(`
        <h1>Tunnel</h1>
        <code>https://github.com/noreplydev/tunnel.git</code>
      `);
      return
    }

    // get the sessionID based on the request endoint
    const sessionID = getSessionID(requestEndpoint)

    try {
      // if something wrong with the sessionID an error will be thrown
      // by the lib
      getSessionData(sessionID)
    } catch (e) {
      console.log(getLogTime() + '[TUNNEL] ERROR: Unhandled route ' + requestEndpoint)
      res.writeHead(404);
      res.end("<h1>404 Not Found</h1>");
      return
    }

    headers += req.method + ' /' + hostRequestEndpoint.join('/') + ' HTTP/' + req.httpVersion + '\n'

    for (prop in req.headers) {
      headers += toTitleCase(prop) + ': ' + req.headers[prop] + '\n'
    }

    // append the requestID on the first line
    const requestID = nanoid().toString()
    let request = requestID + '\n'

    // append the headers
    request += headers

    // append the body if exists
    if (body.length > 0) {
      request += '\n' + body
    }

    // get the session data
    const sessionData = getSessionData(sessionID)

    // send the request to the client
    sessionData.socket.write(request)

    // wait for the response
    const interval = setInterval(() => {
      const messageList = getSessionData(sessionID).messageList

      if (messageList[requestID]) {
        const hostResponse = messageList[requestID]

        // send the response to the client
        res.writeHead(hostResponse.statusCode, {
          ...hostResponse.headers,
        });

        // write the body
        res.write(messageList[requestID].body)
        res.end();

        // remove the request from the message list
        delete messageList[requestID]

        clearInterval(interval)
        return
      }
    }, 100)

    // we can close the interval after 10 seconds using set timeout
  })

  req.on('err', function (err) {
    console.error(err);
  })

}).listen(3000, () => {
  console.log(getLogTime() + '[HTTP] Listening on port 3000')
})

// tunneling service
const tunnelingServer = net.createServer((socket) => {
  let sessionVars = addSession(socket)

  console.log(getLogTime() + '[TUNNEL] NEW: ' + sessionVars.sessionId + ' → ' + sessionVars.sessionEndpoint)

  socket.on('data', (data) => {
    console.log(getLogTime() + '[TUNNEL] DATA: ', sessionVars.sessionId)
    console.log('\n', data.toString(), '\n')

    const sessionData = getSessionData(sessionVars.sessionId)

    // get first line which the requestID
    const requestID = data.toString().split('\n')[0]

    try {
      sessionData.messageList[requestID] = JSON.parse(data.toString().split('\n')[1])
    } catch (e) {
      console.log('the agent responded with bad format')
    }
  })

  socket.on('end', () => {
    try {
      removeSession(sessionVars.sessionEndpoint)
      console.log(getLogTime() + '[TUNNEL] CLOSED: ' + sessionVars.sessionId)
    } catch (err) {
      console.log(getLogTime() + '[TUNNEL] CLOSED-WITH-ERROR: ' + sessionVars.sessionId)
    }
  })

})

tunnelingServer.listen(8080, () => {
  console.log(getLogTime() + '[TUNNEL] Listening on port 8080')
})

function addSession(socket) {
  // create a session for each client
  const sessionId = nanoid().toString()
  const sessionEndpoint = nanoid().toString()

  // create a session and close after timeout
  createSession({
    sessionID: sessionId,
    expireMs: secondsToMs(60),
    data: {
      socket: socket,
      messageList: {},
    },
    action: () => {
      socket.end()
      // remove the session from the sessions file
    }
  })

  // update the sessions file 
  storeSession(sessionId, sessionEndpoint)

  return { sessionEndpoint, sessionId }
}