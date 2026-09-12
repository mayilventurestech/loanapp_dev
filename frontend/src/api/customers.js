import { apiRequest } from './config';

// Get the full list of customers from the real database
export const getCustomers = (token) => {
  return apiRequest('/customers', { method: 'GET' }, token);
};

// Create a new customer in the real database
export const createCustomer = (customerData, token) => {
  return apiRequest('/customers', {
    method: 'POST',
    body: JSON.stringify(customerData),
  }, token);
};