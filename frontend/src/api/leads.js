import { apiRequest } from './config';

// Get the full list of leads from the real database
export const getLeads = (token) => {
  return apiRequest('/leads', { method: 'GET' }, token);
};

// Create a new lead in the real database
export const createLead = (data, token) => {
  return apiRequest('/leads', {
    method: 'POST',
    body: JSON.stringify(data),
  }, token);
};

// Update just a lead's status (Initiate / Processing / Convert)
export const updateLeadStatus = (leadId, lead_status, token) => {
  return apiRequest(`/leads/${leadId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ lead_status }),
  }, token);
};

// Convert an approved lead into a real Customer record.
// leadId is the lead's internal lead_pk.
export const convertLeadToCustomer = (leadId, customerData, token) => {
  return apiRequest(`/leads/${leadId}/convert`, {
    method: 'POST',
    body: JSON.stringify(customerData),
  }, token);
};