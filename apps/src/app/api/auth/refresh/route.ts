import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

function isHttpsRequest(request: NextRequest): boolean {
  const protoHeader = request.headers.get('x-forwarded-proto');
  if (protoHeader) return protoHeader.includes('https');
  return request.nextUrl.protocol === 'https:';
}

export async function POST(request: NextRequest) {
  try {
    // Get refresh token from cookie (set by browser)
    const refreshToken = request.cookies.get('refreshToken')?.value;

    if (!refreshToken) {
      console.log('[REFRESH ROUTE] No refreshToken cookie found');
      return NextResponse.json(
        { error: 'Refresh token required' },
        { status: 400 }
      );
    }

    console.log('[REFRESH ROUTE] Attempting refresh with token:', refreshToken.substring(0, 20) + '...');

    // Call the API gateway refresh endpoint
    const response = await axios.post(
      `${GATEWAY_URL}/api/auth/refresh`,
      {},
      {
        withCredentials: true, // Important for cookies
        headers: {
          Cookie: `refreshToken=${refreshToken}`, // Forward cookie manually
        },
      }
    );

    // Handle both possible response formats
    const access_token = response.data?.access_token || response.data?.token;
    const refresh_token = response.data?.refresh_token;
    
    if (!access_token) {
      console.error('[REFRESH ROUTE] No access_token in response:', response.data);
      return NextResponse.json(
        { error: 'Invalid refresh response' },
        { status: 500 }
      );
    }

    // DEBUG: Log Set-Cookie headers from Gateway
    const setCookieHeaders = response.headers['set-cookie'];
    console.log('[REFRESH ROUTE] Set-Cookie headers from Gateway:', setCookieHeaders);
    console.log('[REFRESH ROUTE] Response status:', response.status);
    console.log('[REFRESH ROUTE] Response headers keys:', Object.keys(response.headers));

    // Create response with token (matching login route format)
    const nextResponse = NextResponse.json({
      success: true,
      token: access_token,
      access_token: access_token, // Also include for compatibility
    });

    // Forward Set-Cookie headers from Gateway (for new refresh token after rotation)
    let didSetRefreshToken = false;
    if (setCookieHeaders) {
      const isHttps = isHttpsRequest(request);
      const cookieStrings = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
      cookieStrings.forEach((cookieString: string) => {
        if (cookieString.startsWith('refreshToken=')) {
          // Parse the cookie string
          const parts = cookieString.split(';').map((p) => p.trim());
          const [nameValue] = parts;
          const eqIndex = nameValue.indexOf('=');
          const value = eqIndex >= 0 ? nameValue.slice(eqIndex + 1) : '';

          // Extract cookie attributes
          let maxAge = 7 * 24 * 60 * 60; // Default 7 days
          let httpOnly = true;
          let secure = process.env.NODE_ENV === 'production';
          let sameSite: 'strict' | 'lax' | 'none' = 'strict';
          let path = '/';

          parts.forEach((part) => {
            if (part.toLowerCase().startsWith('max-age=')) {
              maxAge = parseInt(part.split('=')[1], 10);
            } else if (part.toLowerCase() === 'httponly') {
              httpOnly = true;
            } else if (part.toLowerCase() === 'secure') {
              secure = true;
            } else if (part.toLowerCase().startsWith('samesite=')) {
              const samesiteValue = part.split('=')[1].toLowerCase();
              if (['strict', 'lax', 'none'].includes(samesiteValue)) {
                sameSite = samesiteValue as 'strict' | 'lax' | 'none';
              }
            } else if (part.toLowerCase().startsWith('path=')) {
              path = part.split('=')[1];
            }
          });

          // Set the new refresh token cookie (rotation)
          nextResponse.cookies.set('refreshToken', value, {
            httpOnly,
            secure: isHttps ? secure : false,
            sameSite: isHttps ? sameSite : 'lax',
            maxAge,
            path,
          });

          didSetRefreshToken = true;

          console.log('[REFRESH ROUTE] Forwarded new refreshToken cookie to browser (rotated)');
        }
      });
    } else {
      console.warn('[REFRESH ROUTE] No Set-Cookie headers found or not an array');
    }

    if (!didSetRefreshToken && refresh_token) {
      const isHttps = isHttpsRequest(request);
      nextResponse.cookies.set('refreshToken', refresh_token, {
        httpOnly: true,
        secure: isHttps ? process.env.NODE_ENV === 'production' : false,
        sameSite: isHttps ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      });
    }

    // Set access token in cookie (not httpOnly so JS can access it)
    nextResponse.cookies.set('token', access_token, {
      httpOnly: false, // We need JS access for Authorization header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60, // 15 minutes (matching access token expiry)
    });

    return nextResponse;
  } catch (error: any) {
    console.error('[REFRESH ROUTE] Error:', error.message);
    console.error('[REFRESH ROUTE] Error response:', error.response?.data);
    
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || 'Refresh failed';

    // Clear cookies on failure
    const nextResponse = NextResponse.json(
      { error: message },
      { status }
    );
    nextResponse.cookies.delete('refreshToken');
    nextResponse.cookies.delete('token');

    return nextResponse;
  }
}
