import { apiRequest } from './config';

// Get the full list of branches from the real database
export const getBranches = (token) => {
  return apiRequest('/branches', { method: 'GET' }, token);
};

// Create a new branch in the real database
export const createBranch = (data, token) => {
  return apiRequest('/branches', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};