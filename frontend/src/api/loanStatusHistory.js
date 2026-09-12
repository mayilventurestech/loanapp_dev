import { apiRequest } from './config';

// Get the loan status history from the real database
export const getLoanStatusHistory = (token) => {
  return apiRequest('/loan-status-history', { method: 'GET' }, token);
};

// Create a new loan status history entry in the real database
export const createLoanStatusHistory = (data, token) => {
  return apiRequest('/loan-status-history', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};