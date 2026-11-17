// T4: the codebase's login lesson.
import { moves } from './lib.mjs';
const LOGIN = 'fn:src/auth/service.ts#authservice.login';
const CREATE = 'fn:src/sessions/store.ts#sessionstore.create';
const CUT = `edge:calls:${LOGIN}->${CREATE}`;
export default {
  beats: [
    ['trace', async (a) => {
      const m = moves(a);
      await m.stepIs(/repo-login:0:/, 'repo-intro', 5000);
      await a.sleep(1200);
      await m.btn('next', 900);
      await a.pull();
      await a.sleep(1200);
      await m.btn('trace', 1800);
      await m.node(LOGIN, 900);
      await m.btn('evidence', 4500); // the step's source lines
    }],
    ['break', async (a) => {
      const m = moves(a);
      await a.sleep(500);
      await m.node(CREATE, 1300); // predict
      await m.plug(CUT, 1600); // cut the call
      await m.btn('evidence', 5000); // the recorded run: the failing tests
    }],
    ['fix', async (a) => {
      const m = moves(a);
      await a.sleep(500);
      await m.btn('next', 900);
      await m.node('fn:src/sessions/store.ts#sessionstore.revoke', 1100); // wrong socket
      await m.node(CREATE, 1800); // right socket
      await m.btn('next', 2500);
    }],
  ],
};
