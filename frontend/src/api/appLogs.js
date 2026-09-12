import { apiRequest } from './config';

// Get the app activity logs from the real database
export const getAppLogs = (token) => {
  return apiRequest('/app-logs', { method: 'GET' }, token);
};