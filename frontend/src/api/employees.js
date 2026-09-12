import { apiRequest } from './config';

// Get the full list of employees from the real database
export const getEmployees = (token) => {
  return apiRequest('/employees', { method: 'GET' }, token);
};

// Create a new employee in the real database
export const createEmployee = (employeeData, token) => {
  return apiRequest('/employees', {
    method: 'POST',
    body: JSON.stringify(employeeData),
  }, token);
};