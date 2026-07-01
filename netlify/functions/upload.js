import { Buffer } from 'buffer';

// Supabase config from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'photos';

// Generate a short random session ID (8 characters, URL-safe)
function generateSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export const handler = async (event, context) => {
  // CORS Headers support
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, message: 'Method Not Allowed' })
    };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: 'Supabase environment variables not configured' })
    };
  }

  try {
    const { images } = JSON.parse(event.body);

    if (!images || !Array.isArray(images) || images.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, message: 'Invalid or empty images array' })
      };
    }

    const sessionId = generateSessionId();
    const photoPaths = [];
    const uploadErrors = [];

    // Upload each image to Supabase Storage
    for (let i = 0; i < images.length; i++) {
      const base64Data = images[i];
      const matches = base64Data.match(/^data:image\/(\w+);base64,/);
      if (!matches) {
        uploadErrors.push(`Image ${i}: does not match base64 URI pattern`);
        continue;
      }

      // Always save as webp extension since the app compresses to webp
      const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Content, 'base64');
      const filePath = `${sessionId}/${i + 1}.webp`;

      console.log(`Uploading to Supabase Storage: ${filePath} (${buffer.length} bytes)`);

      // Upload to Supabase Storage via REST API
      const uploadResponse = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey': SUPABASE_SERVICE_KEY,
            'Content-Type': 'image/webp',
            'x-upsert': 'true' // Overwrite if exists
          },
          body: buffer
        }
      );

      if (uploadResponse.ok) {
        photoPaths.push(filePath);
        console.log(`Upload success: ${filePath}`);
      } else {
        const errText = await uploadResponse.text().catch(() => '');
        const errMsg = `Storage upload failed for ${filePath}: ${uploadResponse.status} - ${errText}`;
        console.error(errMsg);
        uploadErrors.push(errMsg);
      }
    }

    if (photoPaths.length === 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          message: 'Failed to upload any images to Supabase Storage',
          errors: uploadErrors
        })
      };
    }

    // Save session to photo_sessions table via Supabase REST API
    console.log(`Creating session ${sessionId} with ${photoPaths.length} photos`);
    const dbResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/photo_sessions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          id: sessionId,
          photo_paths: photoPaths
        })
      }
    );

    if (!dbResponse.ok) {
      const errText = await dbResponse.text().catch(() => '');
      console.error(`Failed to create session: ${dbResponse.status} - ${errText}`);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          message: `Failed to create photo session: ${errText}`,
          errors: uploadErrors
        })
      };
    }

    console.log(`Session ${sessionId} created successfully`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        sessionId: sessionId,
        photoCount: photoPaths.length,
        errors: uploadErrors.length > 0 ? uploadErrors : undefined
      })
    };

  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, message: err.message })
    };
  }
};
