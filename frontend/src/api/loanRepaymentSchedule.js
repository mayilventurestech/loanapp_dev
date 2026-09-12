import { apiRequest } from './config';

// Get the loan repayment schedule from the real database
export const getLoanRepaymentSchedule = (token) => {
  return apiRequest('/loan-repayment-schedule', { method: 'GET' }, token);
};

// Create a new loan repayment schedule entry in the real database
export const createLoanRepaymentSchedule = (data, token) => {
  return apiRequest('/loan-repayment-schedule', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};