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
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Call the API gateway login endpoint
    const response = await axios.post(
      `${GATEWAY_URL}/api/auth/login`,
      {
        email,
        password,
      },
      {
        withCredentials: true, // Important for cookies (refresh token)
      }
    );

    const { access_token, refresh_token } = response.data;

    // DEBUG: Log Set-Cookie headers from Gateway
    const setCookieHeaders = response.headers['set-cookie'];
    console.log('[LOGIN ROUTE] Set-Cookie headers from Gateway:', setCookieHeaders);

    // Create response with token
    const nextResponse = NextResponse.json({
      success: true,
      token: access_token,
    });

    // Forward Set-Cookie headers from Gateway (for refresh token)
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

          // Set the refresh token cookie
          nextResponse.cookies.set('refreshToken', value, {
            httpOnly,
            secure: isHttps ? secure : false,
            sameSite: isHttps ? sameSite : 'lax',
            maxAge,
            path,
          });

          didSetRefreshToken = true;

          console.log('[LOGIN ROUTE] Forwarded refreshToken cookie to browser');
        }
      });
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

    // Set access token in cookie (not httpOnly so JS can access it for Authorization header)
    nextResponse.cookies.set('token', access_token, {
      httpOnly: false, // We need JS access for Authorization header
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60, // 15 minutes (matching access token expiry)
    });

    return nextResponse;
  } catch (error: any) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || 'Login failed';

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
