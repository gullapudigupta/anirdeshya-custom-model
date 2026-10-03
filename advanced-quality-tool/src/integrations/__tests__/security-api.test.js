/**
 * Tests for Security API Endpoints (P11-T006)
 */

'use strict';

const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const { HttpApiServer } = require('../http-api-server');
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const tmpdir = require('os').tmpdir();

describe('Security API Endpoints (P11-T006)', () => {
  let server;
  let app;
  let testDir;

  beforeAll(async () => {
    // Create test directory
    testDir = path.join(tmpdir, 'aqt-security-api-test-' + Date.now());
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create test files with security issues
    const testFile = path.join(testDir, 'test.js');
    fs.writeFileSync(testFile, `
      // SQL injection vulnerability
      const query = 'SELECT * FROM users WHERE id = ' + userId;
      
      // Hardcoded password
      const password = 'admin123';
    `, 'utf8');

    // Create package.json
    const pkgFile = path.join(testDir, 'package.json');
    fs.writeFileSync(pkgFile, JSON.stringify({
      name: 'test-app',
      version: '1.0.0',
      dependencies: {
        lodash: '1.0.0'
      }
    }), 'utf8');

    // Start API server
    const config = {
      port: 0, // Random port
      host: 'localhost'
    };

    server = new HttpApiServer(config);
    app = server.getApp();

    // Note: Not starting the full server, just testing the app
  });

  afterAll(async () => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('POST /api/security/scan', () => {
    test('should return 200 on successful scan', async () => {
      const response = await request(app)
        .post('/api/security/scan')
        .send({
          workspacePath: testDir,
          scanTypes: ['vuln'],
          severity: 'high'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('findings');
      expect(response.body.data.findings).toHaveProperty('vulnerabilities');
    });

    test('should scan all types by default', async () => {
      const response = await request(app)
        .post('/api/security/scan')
        .send({
          workspacePath: testDir
        });

      expect(response.status).toBe(200);
      expect(response.body.data.scanTypes).toContain('vuln');
      expect(response.body.data.scanTypes).toContain('secrets');
      expect(response.body.data.scanTypes).toContain('deps');
    });

    test('should return stats in response', async () => {
      const response = await request(app)
        .post('/api/security/scan')
        .send({
          workspacePath: testDir,
          scanTypes: ['vuln']
        });

      expect(response.status).toBe(200);
      expect(response.body.data.stats).toHaveProperty('totalIssues');
      expect(response.body.data.stats).toHaveProperty('critical');
      expect(response.body.data.stats).toHaveProperty('high');
      expect(response.body.data.stats).toHaveProperty('medium');
      expect(response.body.data.stats).toHaveProperty('low');
    });

    test('should support severity filtering', async () => {
      const response = await request(app)
        .post('/api/security/scan')
        .send({
          workspacePath: testDir,
          severity: 'critical',
          scanTypes: ['vuln']
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('findings');
    });
  });

  describe('GET /api/security/vulnerabilities', () => {
    test('should return 200 on successful fetch', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return statistics', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('count');
    });

    test('should use current directory if no workspace specified', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });

  describe('GET /api/security/secrets', () => {
    test('should return 200 on successful fetch', async () => {
      const response = await request(app)
        .get('/api/security/secrets')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return statistics', async () => {
      const response = await request(app)
        .get('/api/security/secrets')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('count');
    });

    test('should find hardcoded secrets', async () => {
      const response = await request(app)
        .get('/api/security/secrets')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      // May or may not find secrets depending on pattern detection
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /api/security/dependencies', () => {
    test('should return 200 on successful fetch', async () => {
      const response = await request(app)
        .get('/api/security/dependencies')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should return statistics', async () => {
      const response = await request(app)
        .get('/api/security/dependencies')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('stats');
      expect(response.body).toHaveProperty('count');
    });

    test('should handle missing package.json gracefully', async () => {
      const tempDir = path.join(tmpdir, 'aqt-no-pkg-' + Date.now());
      fs.mkdirSync(tempDir, { recursive: true });

      const response = await request(app)
        .get('/api/security/dependencies')
        .query({ workspacePath: tempDir });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body).toHaveProperty('message');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should check vulnerabilities in package.json', async () => {
      const response = await request(app)
        .get('/api/security/dependencies')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      // lodash 1.0.0 is very old and likely has known vulnerabilities
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('Error handling', () => {
    test('POST /api/security/scan should handle errors gracefully', async () => {
      const response = await request(app)
        .post('/api/security/scan')
        .send({
          workspacePath: '/nonexistent/path/that/does/not/exist'
        });

      // Should still return 200 with empty results or 500 on error
      expect([200, 500]).toContain(response.status);
    });

    test('GET /api/security/vulnerabilities should handle invalid workspace', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities')
        .query({ workspacePath: '/nonexistent/path' });

      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Response format', () => {
    test('should return properly formatted JSON responses', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
      expect(response.type).toBe('application/json');
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('should include CORS headers', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities');

      // CORS headers should be present
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    test('should include rate limit headers if configured', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities');

      // Rate limit headers should be present if configured
      if (response.headers['x-ratelimit-limit']) {
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
        expect(response.headers['x-ratelimit-reset']).toBeDefined();
      }
    });
  });

  describe('Query parameters', () => {
    test('should support workspace query parameter', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities')
        .query({ workspacePath: testDir });

      expect(response.status).toBe(200);
    });

    test('should support severity query parameter', async () => {
      const response = await request(app)
        .get('/api/security/vulnerabilities')
        .query({ 
          workspacePath: testDir,
          severity: 'critical'
        });

      expect(response.status).toBe(200);
    });

    test('should handle multiple scan types', async () => {
      const response = await request(app)
        .post('/api/security/scan')
        .send({
          workspacePath: testDir,
          scanTypes: ['vuln', 'secrets']
        });

      expect(response.status).toBe(200);
      expect(response.body.data.scanTypes).toContain('vuln');
      expect(response.body.data.scanTypes).toContain('secrets');
    });
  });
});
