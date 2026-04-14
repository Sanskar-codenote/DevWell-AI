export const ACTIVE_SESSION_KEY = 'devwell_active_session';
export const SESSION_DATA_KEY = 'devwell_session_data';
export const EXTENSION_STATE_ATTRIBUTE = 'data-devwell-extension-state';
export const EXTENSION_AUTH_ATTRIBUTE = 'data-devwell-extension-auth';
export const EXTENSION_COMMAND_ATTRIBUTE = 'data-devwell-extension-command';
export const SESSION_OWNER_KEY = 'devwell_session_owner';
export const SHARED_SESSION_KEY = 'devwell_shared_session';
export const SESSION_COMMAND_KEY = 'devwell_session_command';

export function clearPersistedSession(): void {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
  localStorage.removeItem(SESSION_DATA_KEY);
  localStorage.removeItem(SESSION_OWNER_KEY);
  localStorage.removeItem(SHARED_SESSION_KEY);
  localStorage.removeItem(SESSION_COMMAND_KEY);
}
