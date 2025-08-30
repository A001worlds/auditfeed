export const config = {
  runtime: 'edge',
};

// Simple in-memory rate limiting (resets on deploy)
const requestCounts = new Map();

export default async function handler(request) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  // Only allow POST
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  try {
    const data = await request.json();
    
    // Get IP for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();
    
    // Basic rate limiting - 5 submissions per hour per IP
    const userRequests = requestCounts.get(ip) || [];
    const recentRequests = userRequests.filter(time => now - time < 3600000);
    
    if (recentRequests.length >= 5) {
      return new Response('Too many requests. Try again later.', { 
        status: 429, 
        headers 
      });
    }
    
    // Validate all inputs
    const amount = parseInt(data.amount);
    const days = parseInt(data.days);
    
    if (!amount || amount < 1 || amount > 10000000) {
      return new Response('Invalid amount', { status: 400, headers });
    }
    
    if (!days || days < 1 || days > 10000) {
      return new Response('Invalid days', { status: 400, headers });
    }
    
    if (!data.platform || !data.type || !data.excuse) {
      return new Response('Missing required fields', { status: 400, headers });
    }
    
    if (data.excuse.length > 1000) {
      return new Response('Excuse too long', { status: 400, headers });
    }
    
    // Validate captcha answer
    if (parseInt(data.captchaAnswer) !== data.captchaExpected) {
      return new Response('Invalid captcha', { status: 400, headers });
    }
    
    // Submit to Supabase (credentials stored in Vercel env vars)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use service key for backend
    
    const response = await fetch(`${supabaseUrl}/rest/v1/royalties`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        amount: amount,
        platform: data.platform,
        excuse: data.excuse,
        type: data.type,
        days: days,
        approved: false,
        date: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error('Database error');
    }
    
    // Update rate limit tracking
    recentRequests.push(now);
    requestCounts.set(ip, recentRequests);
    
    return new Response('Success', { status: 200, headers });
    
  } catch (error) {
    console.error('Submission error:', error);
    return new Response('Error submitting entry', { status: 500, headers });
  }
}
