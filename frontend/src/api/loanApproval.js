import { apiRequest } from './config';

// Get the full list of loan approvals from the real database
export const getLoanApproval = (token) => {
  return apiRequest('/loan-approval', { method: 'GET' }, token);
};

// Create a new loan approval entry in the real database
export const createLoanApproval = (data, token) => {
  return apiRequest('/loan-approval', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};