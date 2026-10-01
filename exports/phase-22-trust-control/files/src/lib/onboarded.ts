/**
 * lib/onboarded.ts — first-run flag shared by App and the onboarding wizard.
 * Kept outside the component so react-refresh stays happy.
 */

export const ONBOARDED_KEY = 'sophia:onboarded';

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    /* private mode: the wizard just shows again next time */
  }
}
