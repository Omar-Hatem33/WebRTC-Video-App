const WebSocket = require("ws")
const http = require("http")
const https = require("https")
const fs = require("fs")
const path = require("path")
const os = require("os")

const CERT_PATH = path.join(__dirname, "certs", "cert.pem")
const KEY_PATH = path.join(__dirname, "certs", "key.pem")
const HTTPS_PORT = Number(process.env.PORT || 8080)
const HTTP_REDIRECT_PORT = Number(process.env.HTTP_PORT || 80)

function ensureCertificateFiles() {
  if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
    console.error("❌ Missing self-signed certificate files in Server/certs/")
    console.error(`   Expected: ${CERT_PATH}`)
    console.error(`   Expected: ${KEY_PATH}`)
    console.error("   Generate them with:")
    console.error("   openssl req -x509 -newkey rsa:2048 -nodes -keyout Server/certs/key.pem -out Server/certs/cert.pem -days 365 -subj \"/CN=localhost\"")
    process.exit(1)
  }
}

ensureCertificateFiles()

const httpsOptions = {
  key: fs.readFileSync(KEY_PATH),
  cert: fs.readFileSync(CERT_PATH),
}

// Get network interfaces to display available IP addresses
function getNetworkInterfaces() {
  const networkInterfacesList = os.networkInterfaces()
  const addresses = []

  for (const name of Object.keys(networkInterfacesList)) {
    for (const networkInterface of networkInterfacesList[name]) {
      // Skip internal and non-IPv4 addresses
      if (networkInterface.family === "IPv4" && !networkInterface.internal) {
        addresses.push({
          name: name,
          address: networkInterface.address,
        })
      }
    }
  }

  return addresses
}

// MIME types for static file serving
const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".woff": "application/font-woff",
  ".ttf": "application/font-ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "application/font-otf",
  ".wasm": "application/wasm",
}

// Create a simple test page if index.html doesn't exist
function createTestPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebRTC Connection Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .status { padding: 10px; margin: 10px 0; border-radius: 4px; }
        .connected { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .disconnected { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .connecting { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
        button { padding: 10px 20px; margin: 5px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
        button:disabled { background: #6c757d; cursor: not-allowed; }
        #log { background: #f8f9fa; border: 1px solid #dee2e6; padding: 10px; height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; }
        .peer-list { border: 1px solid #dee2e6; padding: 10px; margin: 10px 0; min-height: 100px; }
        .peer-item { padding: 8px; margin: 4px 0; background: #e9ecef; border-radius: 4px; cursor: pointer; }
        .peer-item:hover { background: #dee2e6; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 WebRTC Signaling Server Test</h1>
        
        <div id="status" class="status disconnected">
            <strong>Status:</strong> <span id="status-text">Initializing...</span>
        </div>
        
        <div>
            <button id="connectBtn" onclick="connect()">Connect</button>
            <button id="disconnectBtn" onclick="disconnect()" disabled>Disconnect</button>
            <button onclick="clearLog()">Clear Log</button>
            <button onclick="testHttp()">Test HTTP</button>
        </div>
        
        <h3>Connected Peers</h3>
        <div id="peerList" class="peer-list">
            <div style="color: #6c757d; font-style: italic;">No peers connected</div>
        </div>
        
        <h3>Connection Log</h3>
        <div id="log"></div>
        
        <h3>Connection Details</h3>
        <div style="font-family: monospace; font-size: 12px; background: #f8f9fa; padding: 10px; border-radius: 4px;">
            <strong>Current URL:</strong> <span id="currentUrl"></span><br>
            <strong>WebSocket URL:</strong> <span id="wsUrl"></span><br>
            <strong>Client ID:</strong> <span id="clientId">Not assigned</span><br>
            <strong>Socket State:</strong> <span id="socketState">Not connected</span>
        </div>
    </div>

    <script>
        let socket = null;
        let clientId = null;
        const peers = new Map();
        
        // Update connection details
        document.getElementById('currentUrl').textContent = window.location.href;
        const wsUrl = \`ws://\${window.location.host}/ws\`;
        document.getElementById('wsUrl').textContent = wsUrl;
        
        function log(message) {
            const timestamp = new Date().toISOString();
            const logDiv = document.getElementById('log');
            logDiv.innerHTML += \`[\${timestamp}] \${message}<br>\`;
            logDiv.scrollTop = logDiv.scrollHeight;
            console.log(\`[\${timestamp}] \${message}\`);
        }
        
        function updateStatus(message, status) {
            const statusDiv = document.getElementById('status');
            const statusText = document.getElementById('status-text');
            statusText.textContent = message;
            statusDiv.className = 'status ' + status;
            log(\`Status: \${message} (\${status})\`);
        }
        
        function updateSocketState() {
            const stateSpan = document.getElementById('socketState');
            if (socket) {
                const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
                stateSpan.textContent = states[socket.readyState] || 'UNKNOWN';
            } else {
                stateSpan.textContent = 'Not connected';
            }
        }
        
        function connect() {
            if (socket && socket.readyState === WebSocket.OPEN) {
                log('Already connected');
                return;
            }
            
            log('Attempting to connect to: ' + wsUrl);
            updateStatus('Connecting...', 'connecting');
            
            try {
                socket = new WebSocket(wsUrl);
                updateSocketState();
                
                // Add connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (socket.readyState === WebSocket.CONNECTING) {
                        log('❌ Connection timeout - closing socket');
                        socket.close();
                    }
                }, 10000);
                
                socket.onopen = function() {
                    clearTimeout(connectionTimeout);
                    log('✅ WebSocket connection established');
                    updateStatus('Connected to signaling server', 'connected');
                    document.getElementById('connectBtn').disabled = true;
                    document.getElementById('disconnectBtn').disabled = false;
                    updateSocketState();
                    
                    // Send keep-alive ping every 25 seconds
                    const keepAlive = setInterval(() => {
                        if (socket && socket.readyState === WebSocket.OPEN) {
                            socket.send(JSON.stringify({ type: 'ping' }));
                        } else {
                            clearInterval(keepAlive);
                        }
                    }, 25000);
                };
                
                socket.onmessage = function(event) {
                    try {
                        const data = JSON.parse(event.data);
                        log(\`📨 Received: \${JSON.stringify(data)}\`);
                        
                        switch(data.type) {
                            case 'id':
                                clientId = data.id;
                                document.getElementById('clientId').textContent = clientId;
                                log(\`🆔 Assigned ID: \${clientId}\`);
                                break;
                            case 'peers':
                                updatePeerList(data.peers);
                                break;
                            case 'new-peer':
                                log(\`👋 New peer joined: \${data.peerId}\`);
                                addPeer(data.peerId);
                                break;
                            case 'peer-disconnected':
                                log(\`👋 Peer disconnected: \${data.peerId}\`);
                                removePeer(data.peerId);
                                break;
                            case 'ping':
                                // Respond to server ping
                                socket.send(JSON.stringify({ type: 'pong' }));
                                break;
                        }
                    } catch (error) {
                        log(\`❌ Error parsing message: \${error}\`);
                    }
                };
                
                socket.onerror = function(error) {
                    clearTimeout(connectionTimeout);
                    log(\`❌ WebSocket error: \${error}\`);
                    updateStatus('Connection error', 'disconnected');
                    updateSocketState();
                };
                
                socket.onclose = function(event) {
                    clearTimeout(connectionTimeout);
                    let closeReason = event.reason || 'Connection closed';
                    switch (event.code) {
                        case 1000: closeReason = 'Normal closure'; break;
                        case 1001: closeReason = 'Going away'; break;
                        case 1002: closeReason = 'Protocol error'; break;
                        case 1003: closeReason = 'Unsupported data'; break;
                        case 1005: closeReason = 'No status received'; break;
                        case 1006: closeReason = 'Abnormal closure'; break;
                        case 1011: closeReason = 'Server error'; break;
                        default: closeReason = \`Unknown (\${event.code})\`;
                    }
                    
                    log(\`❌ WebSocket closed: \${event.code} \${closeReason}\`);
                    updateStatus(\`Disconnected: \${closeReason}\`, 'disconnected');
                    document.getElementById('connectBtn').disabled = false;
                    document.getElementById('disconnectBtn').disabled = true;
                    updateSocketState();
                };
                
            } catch (error) {
                log(\`❌ Error creating WebSocket: \${error}\`);
                updateStatus('Failed to create connection', 'disconnected');
            }
        }
        
        function disconnect() {
            if (socket) {
                socket.close();
                socket = null;
            }
        }
        
        function clearLog() {
            document.getElementById('log').innerHTML = '';
        }
        
        function testHttp() {
            log('🧪 Testing HTTP connection...');
            fetch(window.location.href)
                .then(response => {
                    log(\`✅ HTTP test successful: \${response.status} \${response.statusText}\`);
                    return response.text();
                })
                .then(html => {
                    log(\`✅ HTTP response received (\${html.length} bytes)\`);
                })
                .catch(error => {
                    log(\`❌ HTTP test failed: \${error}\`);
                });
        }
        
        function updatePeerList(peerIds) {
            log(\`👥 Updating peer list: \${JSON.stringify(peerIds)}\`);
            const peerListDiv = document.getElementById('peerList');
            
            // Clear existing peers
            peers.clear();
            peerListDiv.innerHTML = '';
            
            if (peerIds.length === 0 || (peerIds.length === 1 && peerIds[0] === clientId)) {
                peerListDiv.innerHTML = '<div style="color: #6c757d; font-style: italic;">No other peers connected</div>';
            } else {
                peerIds.forEach(peerId => {
                    if (peerId !== clientId) {
                        addPeer(peerId);
                    }
                });
            }
        }
        
        function addPeer(peerId) {
            if (peerId === clientId || peers.has(peerId)) return;
            
            const peerListDiv = document.getElementById('peerList');
            const peerDiv = document.createElement('div');
            peerDiv.className = 'peer-item';
            peerDiv.textContent = \`Peer: \${peerId.substring(peerId.length - 8)}\`;
            peerDiv.onclick = () => log(\`Clicked on peer: \${peerId}\`);
            
            // Remove "no peers" message if it exists
            if (peerListDiv.children.length === 1 && peerListDiv.children[0].style.fontStyle === 'italic') {
                peerListDiv.innerHTML = '';
            }
            
            peerListDiv.appendChild(peerDiv);
            peers.set(peerId, peerDiv);
        }
        
        function removePeer(peerId) {
            if (peers.has(peerId)) {
                const peerDiv = peers.get(peerId);
                peerDiv.remove();
                peers.delete(peerId);
                
                // Show "no peers" message if list is empty
                const peerListDiv = document.getElementById('peerList');
                if (peerListDiv.children.length === 0) {
                    peerListDiv.innerHTML = '<div style="color: #6c757d; font-style: italic;">No other peers connected</div>';
                }
            }
        }
        
        // Auto-connect on page load
        window.addEventListener('load', function() {
            log('🚀 Page loaded, auto-connecting...');
            setTimeout(connect, 1000);
        });
        
        // Update socket state periodically
        setInterval(updateSocketState, 1000);
    </script>
</body>
</html>
  `
}

// Create HTTPS server with static file serving
const httpsServer = https.createServer(httpsOptions, (req, res) => {
  const clientIp = req.socket.remoteAddress
  const userAgent = req.headers["user-agent"] || "Unknown"
  const timestamp = new Date().toISOString()

  console.log(`[${timestamp}] HTTPS "${req.method} ${req.url}" from ${clientIp}`)
  console.log(`[${timestamp}] User-Agent: ${userAgent}`)

  // Add CORS headers for cross-origin requests
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") {
    console.log(`[${timestamp}] Responding to OPTIONS request`)
    res.writeHead(200)
    res.end()
    return
  }

  let filePath = req.url
  if (filePath === "/") {
    filePath = "/index.html"
  }

  // Strip query strings before resolving files
  const safeUrl = filePath.split("?")[0]
  const fullPath = path.join(__dirname, "../Client", safeUrl)
  console.log(`[${timestamp}] Attempting to serve file: ${fullPath}`)

  // Check if file exists first
  fs.access(fullPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.log(`[${timestamp}] File does not exist: ${fullPath}`)

      // If index.html doesn't exist, serve the test page
      if (safeUrl === "/index.html") {
        console.log(`[${timestamp}] Serving built-in test page`)
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(createTestPage(), "utf-8")
        return
      }

      // For other files, return 404
      res.writeHead(404, { "Content-Type": "text/html" })
      res.end(
        `
        <html>
          <head><title>404 Not Found</title></head>
          <body>
            <h1>404 - File Not Found</h1>
            <p>The requested file was not found: ${safeUrl}</p>
            <p>Server path: ${fullPath}</p>
            <p>Server directory: ${__dirname}</p>
            <p>Client directory: ${path.join(__dirname, "../Client")}</p>
            <p><a href="/">Go to Home</a></p>
          </body>
        </html>
      `,
        "utf-8",
      )
      return
    }

    // Get the file extension
    const extname = String(path.extname(fullPath)).toLowerCase()
    const mimeType = mimeTypes[extname] || "application/octet-stream"

    // Read and serve the file
    fs.readFile(fullPath, (error, content) => {
      if (error) {
        console.error(`[${timestamp}] Error reading file: ${error}`)
        res.writeHead(500)
        res.end(`Server Error: ${error.code}`)
      } else {
        console.log(`[${timestamp}] Successfully served: ${safeUrl} (${content.length} bytes, ${mimeType})`)
        res.writeHead(200, { "Content-Type": mimeType })
        res.end(content, "utf-8")
      }
    })
  })
})

// Redirect HTTP requests to HTTPS to ensure secure media access
const redirectServer = http.createServer((req, res) => {
  const host = req.headers.host || `localhost:${HTTPS_PORT}`
  const redirectHost = host.replace(/:\d+$/, "")
  const targetUrl = `https://${redirectHost}:${HTTPS_PORT}${req.url}`

  console.log(`[${new Date().toISOString()}] Redirecting HTTP request to ${targetUrl}`)
  res.writeHead(301, { Location: targetUrl })
  res.end()
})

// Create WebSocket server attached to HTTPS server
const wss = new WebSocket.Server({
  server: httpsServer,
  path: "/ws",
})

// Store connected peers
const clients = new Map()

console.log("WebSocket server created on path /ws")

// Heartbeat to detect disconnected clients
function heartbeat() {
  this.isAlive = true
}

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress
  const url = req.url
  const timestamp = new Date().toISOString()

  console.log(`[${timestamp}] ✅ NEW WEBSOCKET CONNECTION from ${ip}, URL: ${url}`)
  console.log(`[${timestamp}] WebSocket headers:`, JSON.stringify(req.headers, null, 2))

  // Setup heartbeat
  ws.isAlive = true
  ws.on("pong", heartbeat)

  // Generate a unique ID for this client
  const clientId = Date.now().toString() + Math.floor(Math.random() * 1000)
  clients.set(clientId, ws)

  console.log(`[${timestamp}] Client assigned ID: ${clientId}. Total clients: ${clients.size}`)

  // Send the ID back to the client
  const idMessage = JSON.stringify({
    type: "id",
    id: clientId,
  })
  console.log(`[${timestamp}] Sending ID to client: ${idMessage}`)
  ws.send(idMessage)

  // Wait a short time before sending peer list to ensure client is ready
  setTimeout(() => {
    // Send list of current peers to new client
    const peerList = Array.from(clients.keys())
    console.log(`[${timestamp}] Sending initial peer list to ${clientId}:`, peerList)

    const peerMessage = JSON.stringify({
      type: "peers",
      peers: peerList,
    })
    ws.send(peerMessage)

    // Notify other clients about the new peer
    broadcast(
      {
        type: "new-peer",
        peerId: clientId,
      },
      clientId,
    )
  }, 500)

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString())
      console.log(`[${timestamp}] Received message type: ${data.type} from ${data.from || clientId}`)

      // Handle ping/pong for keep-alive
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }))
        return
      }

      if (data.type === "pong") {
        // Client responded to our ping
        return
      }

      // Handle request-peers separately to avoid duplicate processing
      if (data.type === "request-peers") {
        const peerList = Array.from(clients.keys())
        console.log(`[${timestamp}] Peer list requested by ${clientId}:`, peerList)
        ws.send(
          JSON.stringify({
            type: "peers",
            peers: peerList,
          }),
        )
        return
      }

      // Add from field if not present
      if (!data.from) {
        data.from = clientId
      }

      if (data.to) {
        // Send to specific client if specified
        console.log(`[${timestamp}] Forwarding ${data.type} message from ${data.from} to ${data.to}`)
        sendToClient(data.to, data)
      } else {
        // Broadcast to all other clients
        console.log(`[${timestamp}] Broadcasting ${data.type} message from ${data.from}`)
        broadcast(data, clientId)
      }
    } catch (error) {
      console.error(`[${timestamp}] Error processing message:`, error)
    }
  })

  ws.on("close", (code, reason) => {
    const timestamp = new Date().toISOString()
    console.log(
      `[${timestamp}] ❌ Client ${clientId} disconnected with code ${code}, reason: ${reason}. Remaining clients: ${clients.size - 1}`,
    )
    clients.delete(clientId)

    // Notify other clients about the disconnected peer
    broadcast({
      type: "peer-disconnected",
      peerId: clientId,
    })

    console.log(`[${timestamp}] Updated client count: ${clients.size}`)
  })

  ws.on("error", (error) => {
    const timestamp = new Date().toISOString()
    console.error(`[${timestamp}] WebSocket error for client ${clientId}:`, error)
  })
})

// Heartbeat interval to detect disconnected clients
const interval = setInterval(function ping() {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] Heartbeat check: ${wss.clients.size} WebSocket clients, ${clients.size} tracked clients`)

  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
      // Find the clientId for this WebSocket
      let disconnectedClientId = null
      clients.forEach((client, id) => {
        if (client === ws) {
          disconnectedClientId = id
        }
      })

      if (disconnectedClientId) {
        console.log(`[${timestamp}] Client ${disconnectedClientId} timed out`)
        clients.delete(disconnectedClientId)
        broadcast({
          type: "peer-disconnected",
          peerId: disconnectedClientId,
        })
      }

      return ws.terminate()
    }

    ws.isAlive = false
    ws.ping(() => {})
  })
}, 30000)

wss.on("close", function close() {
  clearInterval(interval)
})

function broadcast(message, excludeClientId = null) {
  const messageString = typeof message === "string" ? message : JSON.stringify(message)

  clients.forEach((client, id) => {
    if (id !== excludeClientId && client.readyState === WebSocket.OPEN) {
      client.send(messageString)
    }
  })
}

function sendToClient(clientId, message) {
  const client = clients.get(clientId)
  if (client && client.readyState === WebSocket.OPEN) {
    const messageString = typeof message === "string" ? message : JSON.stringify(message)
    client.send(messageString)
  } else {
    console.warn(`Cannot send to client ${clientId}: not found or not connected`)
  }
}

// Define clientDir
const clientDir = path.join(__dirname, "../Client")

// Start the secure and redirect servers
httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
  console.log(`\n🚀 WebRTC Signaling Server Started!`)
  console.log(`📡 Secure app running on https://localhost:${HTTPS_PORT}`)
  console.log(`🔗 Server bound to: 0.0.0.0:${HTTPS_PORT} (all interfaces)`)

  console.log(`\n📱 Access the application from any device on your network:`)

  // Display localhost
  console.log(`   • Local: https://localhost:${HTTPS_PORT}`)

  // Display network interfaces
  const networkInterfaces = getNetworkInterfaces()
  if (networkInterfaces.length > 0) {
    networkInterfaces.forEach((iface) => {
      console.log(`   • Network (${iface.name}): https://${iface.address}:${HTTPS_PORT}`)
    })
  } else {
    console.log(`   • Network: No external network interfaces found`)
    console.log(`   • This might indicate a network configuration issue`)
  }

  console.log(`\n💡 To connect from other devices:`)
  console.log(`   1. Make sure all devices are on the same network`)
  console.log(`   2. Open the secure URL above and accept the self-signed certificate warning`)
  console.log(`   3. Grant camera and microphone access when prompted`)

  console.log(`\n🔧 Technical Details:`)
  console.log(`   • Server files served from: ${clientDir}`)
  console.log(`   • WebSocket endpoint: wss://[server-ip]:${HTTPS_PORT}/ws`)
  console.log(`   • Certificate files: ${CERT_PATH} and ${KEY_PATH}`)
  console.log(`   • HTTP redirect enabled on port ${HTTP_REDIRECT_PORT}`)
  console.log(`   • CORS enabled for all origins`)

  console.log(`\n✅ Ready for connections!`)
  console.log("=".repeat(60) + "\n")
})

redirectServer.listen(HTTP_REDIRECT_PORT, "0.0.0.0", () => {
  console.log(`➡️  HTTP redirect server listening on http://localhost:${HTTP_REDIRECT_PORT}`)
})

// Enhanced error handling
httpsServer.on("error", (error) => {
  console.error(`❌ HTTPS server error:`, error)
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${HTTPS_PORT} is already in use. Please:`)
    console.error(`   1. Stop any other servers running on port ${HTTPS_PORT}`)
    console.error(`   2. Or set a different PORT environment variable`)
    console.error(`   3. Or kill the process using: lsof -ti:${HTTPS_PORT} | xargs kill`)
  }
})

redirectServer.on("error", (error) => {
  console.error(`❌ HTTP redirect server error:`, error)
})

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...")
  clearInterval(interval)
  wss.close(() => {
    httpsServer.close(() => {
      redirectServer.close(() => {
        console.log("✅ Server closed gracefully")
        process.exit(0)
      })
    })
  })
})

// Log all network activity
httpsServer.on("connection", (socket) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] 🔌 New TCP connection from ${socket.remoteAddress}:${socket.remotePort}`)

  socket.on("close", () => {
    console.log(`[${timestamp}] 🔌 TCP connection closed from ${socket.remoteAddress}:${socket.remotePort}`)
  })

  socket.on("error", (error) => {
    console.log(
      `[${timestamp}] 🔌 TCP connection error from ${socket.remoteAddress}:${socket.remotePort}:`,
      error.message,
    )
  })
})
