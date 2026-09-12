import { apiRequest } from './config';

// Get the full list of loan applicants from the real database
export const getLoanApplicants = (token) => {
  return apiRequest('/loan-applicants', { method: 'GET' }, token);
};

// Create a new loan applicant in the real database
export const createLoanApplicant = (data, token) => {
  return apiRequest('/loan-applicants', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};