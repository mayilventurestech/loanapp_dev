import { apiRequest } from './config';

// Get the full list of customer documents from the real database
export const getCustomerDocuments = (token) => {
  return apiRequest('/customer-documents', { method: 'GET' }, token);
};

// Create a new customer document entry in the real database
export const createCustomerDocument = (data, token) => {
  return apiRequest('/customer-documents', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};