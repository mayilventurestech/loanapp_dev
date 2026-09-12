import { apiRequest } from './config';

// Get customer credit info from the real database
export const getCustomerCreditInfo = (token) => {
  return apiRequest('/customer-credit-info', { method: 'GET' }, token);
};

// Create a new customer credit info entry in the real database
export const createCustomerCreditInfo = (data, token) => {
  return apiRequest('/customer-credit-info', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};