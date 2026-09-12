import { apiRequest } from './config';

// Get the full list of loan collateral from the real database
export const getLoanCollateral = (token) => {
  return apiRequest('/loan-collateral', { method: 'GET' }, token);
};

// Create a new loan collateral entry in the real database
export const createLoanCollateral = (data, token) => {
  return apiRequest('/loan-collateral', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};