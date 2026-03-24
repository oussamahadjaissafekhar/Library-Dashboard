import apiClient from './api';

interface UserProfile {
  id?: string;
  userId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

let cachedProfile: UserProfile | null = null;
let profilePromise: Promise<UserProfile> | null = null;

export async function getUserProfile(): Promise<UserProfile> {
  // Return cached profile if available
  if (cachedProfile) {
    return cachedProfile;
  }

  // Return existing promise if one is in flight
  if (profilePromise) {
    return profilePromise;
  }

  // Fetch profile
  profilePromise = apiClient
    .get('/auth/profile')
    .then((response) => {
      cachedProfile = response.data;
      return cachedProfile!;
    })
    .catch((error) => {
      profilePromise = null;
      throw error;
    });

  return profilePromise;
}

export function getUserId(): Promise<string> {
  return getUserProfile().then((profile) => {
    return profile.id || profile.userId || '';
  });
}

export function clearCachedProfile(): void {
  cachedProfile = null;
  profilePromise = null;
}

