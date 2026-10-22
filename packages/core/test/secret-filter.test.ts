import { describe, expect, test } from 'bun:test';
import { isSecretFile } from '../src/security/secret-filter.js';

describe('isSecretFile', () => {
  test('matches .env and .env.* files', () => {
    expect(isSecretFile('.env')).toBe(true);
    expect(isSecretFile('.env.local')).toBe(true);
    expect(isSecretFile('.env.production')).toBe(true);
    expect(isSecretFile('/project/.env')).toBe(true);
  });

  test('matches certificate and key extensions', () => {
    expect(isSecretFile('server.pem')).toBe(true);
    expect(isSecretFile('cert.key')).toBe(true);
    expect(isSecretFile('cert.p12')).toBe(true);
    expect(isSecretFile('cert.pfx')).toBe(true);
  });

  test('matches known SSH key names', () => {
    expect(isSecretFile('id_rsa')).toBe(true);
    expect(isSecretFile('id_ed25519')).toBe(true);
    expect(isSecretFile('/home/user/.ssh/id_rsa')).toBe(true);
  });

  test('matches files with "secret" or "credential" in name', () => {
    expect(isSecretFile('my_secrets.json')).toBe(true);
    expect(isSecretFile('aws_credentials')).toBe(true);
    expect(isSecretFile('SECRETS.yaml')).toBe(true);
  });

  test('does not match ordinary source files', () => {
    expect(isSecretFile('index.ts')).toBe(false);
    expect(isSecretFile('README.md')).toBe(false);
    expect(isSecretFile('config.json')).toBe(false);
    expect(isSecretFile('envelope.ts')).toBe(false);
  });

  test('extra patterns extend the default list', () => {
    expect(isSecretFile('private.txt', ['*.txt'])).toBe(true);
    expect(isSecretFile('internal.json', ['internal.*'])).toBe(true);
    expect(isSecretFile('public.txt', ['*.log'])).toBe(false);
  });
});
