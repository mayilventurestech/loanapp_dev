import { apiRequest } from './config';

// Get the full list of payment transactions from the real database
export const getPaymentTransactions = (token) => {
  return apiRequest('/payment-transactions', { method: 'GET' }, token);
};

// Create a new payment transaction in the real database
export const createPaymentTransaction = (data, token) => {
  return apiRequest('/payment-transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};