import { apiRequest } from './config';

// Log in against the real backend using email + password.
// Returns whatever the backend sends back: { success, token, message }
export const loginUser = (email, password) => {
  return apiRequest('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
};