import { apiRequest } from './config';

// Get the full list of loans from the real database
export const getLoans = (token) => {
  return apiRequest('/loans', { method: 'GET' }, token);
};

// Create a new loan in the real database
export const createLoan = (loanData, token) => {
  return apiRequest('/loans', {
    method: 'POST',
    body: JSON.stringify(loanData),
  }, token);
};