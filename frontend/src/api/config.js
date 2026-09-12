// This file knows where our backend server lives, and has one
// helper function that every other api/*.js file uses to talk to it.

const API_BASE_URL = 'http://localhost:8000/api';
//const API_BASE_URL = 'http://Render.com/api';


// path: e.g. '/login', '/customers', '/employees'
// options: normal fetch options, e.g. { method: 'POST', body: JSON.stringify(...) }
// token: the login token (leave empty for login itself)
export const apiRequest = async (path, options = {}, token) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  return data;
};
