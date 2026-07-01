export const handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  const url = event.queryStringParameters.url;
  if (!url) {
    return {
      statusCode: 400,
      headers,
      body: 'Missing url parameter'
    };
  }

  // Only allow proxying files from Catbox for security
  if (!url.startsWith('https://files.catbox.moe/')) {
    return {
      statusCode: 403,
      headers,
      body: 'Forbidden: Only Catbox files are allowed'
    };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: `Failed to fetch resource: ${response.statusText}`
      };
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': contentType
      },
      body: base64,
      isBase64Encoded: true
    };
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers,
      body: error.message
    };
  }
};
