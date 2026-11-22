import { t } from './ui.js';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';

const directory = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tempo-filler');
const profilePath = join(directory, 'profile.json');
const service = 'tempo-filler';

export async function readProfile() {
  try {
    return JSON.parse(await readFile(profilePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveProfile(profile) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${profilePath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, profilePath);
}

export function savedToken(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  if (process.platform !== 'darwin') return null;
  const result = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', name, '-w'], {
    encoding: 'utf8', timeout: 30_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function saveToken(name, value) {
  if (process.platform !== 'darwin' || !/^[A-Za-z0-9._+/:=-]+$/.test(value)) return false;
  // Send the token through stdin, so it does not appear in the process arguments.
  const result = spawnSync('/usr/bin/security', ['-i'], {
    input: `add-generic-password -U -s ${service} -a ${name} -w "${value}"\n`,
    encoding: 'utf8', timeout: 30_000,
  });
  return result.status === 0 && savedToken(name) === value;
}

export async function withWriteLock(action) {
  const path = join(directory, 'write.lock');
  try {
    await writeFile(path, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(t(
      `Başka bir kayıt işlemi kilidi var (${path}). İşlem kapalıysa kilidi kaldırabilirsin.`,
      `Another submission holds a lock (${path}). Remove it only if that process has exited.`,
    ));
    throw error;
  }
  try {
    return await action();
  } finally {
    await unlink(path);
  }
}
