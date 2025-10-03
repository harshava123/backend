const express = require('express');
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');
const { authenticateToken, requireRole } = require('../middleware/auth');
const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Get all active WebRTC streams (for Bazar Story)
router.get('/', async (req, res) => {
  try {
    const webrtcService = require('../services/webrtc-streaming');
    const activeStreams = webrtcService.getActiveStreams();

    // Get additional stream data from database
    const streamKeys = activeStreams.map(stream => stream.streamKey);
    
    if (streamKeys.length === 0) {
      return res.json({
        success: true,
        message: 'No active WebRTC streams',
        data: []
      });
    }

    const { data: dbStreams, error } = await supabase
      .from('livestreams')
      .select(`
        *,
        vendor_profiles(
          business_name,
          profile_image,
          city,
          state
        )
      `)
      .in('stream_key', streamKeys)
      .eq('status', 'live');

    if (error) {
      throw error;
    }

    // Merge WebRTC data with database data
    const mergedStreams = activeStreams.map(stream => {
      const dbStream = dbStreams.find(s => s.stream_key === stream.streamKey);
      return {
        ...stream,
        ...dbStream,
        current_viewers: stream.viewerCount,
        is_webrtc: true
      };
    });

    res.json({
      success: true,
      message: 'Active WebRTC streams retrieved successfully',
      data: mergedStreams
    });

  } catch (error) {
    console.error('Get WebRTC streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve WebRTC streams'
    });
  }
});

// Create a new WebRTC stream (Vendor Admin)
router.post('/create', 
  authenticateToken,
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').optional().isString()
  ],
  async (req, res) => {
    try {
      // Check if user is a vendor
      if (req.user.role !== 'vendor') {
        return res.status(403).json({
          success: false,
          message: 'Only vendors can create WebRTC streams'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { title, description, product_id } = req.body;
      const userId = req.user.id;

      // Get vendor profile to get vendor_id
      const { data: vendorProfile, error: vendorError } = await supabase
        .from('vendor_profiles')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (vendorError || !vendorProfile) {
        return res.status(404).json({
          success: false,
          message: 'Vendor profile not found. Please complete your vendor registration.'
        });
      }

      // Generate unique stream key
      const streamKey = `webrtc_${vendorProfile.id}_${Date.now()}`;
      const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create stream record in database
      const streamData = {
        vendor_id: vendorProfile.id,
        title: title,
        description: description,
        stream_key: streamKey,
        status: 'scheduled',
        rtmp_url: null, // No RTMP for WebRTC
        hls_url: null,  // No HLS for WebRTC
        dash_url: null, // No DASH for WebRTC
        created_at: new Date().toISOString()
      };

      // Add product_id if provided (only if column exists)
      if (product_id) {
        streamData.product_id = product_id;
      }

      const { data: newStream, error: insertError } = await supabase
        .from('livestreams')
        .insert(streamData)
        .select()
        .single();

      if (insertError) {
        // Check if error is due to missing product_id column
        if (insertError.message && insertError.message.includes('product_id')) {
          console.log('⚠️ product_id column not found, creating stream without product association');
          
          // Remove product_id and try again
          delete streamData.product_id;
          const { data: retryStream, error: retryError } = await supabase
            .from('livestreams')
            .insert(streamData)
            .select()
            .single();
            
          if (retryError) {
            throw retryError;
          }
          
          return res.json({
            success: true,
            message: 'WebRTC stream created successfully (product_id column not available)',
            data: retryStream
          });
        }
        
        throw insertError;
      }

      console.log(`🎥 WebRTC stream created: ${streamKey}`);

      res.json({
        success: true,
        message: 'WebRTC stream created successfully',
        data: {
          ...newStream,
          streamId: streamId,
          is_webrtc: true
        }
      });

    } catch (error) {
      console.error('Create WebRTC stream error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create WebRTC stream'
      });
    }
  }
);

// Get vendor's WebRTC streams (Vendor Admin)
router.get('/vendor/my-streams', authenticateToken, async (req, res) => {
  try {
    // Check if user is a vendor
    if (req.user.role !== 'vendor') {
      return res.status(403).json({
        success: false,
        message: 'Only vendors can view their WebRTC streams'
      });
    }

    const userId = req.user.id;
    const { product_id } = req.query; // Get product_id from query parameters
    
    // Get vendor profile to get vendor_id
    const { data: vendorProfile, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendorProfile) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    // Build query with optional product_id filter
    let query = supabase
      .from('livestreams')
      .select('*')
      .eq('vendor_id', vendorProfile.id)
      .order('created_at', { ascending: false });

    // Filter by product_id if provided
    if (product_id) {
      // Try to filter by product_id, but handle case where column doesn't exist
      query = query.eq('product_id', product_id);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Add WebRTC status to streams
    const webrtcService = require('../services/webrtc-streaming');
    const activeStreams = webrtcService.getActiveStreams();

    const streamsWithWebRTCStatus = data.map(stream => {
      const activeStream = activeStreams.find(s => s.streamKey === stream.stream_key);
      return {
        ...stream,
        is_webrtc: true,
        current_viewers: activeStream ? activeStream.viewerCount : 0,
        is_active_webrtc: !!activeStream
      };
    });

    res.json({
      success: true,
      message: 'Vendor WebRTC streams retrieved successfully',
      data: streamsWithWebRTCStatus
    });

  } catch (error) {
    console.error('Get vendor WebRTC streams error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve vendor WebRTC streams'
    });
  }
});

// Start WebRTC stream
router.post('/:streamKey/start', authenticateToken, async (req, res) => {
  try {
    const { streamKey } = req.params;
    const userId = req.user.id;

    // Get vendor profile
    const { data: vendorProfile, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendorProfile) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    // Check if stream belongs to this vendor
    const { data: stream, error: streamError } = await supabase
      .from('livestreams')
      .select('*')
      .eq('stream_key', streamKey)
      .eq('vendor_id', vendorProfile.id)
      .single();

    if (streamError || !stream) {
      return res.status(404).json({
        success: false,
        message: 'WebRTC stream not found or does not belong to you'
      });
    }

    // Update stream status to live
    const { data: updatedStream, error: updateError } = await supabase
      .from('livestreams')
      .update({
        status: 'live',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('stream_key', streamKey)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`🎥 WebRTC stream started: ${streamKey}`);

    res.json({
      success: true,
      message: 'WebRTC stream started successfully',
      data: updatedStream
    });

  } catch (error) {
    console.error('Start WebRTC stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start WebRTC stream'
    });
  }
});

// End WebRTC stream
router.post('/:streamKey/end', authenticateToken, async (req, res) => {
  try {
    const { streamKey } = req.params;
    const userId = req.user.id;

    // Get vendor profile
    const { data: vendorProfile, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendorProfile) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    // Check if stream belongs to this vendor
    const { data: stream, error: streamError } = await supabase
      .from('livestreams')
      .select('*')
      .eq('stream_key', streamKey)
      .eq('vendor_id', vendorProfile.id)
      .single();

    if (streamError || !stream) {
      return res.status(404).json({
        success: false,
        message: 'WebRTC stream not found or does not belong to you'
      });
    }

    // Update stream status to ended
    const { data: updatedStream, error: updateError } = await supabase
      .from('livestreams')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('stream_key', streamKey)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`🎥 WebRTC stream ended: ${streamKey}`);

    res.json({
      success: true,
      message: 'WebRTC stream ended successfully',
      data: updatedStream
    });

  } catch (error) {
    console.error('End WebRTC stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end WebRTC stream'
    });
  }
});

// Delete WebRTC stream
router.delete('/:streamId', authenticateToken, requireRole('vendor'), async (req, res) => {
  try {
    const { streamId } = req.params;
    const userId = req.user.id;

    // Get vendor profile
    const { data: vendorProfile, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (vendorError || !vendorProfile) {
      return res.status(404).json({
        success: false,
        message: 'Vendor profile not found'
      });
    }

    // Check if stream exists and belongs to vendor
    const { data: stream, error: streamError } = await supabase
      .from('livestreams')
      .select('id, title, vendor_id')
      .eq('id', streamId)
      .eq('vendor_id', vendorProfile.id)
      .single();

    if (streamError || !stream) {
      return res.status(404).json({
        success: false,
        message: 'Stream not found or does not belong to vendor'
      });
    }

    // Check if stream is currently active
    if (stream.status === 'live') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an active stream. Please end the stream first.'
      });
    }

    // Delete the stream
    const { error: deleteError } = await supabase
      .from('livestreams')
      .delete()
      .eq('id', streamId)
      .eq('vendor_id', vendorProfile.id);

    if (deleteError) {
      console.error('Delete stream error:', deleteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete stream'
      });
    }

    res.json({
      success: true,
      message: `Stream "${stream.title}" deleted successfully`
    });

  } catch (error) {
    console.error('Delete stream error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete stream'
    });
  }
});

module.exports = router;
