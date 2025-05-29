// DOM elements
const localVideo = document.getElementById("localVideo")
const remoteVideo = document.getElementById("remoteVideo")
const startButton = document.getElementById("startButton")
const endButton = document.getElementById("endButton")
const statusDiv = document.getElementById("status")
const statusSidebar = document.getElementById("status-sidebar")
const peerList = document.getElementById("peerList")

// WebRTC variables
let localStream
let peerConnection
let socket
let clientId
let remoteClientId
const peers = new Map()

// Make these available to the UI enhancement script
window.clientId = clientId
window.peers = peers

// Track connection state
let isConnectedToSignalingServer = false
let peerRefreshInterval
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_DELAY = 2000 // 2 seconds

// Configuration for backend server
const BACKEND_PORT = 8080 // Backend server port
const FRONTEND_PORT = 3000 // Frontend development port (if using a dev server)

// ICE configuration with STUN and TURN servers
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    // Free TURN servers (limited capacity, for testing only)
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
}

// Enhanced logging function
function log(message, level = "info") {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] ${message}`

  switch (level) {
    case "error":
      console.error(logMessage)
      break
    case "warn":
      console.warn(logMessage)
      break
    default:
      console.log(logMessage)
  }
}

// Connect to signaling server
function connectToSignalingServer() {
  // Clear any existing connection
  if (socket) {
    socket.close()
  }

  // Determine the WebSocket URL - always connect to backend port 8080
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = `${protocol}//${window.location.hostname}:${BACKEND_PORT}/ws`

  log(`Connecting to signaling server at: ${wsUrl}`)
  log(`Current location: ${window.location.href}`)
  log(`Frontend port: ${window.location.port}`)
  log(`Backend port: ${BACKEND_PORT}`)

  updateStatus(`Connecting to ${wsUrl}...`, "connecting")

  try {
    socket = new WebSocket(wsUrl)

    // Add connection timeout
    const connectionTimeout = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) {
        log("❌ Connection timeout - closing socket", "error")
        socket.close()
      }
    }, 10000) // 10 second timeout

    socket.onopen = () => {
      clearTimeout(connectionTimeout)
      log("✅ WebSocket connection established")
      isConnectedToSignalingServer = true
      reconnectAttempts = 0 // Reset reconnect attempts on successful connection
      updateStatus("Connected to signaling server", "connected")
      startButton.disabled = false

      // Send a ping to keep connection alive
      const keepAlive = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }))
        } else {
          clearInterval(keepAlive)
        }
      }, 25000) // Send ping every 25 seconds

      // Set up periodic peer list refresh
      if (peerRefreshInterval) {
        clearInterval(peerRefreshInterval)
      }

      peerRefreshInterval = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          log("Requesting peer list refresh")
          socket.send(
            JSON.stringify({
              type: "request-peers",
            }),
          )
        }
      }, 10000) // Refresh every 10 seconds

      // Request peer list immediately
      setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          log("Initial peer list request")
          socket.send(
            JSON.stringify({
              type: "request-peers",
            }),
          )
        }
      }, 1000)
    }

    socket.onerror = (error) => {
      clearTimeout(connectionTimeout)
      log(`❌ WebSocket error: ${error}`, "error")
      isConnectedToSignalingServer = false
      updateStatus(`Connection error: ${error.message || "Unknown error"}`, "disconnected")

      // Add more detailed error information to the console
      log(
        `WebSocket error details: url=${wsUrl}, readyState=${socket ? socket.readyState : "No socket"}, protocol=${window.location.protocol}, host=${window.location.host}, backendPort=${BACKEND_PORT}`,
        "error",
      )
    }

    socket.onclose = (event) => {
      clearTimeout(connectionTimeout)
      log(`❌ WebSocket connection closed: ${event.code} ${event.reason}`)

      // Provide more specific close code meanings
      let closeReason = event.reason || "Connection closed"
      switch (event.code) {
        case 1000:
          closeReason = "Normal closure"
          break
        case 1001:
          closeReason = "Going away"
          break
        case 1002:
          closeReason = "Protocol error"
          break
        case 1003:
          closeReason = "Unsupported data"
          break
        case 1005:
          closeReason = "No status received"
          break
        case 1006:
          closeReason = "Abnormal closure"
          break
        case 1011:
          closeReason = "Server error"
          break
        default:
          closeReason = `Unknown (${event.code})`
      }

      isConnectedToSignalingServer = false
      updateStatus(`Disconnected: ${closeReason} (Code: ${event.code})`, "disconnected")
      startButton.disabled = true
      endCall()

      // Clear peer refresh interval
      if (peerRefreshInterval) {
        clearInterval(peerRefreshInterval)
        peerRefreshInterval = null
      }

      // Try to reconnect after a delay, with exponential backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && event.code !== 1000) {
        const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts)
        reconnectAttempts++
        log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
        updateStatus(
          `Reconnecting in ${Math.round(delay / 1000)}s (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`,
          "connecting",
        )
        setTimeout(connectToSignalingServer, delay)
      } else if (event.code === 1000) {
        updateStatus("Connection closed normally", "disconnected")
      } else {
        updateStatus("Failed to connect after multiple attempts. Please refresh the page.", "disconnected")
      }
    }

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        log(`📨 Received message: ${JSON.stringify(data)}`)

        switch (data.type) {
          case "id":
            clientId = data.id
            window.clientId = clientId
            log(`🆔 My ID: ${clientId}`)
            break

          case "peers":
            log(`👥 Received peer list: ${JSON.stringify(data.peers)}`)
            updatePeerList(data.peers)
            break

          case "offer":
            remoteClientId = data.from
            await handleOffer(data)
            break

          case "answer":
            await handleAnswer(data)
            break

          case "candidate":
            await handleCandidate(data)
            break

          case "hangup":
            handleHangup()
            break

          case "new-peer":
            log(`👋 New peer joined: ${data.peerId}`)
            addPeer(data.peerId)
            break

          case "peer-disconnected":
            log(`👋 Peer disconnected: ${data.peerId}`)
            removePeer(data.peerId)
            if (remoteClientId === data.peerId) {
              handleHangup()
            }
            break

          case "ping":
            // Respond to server ping
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "pong" }))
            }
            break
        }
      } catch (error) {
        log(`❌ Error handling message: ${error}`, "error")
      }
    }
  } catch (error) {
    log(`❌ Error creating WebSocket: ${error}`, "error")
    updateStatus(`Failed to create WebSocket: ${error.message}`, "disconnected")

    // Try to reconnect after a delay
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts)
      reconnectAttempts++
      setTimeout(connectToSignalingServer, delay)
    }
  }
}

// Update UI status
function updateStatus(message, status) {
  log(`Status update: ${message} (${status})`)

  // Update header status
  const statusText = document.getElementById("status-text")
  if (statusText) {
    statusText.textContent = message
  }
  if (statusDiv) {
    statusDiv.className = statusDiv.className.replace(/connected|disconnected|connecting/g, "") + " status " + status
  }

  // Update sidebar status
  const statusTextSidebar = document.getElementById("status-text-sidebar")
  if (statusTextSidebar) {
    statusTextSidebar.textContent = message
  }
  if (statusSidebar) {
    statusSidebar.className =
      statusSidebar.className.replace(/connected|disconnected|connecting/g, "") + " status " + status
  }

  // Add diagnostic info to the page
  const diagnosticInfo = document.getElementById("diagnostic-info")
  if (!diagnosticInfo) {
    const infoDiv = document.createElement("div")
    infoDiv.id = "diagnostic-info"
    infoDiv.style.position = "fixed"
    infoDiv.style.bottom = "10px"
    infoDiv.style.right = "10px"
    infoDiv.style.background = "rgba(0,0,0,0.8)"
    infoDiv.style.color = "white"
    infoDiv.style.padding = "15px"
    infoDiv.style.borderRadius = "8px"
    infoDiv.style.fontSize = "11px"
    infoDiv.style.maxWidth = "350px"
    infoDiv.style.zIndex = "1000"
    infoDiv.style.fontFamily = "monospace"
    infoDiv.style.lineHeight = "1.4"
    document.body.appendChild(infoDiv)
  }

  const diagDiv = document.getElementById("diagnostic-info")
  if (diagDiv) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const wsUrl = `${protocol}//${window.location.hostname}:${BACKEND_PORT}/ws`

    diagDiv.innerHTML = `
      <div style="margin-bottom: 10px; font-weight: bold; color: #4CAF50;">🔍 Connection Diagnostics</div>
      <strong>Status:</strong> <span style="color: ${status === "connected" ? "#4CAF50" : status === "connecting" ? "#FF9800" : "#F44336"}">${status}</span><br>
      <strong>Message:</strong> ${message}<br>
      <strong>Frontend URL:</strong> ${window.location.href}<br>
      <strong>Backend URL:</strong> http://${window.location.hostname}:${BACKEND_PORT}<br>
      <strong>WebSocket URL:</strong> ${wsUrl}<br>
      <strong>Client ID:</strong> ${clientId || "Not assigned"}<br>
      <strong>Peers:</strong> ${peers.size}<br>
      <strong>Reconnect Attempts:</strong> ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}<br>
      <strong>Socket State:</strong> ${socket ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][socket.readyState] : "No socket"}<br>
      <div style="margin-top: 10px;">
        <button onclick="window.connectToSignalingServer()" style="margin-right: 5px; padding: 5px 10px; background: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer;">Reconnect</button>
        <button onclick="window.refreshPeerList()" style="margin-right: 5px; padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">Refresh Peers</button>
        <button onclick="window.testConnection()" style="padding: 5px 10px; background: #FF9800; color: white; border: none; border-radius: 3px; cursor: pointer;">Test Connection</button>
      </div>
    `
  }
}

// Test connection function
function testConnection() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = `${protocol}//${window.location.hostname}:${BACKEND_PORT}/ws`

  log("🧪 Testing connection...")

  // Test if we can reach the HTTP server first
  const httpUrl = `http://${window.location.hostname}:${BACKEND_PORT}/`

  fetch(httpUrl)
    .then((response) => {
      log(`✅ HTTP server reachable: ${response.status} ${response.statusText}`)
      return response.text()
    })
    .then((html) => {
      log(`✅ HTTP response received (${html.length} bytes)`)

      // Now test WebSocket
      const testSocket = new WebSocket(wsUrl)

      const testTimeout = setTimeout(() => {
        log("❌ Test WebSocket connection timeout", "error")
        testSocket.close()
      }, 5000)

      testSocket.onopen = () => {
        clearTimeout(testTimeout)
        log("✅ Test WebSocket connection successful")
        testSocket.close()
      }

      testSocket.onerror = (error) => {
        clearTimeout(testTimeout)
        log(`❌ Test WebSocket connection failed: ${error}`, "error")
      }

      testSocket.onclose = (event) => {
        clearTimeout(testTimeout)
        log(`Test WebSocket closed: ${event.code} ${event.reason}`)
      }
    })
    .catch((error) => {
      log(`❌ HTTP server not reachable: ${error}`, "error")
      log(`❌ This suggests the backend server is not running or not accessible from this device`, "error")
    })
}

// Make test function available globally
window.testConnection = testConnection

// Update peer list
function updatePeerList(peerIds) {
  log(`👥 Updating peer list with: ${JSON.stringify(peerIds)}`)

  // Keep track of current peers to detect removed ones
  const currentPeers = new Set(peers.keys())

  // Add new peers
  peerIds.forEach((peerId) => {
    if (peerId !== clientId) {
      addPeer(peerId)
      currentPeers.delete(peerId) // Remove from tracking set as it's still present
    }
  })

  // Remove peers that are no longer in the list
  currentPeers.forEach((peerId) => {
    removePeer(peerId)
  })

  // Update empty state
  const noPeersElement = document.getElementById("no-peers")
  if (
    peerList &&
    (peerList.children.length === 0 || (peerList.children.length === 1 && peerList.children[0].id === "no-peers"))
  ) {
    if (!noPeersElement) {
      const emptyState = document.createElement("div")
      emptyState.id = "no-peers"
      emptyState.className = "empty-state"
      emptyState.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
        <p>No peers available</p>
        <p class="text-sm">Waiting for others to join...</p>
      `
      if (peerList) {
        peerList.appendChild(emptyState)
      }
    }
  } else if (noPeersElement) {
    noPeersElement.remove()
  }
}

function addPeer(peerId) {
  if (peerId === clientId) return // Don't add ourselves

  log(`👤 Adding peer to list: ${peerId}`)

  if (!peers.has(peerId)) {
    // Create new peer element
    const shortId = peerId.substring(peerId.length - 4)
    const initial = shortId.charAt(0).toUpperCase()

    const li = document.createElement("li")
    li.className = "peer-item"
    li.dataset.peerId = peerId

    li.innerHTML = `
      <div class="peer-avatar">${initial}</div>
      <div class="peer-info">
        <div class="peer-name">Peer ${shortId}</div>
        <div class="peer-status">Available</div>
      </div>
      <svg class="call-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"></path>
      </svg>
    `

    li.onclick = () => {
      startCallWithPeer(peerId)

      // Update UI to show calling state
      const peerStatus = li.querySelector(".peer-status")
      peerStatus.textContent = "Calling..."
      li.style.backgroundColor = "rgba(79, 70, 229, 0.1)"
      li.style.borderColor = "rgba(79, 70, 229, 0.3)"
    }

    // Remove the no-peers element if it exists
    const noPeersElement = document.getElementById("no-peers")
    if (noPeersElement) {
      noPeersElement.remove()
    }

    if (peerList) {
      peerList.appendChild(li)
    }
    peers.set(peerId, li)
  }
}

function removePeer(peerId) {
  log(`👤 Removing peer from list: ${peerId}`)

  if (peers.has(peerId)) {
    const li = peers.get(peerId)
    li.remove()
    peers.delete(peerId)

    // Check if we need to show the empty state
    if (peers.size === 0) {
      const noPeersElement = document.getElementById("no-peers")
      if (!noPeersElement) {
        updatePeerList([]) // This will add the empty state
      }
    }
  }
}

// Start call with specific peer
async function startCallWithPeer(peerId) {
  remoteClientId = peerId
  await startCall()
}

// Start call
async function startCall() {
  try {
    if (peerConnection) {
      log("⚠️ Call already started", "warn")
      return
    }

    // Get local media stream
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })
    localVideo.srcObject = localStream

    // Hide local placeholder
    const localPlaceholder = document.getElementById("local-placeholder")
    if (localPlaceholder) {
      localPlaceholder.style.display = "none"
    }

    // Create peer connection
    createPeerConnection()

    // Add local stream to connection
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream)
    })

    // Only create offer if we initiated the call
    if (remoteClientId) {
      // Create and send offer
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      socket.send(
        JSON.stringify({
          type: "offer",
          from: clientId,
          to: remoteClientId,
          offer: peerConnection.localDescription,
        }),
      )

      updateStatus(`Calling peer ${remoteClientId.substring(remoteClientId.length - 4)}...`, "connecting")
    } else {
      updateStatus("Waiting for incoming call...", "connected")
    }

    startButton.disabled = true
    endButton.disabled = false
  } catch (error) {
    log(`❌ Error starting call: ${error}`, "error")
    updateStatus("Error starting call: " + error.message, "disconnected")

    // Show helpful error message for common issues
    if (error.name === "NotAllowedError") {
      alert("Camera/microphone access denied. Please allow permissions and try again.")
    } else if (error.name === "NotFoundError") {
      alert("No camera or microphone found. Please check your devices and try again.")
    } else if (error.name === "NotReadableError") {
      alert("Camera/microphone is already in use by another application.")
    }

    endCall()
  }
}

// Create RTCPeerConnection with all event handlers
function createPeerConnection() {
  log("🔗 Creating peer connection")
  peerConnection = new RTCPeerConnection(configuration)

  // ICE candidate handler
  peerConnection.onicecandidate = ({ candidate }) => {
    log(`🧊 ICE candidate generated: ${candidate ? "Yes" : "No (gathering complete)"}`)
    if (candidate && remoteClientId) {
      log(`📤 Sending ICE candidate to ${remoteClientId}`)
      socket.send(
        JSON.stringify({
          type: "candidate",
          from: clientId,
          to: remoteClientId,
          candidate,
        }),
      )
    } else if (!candidate) {
      log("🧊 ICE candidate gathering complete")
    }
  }

  // ICE gathering state change handler
  peerConnection.onicegatheringstatechange = () => {
    log(`🧊 ICE gathering state: ${peerConnection.iceGatheringState}`)
  }

  // ICE connection state change handler
  peerConnection.oniceconnectionstatechange = () => {
    log(`🧊 ICE connection state: ${peerConnection.iceConnectionState}`)

    if (
      peerConnection.iceConnectionState === "failed" ||
      peerConnection.iceConnectionState === "disconnected" ||
      peerConnection.iceConnectionState === "closed"
    ) {
      updateStatus(`ICE connection ${peerConnection.iceConnectionState}`, "disconnected")
      if (peerConnection.iceConnectionState === "failed") {
        log("❌ ICE connection failed - likely a NAT traversal issue", "error")
        alert(
          "Call connection failed. This might be due to network restrictions. Make sure both devices are on the same network, or try using a different network.",
        )
      }
      if (peerConnection.iceConnectionState !== "closed") {
        endCall()
      }
    } else if (peerConnection.iceConnectionState === "connected" || peerConnection.iceConnectionState === "completed") {
      updateStatus("Call connected", "connected")
    }
  }

  // Remote stream handler
  peerConnection.ontrack = (event) => {
    log(`📹 Received remote track: ${event.streams ? event.streams.length : 0} streams`)
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0]
      updateStatus("Remote video connected", "connected")

      // Hide remote placeholder
      const remotePlaceholder = document.getElementById("remote-placeholder")
      if (remotePlaceholder) {
        remotePlaceholder.style.display = "none"
      }
    }
  }

  // Connection state handler
  peerConnection.onconnectionstatechange = () => {
    log(`🔗 Connection state: ${peerConnection.connectionState}`)

    if (
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "failed" ||
      peerConnection.connectionState === "closed"
    ) {
      endCall()
    }
  }

  // Signaling state handler
  peerConnection.onsignalingstatechange = () => {
    log(`📡 Signaling state: ${peerConnection.signalingState}`)
  }

  // Negotiation needed handler
  peerConnection.onnegotiationneeded = async () => {
    log("🤝 Negotiation needed event fired")
    if (remoteClientId) {
      try {
        log("📤 Creating offer due to negotiation needed event")
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        log(`📤 Sending offer to ${remoteClientId}`)
        socket.send(
          JSON.stringify({
            type: "offer",
            from: clientId,
            to: remoteClientId,
            offer: peerConnection.localDescription,
          }),
        )
      } catch (error) {
        log(`❌ Error during negotiation: ${error}`, "error")
      }
    }
  }
}

// Handle incoming offer
async function handleOffer(data) {
  try {
    if (peerConnection) {
      // If we already have a connection, close it and create a new one
      peerConnection.close()
    }

    // Create new peer connection
    createPeerConnection()

    // Get local media if not already available
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      localVideo.srcObject = localStream

      // Hide local placeholder
      const localPlaceholder = document.getElementById("local-placeholder")
      if (localPlaceholder) {
        localPlaceholder.style.display = "none"
      }

      // Add local stream to connection
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream)
      })
    }

    // Set remote description (the offer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))

    // Create and set local description (the answer)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)

    // Send answer back to caller
    socket.send(
      JSON.stringify({
        type: "answer",
        from: clientId,
        to: data.from,
        answer: peerConnection.localDescription,
      }),
    )

    startButton.disabled = true
    endButton.disabled = false
    updateStatus(`Answering call from ${data.from.substring(data.from.length - 4)}`, "connecting")

    // Update peer item status if it exists
    const peerItem = document.querySelector(`[data-peer-id="${data.from}"]`)
    if (peerItem) {
      const peerStatus = peerItem.querySelector(".peer-status")
      if (peerStatus) {
        peerStatus.textContent = "Connected"
        peerItem.style.backgroundColor = "rgba(16, 185, 129, 0.1)"
        peerItem.style.borderColor = "rgba(16, 185, 129, 0.3)"
      }
    }
  } catch (error) {
    log(`❌ Error handling offer: ${error}`, "error")
    updateStatus("Error handling offer: " + error.message, "disconnected")
    endCall()
  }
}

// Handle incoming answer
async function handleAnswer(data) {
  try {
    if (!peerConnection) {
      log("❌ No peer connection when receiving answer", "error")
      return
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer))
    updateStatus("Call established", "connected")

    // Update peer item status if it exists
    const peerItem = document.querySelector(`[data-peer-id="${data.from}"]`)
    if (peerItem) {
      const peerStatus = peerItem.querySelector(".peer-status")
      if (peerStatus) {
        peerStatus.textContent = "Connected"
        peerItem.style.backgroundColor = "rgba(16, 185, 129, 0.1)"
        peerItem.style.borderColor = "rgba(16, 185, 129, 0.3)"
      }
    }
  } catch (error) {
    log(`❌ Error handling answer: ${error}`, "error")
    updateStatus("Error handling answer: " + error.message, "disconnected")
    endCall()
  }
}

// Handle ICE candidate
async function handleCandidate(data) {
  try {
    if (peerConnection && data.candidate) {
      log(`📥 Adding ICE candidate from ${data.from}`)
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
    }
  } catch (error) {
    log(`❌ Error adding ICE candidate: ${error}`, "error")
  }
}

// Handle hangup
function handleHangup() {
  updateStatus("Call ended", "disconnected")
  endCall()
}

// End call
function endCall() {
  if (peerConnection) {
    // Notify the other peer if we're the ones ending the call
    if (remoteClientId && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "hangup",
          from: clientId,
          to: remoteClientId,
        }),
      )

      // Reset peer item status if it exists
      const peerItem = document.querySelector(`[data-peer-id="${remoteClientId}"]`)
      if (peerItem) {
        const peerStatus = peerItem.querySelector(".peer-status")
        if (peerStatus) {
          peerStatus.textContent = "Available"
          peerItem.style.backgroundColor = ""
          peerItem.style.borderColor = ""
        }
      }
    }

    peerConnection.close()
    peerConnection = null
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
    localVideo.srcObject = null
    localStream = null
  }

  remoteVideo.srcObject = null
  remoteClientId = null
  startButton.disabled = !isConnectedToSignalingServer
  endButton.disabled = true

  // Show placeholders when videos are stopped
  const localPlaceholder = document.getElementById("local-placeholder")
  const remotePlaceholder = document.getElementById("remote-placeholder")

  if (localPlaceholder) localPlaceholder.style.display = "block"
  if (remotePlaceholder) remotePlaceholder.style.display = "block"

  updateStatus(
    isConnectedToSignalingServer ? "Ready to call" : "Disconnected",
    isConnectedToSignalingServer ? "connected" : "disconnected",
  )
}

// Request a peer list refresh
function refreshPeerList() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    log("🔄 Manually refreshing peer list")
    socket.send(
      JSON.stringify({
        type: "request-peers",
      }),
    )
  }
}

// Make functions available globally
window.connectToSignalingServer = connectToSignalingServer
window.refreshPeerList = refreshPeerList

// Initialize
window.addEventListener("load", () => {
  log("🚀 Page loaded, connecting to signaling server...")
  log(`Frontend port: ${window.location.port || "default"}`)
  log(`Backend port: ${BACKEND_PORT}`)
  connectToSignalingServer()

  if (startButton) startButton.onclick = startCall
  if (endButton) endButton.onclick = endCall

  // Add refresh button functionality if it exists
  const refreshButton = document.getElementById("refresh-peers-button")
  if (refreshButton) {
    refreshButton.onclick = refreshPeerList
  }
})

// Handle page unload
window.addEventListener("beforeunload", () => {
  endCall()
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close()
  }

  if (peerRefreshInterval) {
    clearInterval(peerRefreshInterval)
  }
})
