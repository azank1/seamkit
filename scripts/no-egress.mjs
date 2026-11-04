// Loaded into every test process (`node --import ./scripts/no-egress.mjs`): any socket to a host other
// than this machine fails. seamkit's verdicts never call a model or any outside service (NFR2), and the
// tests prove it by running against local stand-ins only, so a test that reaches out is a defect,
// whether in the code under test or in the test. Every socket Node opens, fetch and TLS included,
// passes through net.Socket's connect; child processes are not covered, and the tests give git only
// local remotes.
import net from 'node:net';

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i;

// The host a connect call is for, or undefined for a local (path) socket. Node calls connect with
// (options, cb), (port, host, cb), (path, cb), or internally with one normalised array of those.
export function connectHost(args) {
  const [first] = Array.isArray(args[0]) ? args[0] : args;
  if (first !== null && typeof first === 'object') return first.path !== undefined ? undefined : (first.host ?? 'localhost');
  if (typeof first === 'string' && !/^\d+$/.test(first)) return undefined;
  const second = (Array.isArray(args[0]) ? args[0] : args)[1];
  return typeof second === 'string' ? second : 'localhost';
}

export const isLoopback = (host) => LOOPBACK.test(host.replace(/^\[|\]$/g, ''));

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const host = connectHost(args);
  if (host === undefined || isLoopback(host)) return connect.apply(this, args);
  const error = Object.assign(new Error(`a test tried to reach ${host}; seamkit's tests may reach only this machine (NFR2)`), { code: 'SEAMKIT_EGRESS' });
  process.nextTick(() => this.destroy(error));
  return this;
};
