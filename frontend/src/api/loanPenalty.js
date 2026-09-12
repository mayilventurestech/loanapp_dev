import { apiRequest } from './config';

// Get the full list of loan penalties from the real database
export const getLoanPenalty = (token) => {
  return apiRequest('/loan-penalty', { method: 'GET' }, token);
};

// Create a new loan penalty entry in the real database
export const createLoanPenalty = (data, token) => {
  return apiRequest('/loan-penalty', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};