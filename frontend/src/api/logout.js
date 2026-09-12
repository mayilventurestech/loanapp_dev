import { apiRequest } from './config';

// Log out the current user (tells the backend the session/token is done)
export const logoutUser = (token) => {
  return apiRequest('/logout', { method: 'POST' }, token);
};