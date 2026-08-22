import { expect, test, type ElectronApplication } from '@playwright/test';
import { E2E_SMITH_MESSAGE, E2E_SMITH_PROPOSAL_NAME, seedOnboardedFixture } from './seed.js';
import { launchFoundry } from './harness.js';

test.describe('smith / chat', () => {
  test('opens the chat screen and bubble against a seeded transcript and proposal', async () => {
    const fixture = seedOnboardedFixture();
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchFoundry(fixture.userDataDir);
      app = launched.app;
      const { window } = launched;

      await expect(window.getByPlaceholder(/What should the factory build/)).toBeVisible({
        timeout: 20_000,
      });

      const bubble = window.getByTestId('smith-bubble');
      await expect(bubble).toBeVisible();
      await bubble.click();

      const popover = window.getByTestId('smith-popover');
      await expect(popover).toBeVisible();
      await expect(popover.getByText(E2E_SMITH_MESSAGE)).toBeVisible();
      await expect(popover.getByTestId('smith-proposal-card')).toBeVisible();
      await expect(
        popover.getByRole('heading', { name: `Smith wants to create ${E2E_SMITH_PROPOSAL_NAME}` }),
      ).toBeVisible();

      await window.getByTestId('smith-bubble-close').click();
      await expect(popover).toBeHidden();

      await window.getByTestId('nav-smith').click();
      await expect(window.getByTestId('app-view')).toHaveAttribute('data-view', 'smith');
      await expect(window.getByTestId('smith-bubble')).toBeHidden();
      await expect(window.getByTestId('smith-input')).toBeVisible();
      await expect(
        window.getByTestId('smith-transcript').getByText(E2E_SMITH_MESSAGE),
      ).toBeVisible();
      await expect(window.getByTestId('smith-proposal-card')).toBeVisible();
      await expect(
        window.getByRole('heading', { name: `Smith wants to create ${E2E_SMITH_PROPOSAL_NAME}` }),
      ).toBeVisible();
    } finally {
      await app?.close();
    }
  });

  test('switches to global scope and renders an approval-gated action', async () => {
    const fixture = seedOnboardedFixture(undefined, 'action');
    let app: ElectronApplication | undefined;
    try {
      const launched = await launchFoundry(fixture.userDataDir);
      app = launched.app;
      const { window } = launched;
      await window.getByTestId('nav-smith').click();
      const card = window.getByTestId('smith-proposal-card');
      await expect(card).toContainText('Start pipeline run');
      await expect(card).toContainText('Build the requested change.');
      await window.getByTestId('smith-proposal-reject').click();
      await expect(card).toBeHidden();
      await window.getByTestId('smith-scope').selectOption('__all__');
      await expect(window.getByTestId('smith-scope')).toHaveValue('__all__');
      await expect(window.getByTestId('smith-input')).toBeEnabled();
    } finally {
      await app?.close();
    }
  });

  test('keeps provider secrets masked and outside proposal text', async () => {
    const fixture = seedOnboardedFixture(undefined, 'secure');
    let app: ElectronApplication | undefined;
    const fixtureSecret = 'e2e-secret-never-render';
    try {
      const launched = await launchFoundry(fixture.userDataDir);
      app = launched.app;
      const { window } = launched;
      await window.getByTestId('nav-smith').click();
      const card = window.getByTestId('smith-proposal-card');
      const input = window.getByTestId('smith-proposal-secret');
      await expect(input).toHaveAttribute('type', 'password');
      await input.fill(fixtureSecret);
      await expect(card).not.toContainText(fixtureSecret);
      await expect(window.getByTestId('smith-transcript')).not.toContainText(fixtureSecret);
      await window.getByTestId('smith-proposal-reject').click();
      await expect(card).toBeHidden();
      await expect(window.getByTestId('smith-proposal-secret')).toHaveCount(0);
    } finally {
      await app?.close();
    }
  });
});
