'use strict';

const { test, expect } = require('@playwright/test');

async function login(page, username, password) {
  await page.goto('/index.html');
  await page.getByLabel('Identifiant').fill(username);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText(username, { exact: true })).toBeVisible();
}

test('le responsable ne peut pas traiter une étape Finance', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'approver', 'approver123');
  await expect(page.getByText('Responsable département', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Demandes & Workflow' }).click();
  await page.getByText('DA-2026-002', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approuver l’étape' })).toHaveCount(0);
  await expect(page.getByText('Rôle : FinanceController', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('le contrôleur financier voit l’action de son étape', async ({ page }) => {
  await login(page, 'finance', 'finance123');
  await expect(page.getByText('Contrôle financier', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Demandes & Workflow' }).click();
  await page.getByText('DA-2026-002', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approuver l’étape' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rejeter' })).toBeVisible();
});

test('le profil lecture seule ne voit aucune création', async ({ page }) => {
  await login(page, 'viewer', 'viewer123');
  await page.getByRole('button', { name: 'Demandes & Workflow' }).click();
  await expect(page.getByRole('button', { name: 'Nouvelle demande' })).toHaveCount(0);
  await expect(page.getByText('Consultation', { exact: true })).toBeVisible();
});

test('un mot de passe incorrect reste dans le formulaire ProcureFlow', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByLabel('Identifiant').fill('admin');
  await page.getByLabel('Mot de passe').fill('incorrect');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Identifiant ou mot de passe incorrect.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});

test('la création UI génère un numéro de demande compatible String(12)', async ({ page }) => {
  await login(page, 'approver', 'approver123');
  await page.getByRole('button', { name: 'Demandes & Workflow' }).click();
  await page.getByRole('button', { name: 'Nouvelle demande' }).click();
  await page.getByPlaceholder('Ex. Équipements pour la nouvelle équipe').fill('Demande créée par le test UI');
  await page.getByPlaceholder('Article ou prestation').fill('Clavier ergonomique');
  await page.getByPlaceholder('0.00').fill('750');
  await page.getByPlaceholder('Pourquoi cet achat est-il nécessaire ?').fill('Validation automatique du format du numéro');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(page.getByText('Demande créée en brouillon', { exact: true })).toBeVisible();
  await expect(page.getByText(/^DA\d{10}$/)).toBeVisible();
});
