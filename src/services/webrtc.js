const { Server } = require('socket.io');

class WebRTCService {
  constructor() {
    this.io = null;
    this.activeStreams = new Map(); // streamId -> { viewers: Set, streamer: socketId }
  }

  initialize(server) {
    // CORS configuration for both local development and production deployment
    const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:3000', 
      'http://localhost:3001', 
      'http://localhost:3002',
      'http://localhost:5000'
    ];

    // Add Vercel domains for production
    if (process.env.NODE_ENV === 'production') {
      allowedOrigins.push(
        'https://vendor-t6gl.vercel.app',
        'https://truulu.vercel.app'
      );
    }

    this.io = new Server(server, {
      cors: {
        origin: function (origin, callback) {
          // Allow requests with no origin (mobile apps, Postman, etc.)
          if (!origin) return callback(null, true);
          
          // Always allow localhost in development
          if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
            return callback(null, true);
          }
          
          // Check if origin is in allowed list
          if (allowedOrigins.includes(origin)) {
            return callback(null, true);
          }
          
          // For Vercel preview deployments, allow any *.vercel.app domain
          if (process.env.NODE_ENV === 'production' && origin.includes('.vercel.app')) {
            return callback(null, true);
          }
          
          // For production, be more restrictive
          if (process.env.NODE_ENV === 'production') {
            console.log(`WebRTC CORS blocked origin: ${origin}`);
            return callback(new Error('Not allowed by CORS'));
          }
          
          // In development, allow most origins for easier testing
          return callback(null, true);
        },
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`🔌 WebRTC client connected: ${socket.id}`);

      // Handle streamer starting a stream
      socket.on('start-stream', (data) => {
        const { streamId, streamKey } = data;
        console.log(`🎥 Streamer starting stream: ${streamId}`);
        
        this.activeStreams.set(streamId, {
          streamer: socket.id,
          viewers: new Set(),
          streamKey: streamKey,
          createdAt: new Date()
        });

        socket.join(streamId);
        socket.emit('stream-started', { streamId, success: true });
      });

      // Handle viewer joining a stream
      socket.on('join-stream', (data) => {
        const { streamId } = data;
        const stream = this.activeStreams.get(streamId);
        
        if (!stream) {
          socket.emit('stream-not-found', { streamId });
          return;
        }

        console.log(`👁️ Viewer joining stream: ${streamId}`);
        stream.viewers.add(socket.id);
        socket.join(streamId);
        
        // Notify streamer about new viewer
        socket.to(stream.streamer).emit('viewer-joined', { 
          viewerId: socket.id,
          viewerCount: stream.viewers.size 
        });

        socket.emit('stream-joined', { 
          streamId, 
          streamerId: stream.streamer,
          viewerCount: stream.viewers.size 
        });
      });

      // Handle WebRTC signaling (offer, answer, ICE candidates)
      socket.on('webrtc-offer', (data) => {
        const { streamId, offer, targetId } = data;
        socket.to(targetId).emit('webrtc-offer', {
          offer,
          fromId: socket.id,
          streamId
        });
      });

      socket.on('webrtc-answer', (data) => {
        const { streamId, answer, targetId } = data;
        socket.to(targetId).emit('webrtc-answer', {
          answer,
          fromId: socket.id,
          streamId
        });
      });

      socket.on('webrtc-ice-candidate', (data) => {
        const { streamId, candidate, targetId } = data;
        socket.to(targetId).emit('webrtc-ice-candidate', {
          candidate,
          fromId: socket.id,
          streamId
        });
      });

      // Handle viewer leaving
      socket.on('leave-stream', (data) => {
        const { streamId } = data;
        const stream = this.activeStreams.get(streamId);
        
        if (stream) {
          stream.viewers.delete(socket.id);
          
          // Notify streamer about viewer leaving
          socket.to(stream.streamer).emit('viewer-left', { 
            viewerId: socket.id,
            viewerCount: stream.viewers.size 
          });

          if (stream.viewers.size === 0 && stream.streamer === socket.id) {
            // Streamer left, remove stream
            this.activeStreams.delete(streamId);
            console.log(`🎥 Stream ended: ${streamId}`);
          }
        }
        
        socket.leave(streamId);
      });

      // Handle streamer ending stream
      socket.on('end-stream', (data) => {
        const { streamId } = data;
        const stream = this.activeStreams.get(streamId);
        
        if (stream) {
          // Notify all viewers that stream ended
          this.io.to(streamId).emit('stream-ended', { streamId });
          this.activeStreams.delete(streamId);
          console.log(`🎥 Stream ended by streamer: ${streamId}`);
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`🔌 WebRTC client disconnected: ${socket.id}`);
        
        // Remove from all streams
        for (const [streamId, stream] of this.activeStreams.entries()) {
          if (stream.streamer === socket.id) {
            // Streamer disconnected
            this.io.to(streamId).emit('stream-ended', { streamId });
            this.activeStreams.delete(streamId);
            console.log(`🎥 Stream ended due to disconnect: ${streamId}`);
          } else {
            // Viewer disconnected
            stream.viewers.delete(socket.id);
            socket.to(stream.streamer).emit('viewer-left', { 
              viewerId: socket.id,
              viewerCount: stream.viewers.size 
            });
          }
        }
      });
    });

    console.log('🎥 WebRTC signaling server initialized');
  }

  getActiveStreams() {
    const streams = [];
    for (const [streamId, stream] of this.activeStreams.entries()) {
      streams.push({
        streamId,
        viewerCount: stream.viewers.size,
        streamKey: stream.streamKey,
        createdAt: stream.createdAt
      });
    }
    return streams;
  }

  getStreamInfo(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return null;
    
    return {
      streamId,
      viewerCount: stream.viewers.size,
      streamKey: stream.streamKey,
      createdAt: stream.createdAt
    };
  }
}

module.exports = new WebRTCService();
