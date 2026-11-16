// All e-mail leaves through sendMail(). Which provider is used is a deployment decision (MAIL_PROVIDER); until one is chosen
// nothing is sent and the screen shows the link to hand over yourself. Locally, mails land in an outbox the tests can read.
import { controlDB } from './tenancy.js';
import { now, run } from './lib.js';

/** @returns {Promise<{sent: boolean}>} */
export async function sendMail(env, { to, subject, text }) {
  const provider = env.MAIL_PROVIDER || 'none';
  if (env.DATA_REGION === 'local') {
    await run(await controlDB(env), 'INSERT INTO outbox(at, to_addr, subject, body) VALUES (?,?,?,?)', now(), to, subject, text);
    return { sent: true };
  }
  // Providers are added here when one has been chosen (the API key is a Worker secret, never in code):
  //   if (provider === 'scaleway') return scaleway(env, { to, subject, text });
  //   if (provider === 'cloudflare') return cloudflare(env, { to, subject, text });
  void provider;
  return { sent: false };
}
