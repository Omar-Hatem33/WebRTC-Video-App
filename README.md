# WebRTC Video Calling Application

A simple peer-to-peer video calling application using WebRTC and WebSockets for signaling.

## Features

- Real-time video and audio communication
- Peer-to-peer connection using WebRTC
- Automatic discovery of peers on the same network
- Simple and intuitive user interface

## Setup and Installation

1. Clone this repository
2. Install dependencies:
   \`\`\`
   npm install
   \`\`\`
3. Start the backend server:
   \`\`\`
   node Source_Code/Server/server.js
   \`\`\`

## Port Configuration

- **Backend Server**: Port 8080 (serves static files and WebSocket signaling)
- **Frontend Development**: Port 3000 (if using a separate dev server)

## Accessing the Application

### Option 1: Direct Backend Access (Recommended)
- Start the backend server on port 8080
- Access directly via: `http://localhost:8080`
- For other devices: `http://[your-server-ip]:8080`

### Option 2: Separate Frontend Development Server
- Start backend server on port 8080
- Start frontend dev server on port 3000
- The frontend will automatically connect to the backend on port 8080

### Access from Other Devices
- Make sure all devices are on the same network
- Find your server's IP address (displayed in the console when starting the server)
- On other devices, open a browser and navigate to: `http://[your-server-ip]:8080`

## Network Requirements

- All devices must be on the same network
- Backend server must be accessible on port 8080
- For connections across different networks, you may need to configure TURN servers
- The application uses STUN servers by default for NAT traversal

## Troubleshooting

If you're having connection issues:

1. **Check Backend Server**: Ensure the backend is running on port 8080
2. **Network Access**: Verify all devices can access the backend server
3. **WebSocket Connection**: Check browser console for WebSocket connection errors
4. **Firewall**: Ensure port 8080 isn't blocked by firewalls
5. **Permissions**: Allow camera and microphone permissions when prompted

### Common Issues

**"Reconnecting" status**: 
- Backend server not running on port 8080
- Network connectivity issues
- Firewall blocking WebSocket connections

**No peers showing**: 
- WebSocket connection not established
- Multiple devices not connected to the same backend server

## Technical Details

- **Backend**: Node.js with WebSocket for signaling (Port 8080)
- **Frontend**: HTML, CSS, JavaScript
- **WebRTC**: Peer-to-peer media streaming
- **STUN/TURN**: Public servers for NAT traversal

## Development

### Backend Server
\`\`\`bash
cd Source_Code/Server
node server.js
\`\`\`

### Frontend Development (Optional)
If you want to run a separate frontend development server:
\`\`\`bash
cd Source_Code/Client
# Use your preferred static server, e.g.:
python -m http.server 3000
# or
npx serve -p 3000
\`\`\`

The frontend will automatically detect and connect to the backend on port 8080.

## License

MIT
