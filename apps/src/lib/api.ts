import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { v4 as uuidv4 } from 'uuid';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
const BASE_URL = `${GATEWAY_URL}/api`;

let hasRedirectedToLogin = false;

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: string | null) => void;
  reject: (error?: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Get token from cookies or localStorage
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  
  // Try cookies first
  const cookieToken = Cookies.get('token');
  if (cookieToken) return cookieToken;
  
  // Fallback to localStorage
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

// Set token in both cookies and localStorage
export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  
  // Set cookie (expires in 7 days)
  Cookies.set('token', token, { expires: 7, sameSite: 'strict' });
  
  // Also set in localStorage as backup
  try {
    localStorage.setItem('token', token);
  } catch {
    // Ignore localStorage errors
  }
}

// Remove token from both cookies and localStorage
export function removeToken(): void {
  if (typeof window === 'undefined') return;
  
  Cookies.remove('token');
  try {
    localStorage.removeItem('token');
  } catch {
    // Ignore localStorage errors
  }
}

// Create axios instance with interceptors
const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for cookies
});

// Request interceptor to add JWT token and correlation ID
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Add correlation ID header
    const correlationId = uuidv4();
    config.headers['X-Correlation-ID'] = correlationId;
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors and implement silent refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Handle 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return apiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Attempt to refresh the token
        // Note: We're calling the Next.js API route, not the Gateway directly
        // This ensures cookies are properly handled
        const response = await axios.post(
          `/api/auth/refresh`,
          {},
          {
            withCredentials: true, // Send cookies (refreshToken)
            headers: {
              'X-Correlation-ID': uuidv4(),
            },
          }
        );

        // Extract token from response (could be in data.token or data.access_token)
        const token = response.data?.token || response.data?.access_token;
        if (!token) {
          throw new Error('No token in refresh response');
        }
        setToken(token);

        // Process queued requests
        processQueue(null, token);

        // Retry the original request with new token
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${token}`;
        }
        isRefreshing = false;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // Refresh failed - clear tokens and redirect to login
        processQueue(refreshError, null);
        removeToken();
        isRefreshing = false;

        if (typeof window !== 'undefined') {
          const isOnLoginPage = window.location.pathname === '/login';
          if (!hasRedirectedToLogin && !isOnLoginPage) {
            hasRedirectedToLogin = true;
            window.location.href = '/login';
          }
        }

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
