import { apiRequest } from './config';

// Get the full permissions grid (roles + features + who can see/edit/
// delete what). Only works if the logged-in user is a Super Admin -
// the backend rejects anyone else with a 403.
export const getPermissionsGrid = (token) => {
  return apiRequest('/permissions/grid', { method: 'GET' }, token);
};

// Update one cell in the grid - one role's view/edit/delete access to
// one feature. Call this every time a checkbox is toggled; it creates
// the row if it doesn't exist yet, or updates it if it does.
export const updatePermission = (role_pk, feature_pk, can_view, can_edit, can_delete, token) => {
  return apiRequest('/permissions', {
    method: 'PUT',
    body: JSON.stringify({ role_pk, feature_pk, can_view, can_edit, can_delete }),
  }, token);
};