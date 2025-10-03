const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

class WebRTCStreamingService {
  constructor() {
    this.io = null;
    this.activeStreams = new Map(); // streamId -> { viewers: Set, streamer: socketId, streamData }
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
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

      // Handle streamer starting a WebRTC stream
      socket.on('start-webrtc-stream', async (data) => {
        const { streamId, streamKey, title, description } = data;
        console.log(`🎥 Starting WebRTC stream: ${streamId}`);
        
        try {
          // Update database to mark stream as live
          const { error } = await this.supabase
            .from('livestreams')
            .update({
              status: 'live',
              started_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('stream_key', streamKey);

          if (error) {
            console.error('Database update error:', error);
            socket.emit('stream-start-error', { message: 'Failed to update stream status' });
            return;
          }

          // Store stream info
          this.activeStreams.set(streamId, {
            streamer: socket.id,
            viewers: new Set(),
            streamKey: streamKey,
            title: title,
            description: description,
            createdAt: new Date(),
            viewerCount: 0
          });

          socket.join(streamId);
          socket.emit('webrtc-stream-started', { 
            streamId, 
            success: true,
            message: 'WebRTC stream started successfully'
          });

          console.log(`✅ WebRTC stream started: ${streamId}`);
        } catch (error) {
          console.error('Error starting WebRTC stream:', error);
          socket.emit('stream-start-error', { message: 'Failed to start stream' });
        }
      });

      // Handle viewer joining a WebRTC stream
      socket.on('join-webrtc-stream', (data) => {
        const { streamId } = data;
        const stream = this.activeStreams.get(streamId);
        
        if (!stream) {
          socket.emit('stream-not-found', { streamId });
          return;
        }

        console.log(`👁️ Viewer joining WebRTC stream: ${streamId}`);
        stream.viewers.add(socket.id);
        stream.viewerCount = stream.viewers.size;
        socket.join(streamId);
        
        // Notify streamer about new viewer
        socket.to(stream.streamer).emit('viewer-joined', { 
          viewerId: socket.id,
          viewerCount: stream.viewerCount
        });

        socket.emit('webrtc-stream-joined', { 
          streamId, 
          streamerId: stream.streamer,
          viewerCount: stream.viewerCount,
          title: stream.title,
          description: stream.description
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
      socket.on('leave-webrtc-stream', (data) => {
        const { streamId } = data;
        const stream = this.activeStreams.get(streamId);
        
        if (stream) {
          stream.viewers.delete(socket.id);
          stream.viewerCount = stream.viewers.size;
          
          // Notify streamer about viewer leaving
          socket.to(stream.streamer).emit('viewer-left', { 
            viewerId: socket.id,
            viewerCount: stream.viewerCount
          });
        }
        
        socket.leave(streamId);
      });

      // Handle streamer ending WebRTC stream
      socket.on('end-webrtc-stream', async (data) => {
        const { streamId, streamKey } = data;
        const stream = this.activeStreams.get(streamId);
        
        if (stream) {
          try {
            // Update database to mark stream as ended
            const { error } = await this.supabase
              .from('livestreams')
              .update({
                status: 'ended',
                ended_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('stream_key', streamKey);

            if (error) {
              console.error('Database update error:', error);
            }

            // Notify all viewers that stream ended
            this.io.to(streamId).emit('webrtc-stream-ended', { streamId });
            this.activeStreams.delete(streamId);
            console.log(`🎥 WebRTC stream ended: ${streamId}`);
          } catch (error) {
            console.error('Error ending WebRTC stream:', error);
          }
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`🔌 WebRTC client disconnected: ${socket.id}`);
        
        // Remove from all streams
        for (const [streamId, stream] of this.activeStreams.entries()) {
          if (stream.streamer === socket.id) {
            // Streamer disconnected - end stream
            this.io.to(streamId).emit('webrtc-stream-ended', { streamId });
            this.activeStreams.delete(streamId);
            console.log(`🎥 WebRTC stream ended due to disconnect: ${streamId}`);
          } else {
            // Viewer disconnected
            stream.viewers.delete(socket.id);
            stream.viewerCount = stream.viewers.size;
            socket.to(stream.streamer).emit('viewer-left', { 
              viewerId: socket.id,
              viewerCount: stream.viewerCount
            });
          }
        }
      });
    });

    console.log('🎥 WebRTC streaming service initialized');
  }

  // Get all active WebRTC streams
  getActiveStreams() {
    const streams = [];
    for (const [streamId, stream] of this.activeStreams.entries()) {
      streams.push({
        id: streamId,
        streamKey: stream.streamKey,
        title: stream.title,
        description: stream.description,
        viewerCount: stream.viewerCount,
        createdAt: stream.createdAt,
        status: 'live'
      });
    }
    return streams;
  }

  // Get specific stream info
  getStreamInfo(streamId) {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return null;
    
    return {
      id: streamId,
      streamKey: stream.streamKey,
      title: stream.title,
      description: stream.description,
      viewerCount: stream.viewerCount,
      createdAt: stream.createdAt,
      status: 'live'
    };
  }
}

module.exports = new WebRTCStreamingService();
