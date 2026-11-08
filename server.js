'use strict';

const cds = require('@sap/cds');
const express = require('express');
const crypto = require('node:crypto');

const APPROVAL_ROLES = ['DepartmentManager', 'FinanceController', 'PurchasingDirector'];

function sameSecret(actual = '', expected = '') {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

cds.on('bootstrap', app => {
  app.post('/auth/login', express.json({ limit: '4kb' }), (req, res) => {
    if (process.env.NODE_ENV === 'production') return res.sendStatus(404);
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const configured = cds.env.requires.auth?.users?.[username];
    if (!configured || !sameSecret(password, configured.password)) {
      // Aucun WWW-Authenticate : le navigateur ne peut pas ouvrir sa boîte Basic native.
      return res.status(401).json({ error: { message: 'Identifiant ou mot de passe incorrect.' } });
    }
    const assignedRoles = Array.isArray(configured.roles)
      ? configured.roles
      : Object.keys(configured.roles || {}).filter(role => configured.roles[role]);
    const roles = APPROVAL_ROLES.filter(role => assignedRoles.includes(role));
    return res.json({
      id: username,
      canApprove: assignedRoles.includes('Admin') || roles.length > 0,
      isAdmin: assignedRoles.includes('Admin'),
      roles
    });
  });
});

module.exports = cds.server;
